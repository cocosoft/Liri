/**
 * Cg3Bootstrap — CG3 自主执行闭环启动连线（Phase D）
 *
 * 将 SelfWake + AlwaysOnRuntime 连接到 CronScheduler + ChatManager。
 * 从任意入口点调用，不依赖 main.ts 的具体启动流程。
 *
 * 连线：
 *   1. CronScheduler.extraTick → SelfWakeService.getDueWakes()（长时定时器批量扫描）
 *   2. ChatManager.onTurnEnd → AlwaysOnManager.notifyUserActivity()（更新 agent_busy 状态）
 */
import { WakeStore } from './selfwake/WakeStore';
import { SelfWakeService } from './selfwake/SelfWakeService';
import { AlwaysOnManager } from './alwayson/AlwaysOnManager';
import type { AlwaysOnConfig } from './alwayson/types';
import { cg3Log } from './cg3Env';

/**
 * 惰性导入 handleError + Logger，避免 CG3 模块循环依赖。
 * cg3Env 已避开 @modules/core 和 @modules/monitoring 的循环导入链，
 * 但 handleError（@modules/error）和 Logger（@modules/monitoring）在 catch 块中是安全惰性导入的。
 */
async function _logAndHandle(
  level: 'warn' | 'error',
  module: string,
  msg: string,
  error: unknown,
  action?: string,
) {
  cg3Log(module, level, msg, { error: String(error) });
  try {
    const { handleError } = await import('@modules/error/handleError');
    await handleError(error, { module, action: action ?? msg });
  } catch {
    // handleError 自身失败不阻塞
  }
}

/** 全局 CG3 实例 */
let _cg3: Cg3BootstrapResult | null = null;

export interface Cg3BootstrapResult {
  selfWakeService: SelfWakeService;
  alwaysOnManager: AlwaysOnManager;
  /** 断开所有连线，释放资源 */
  teardown: () => void;
}

/**
 * 初始化 CG3 自主执行闭环（SelfWake + AlwaysOnRuntime）。
 *
 * @param alwaysOnConfig  AlwaysOn 配置（可选）
 * @param cronTickIntervalMs  CronScheduler tick 间隔（ms），SelfWake 短时触发用
 */
export function createCg3Services(options?: {
  alwaysOnConfig?: Partial<AlwaysOnConfig>;
  cronTickIntervalMs?: number;
}): Cg3BootstrapResult {
  const tickIntervalMs = options?.cronTickIntervalMs ?? 300_000; // 默认 5min

  cg3Log('tasks:cg3:bootstrap', 'info', 'creating', { tickIntervalMs });

  // SelfWake
  const wakeStore = new WakeStore();
  const selfWakeService = new SelfWakeService(wakeStore, tickIntervalMs);

  // AlwaysOn
  const alwaysOnManager = new AlwaysOnManager(options?.alwaysOnConfig ?? {});

  const result: Cg3BootstrapResult = {
    selfWakeService,
    alwaysOnManager,
    teardown: () => {
      selfWakeService.destroy();
      alwaysOnManager.stop();
      cg3Log('tasks:cg3:bootstrap', 'info', 'teardown');
    },
  };

  _cg3 = result;
  return result;
}

/**
 * 将 CronScheduler.extraTick 连线到 SelfWakeService。
 * 在 CronScheduler 启动后调用。
 *
 * @param selfWakeService  SelfWake 服务实例
 */
export async function wireSelfWakeToCron(
  selfWakeService: SelfWakeService
): Promise<boolean> {
  try {
    const { getGlobalCronScheduler } = await import(
      './cron/GlobalCronScheduler'
    );
    const scheduler = getGlobalCronScheduler();
    if (!scheduler) {
      cg3Log('tasks:cg3:bootstrap', 'warn', 'wireSelfWake: cron not started');
      return false;
    }

    const prevExtraTick = scheduler.extraTick;
    scheduler.extraTick = () => {
      try { prevExtraTick?.(); } catch { /* best-effort */ }

      // Fire-and-forget: SelfWake 操作异步执行，不阻塞 Cron tick 循环
      // 如果失败，到期唤醒条目会在下次 tick 重试
      selfWakeService.getDueWakes()
        .then((due) => {
          for (const w of due) {
            selfWakeService.fire(w.id);
            cg3Log('tasks:cg3:selfWake', 'info', 'wakeFired', {
              wakeId: w.id,
              sessionId: w.sessionId,
            });
          }
        })
        .catch((err) => {
          cg3Log('tasks:cg3:selfWake', 'error', 'extraTickScanFailed', {
            error: String(err),
          });
        });
    };

    cg3Log('tasks:cg3:bootstrap', 'info', 'wireSelfWake: cron wired');
    return true;
  } catch (err) {
    await _logAndHandle('warn', 'tasks:cg3:bootstrap', 'wireSelfWake: failed', err, 'cg3_wire_selfwake');
    return false;
  }
}

/**
 * 将 ChatManager.onTurnEnd 连线到 AlwaysOnManager。
 * 在 ChatManager 创建后调用。
 *
 * @param chatManager  ChatManager 实例（需有 onTurnEnd 属性）
 * @param alwaysOnManager  AlwaysOnManager 实例
 */
export function wireAlwaysOnToChat(
  chatManager: { onTurnEnd?: (() => void) | undefined },
  alwaysOnManager: AlwaysOnManager
): boolean {
  try {
    chatManager.onTurnEnd = () => {
      alwaysOnManager.notifyUserActivity();
    };
    cg3Log('tasks:cg3:bootstrap', 'info', 'wireAlwaysOn: chat wired');
    return true;
  } catch (err) {
    // Fire-and-forget: handleError 异步执行不阻塞同步回调注册
    _logAndHandle('warn', 'tasks:cg3:bootstrap', 'wireAlwaysOn: failed', err, 'cg3_wire_alwayson').catch(() => {});
    return false;
  }
}

/**
 * 启动 CG3：创建服务 + 连线 Cron + 连线 ChatManager。
 * 一次性完成所有 Phase D 连线。
 *
 * @param chatManager  ChatManager 实例
 * @param options.alwaysOnConfig  AlwaysOn 配置
 * @param options.cronTickIntervalMs  Cron tick 间隔
 */
export async function startCg3(
  chatManager: { onTurnEnd?: (() => void) | undefined },
  options?: {
    alwaysOnConfig?: Partial<AlwaysOnConfig>;
    cronTickIntervalMs?: number;
  }
): Promise<Cg3BootstrapResult> {
  const result = createCg3Services(options);
  await wireSelfWakeToCron(result.selfWakeService);
  wireAlwaysOnToChat(chatManager, result.alwaysOnManager);

  cg3Log('tasks:cg3:bootstrap', 'info', 'startCg3: ready');
  return result;
}

/** 获取当前 CG3 实例 */
export function getCg3(): Cg3BootstrapResult | null {
  return _cg3;
}

export default startCg3;
