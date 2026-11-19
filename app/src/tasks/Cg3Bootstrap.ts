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
 * cg3Env 已避开 @modules/core 和 @openliri/infra/monitoring 的循环导入链，
 * 但 handleError（@openliri/infra/error）和 Logger（@openliri/infra/monitoring）在 catch 块中是安全惰性导入的。
 */
async function _logAndHandle(
  level: 'warn' | 'error',
  module: string,
  msg: string,
  error: unknown,
  action?: string
) {
  cg3Log(module, level, msg, { error: String(error) });
  try {
    const { handleError } = await import('@openliri/infra/error/handleError');
    await handleError(error, { module, action: action ?? msg });
  } catch {
    // handleError 自身失败不阻塞
  }
}

/** 全局 CG3 实例 */
let _cg3: Cg3BootstrapResult | null = null;

/**
 * 取全局 SelfWake 服务（未启动 CG3 时返回 null）。
 *
 * N-37（2026-09-20）：自唤醒工具（`sleep_for` / `sleep_until`）需要在**执行时**拿到
 * 服务实例登记唤醒——工具装配与 CG3 启动的先后顺序不固定，故只暴露取值器、
 * 由调用方惰性解析（不在装配期捕获实例）。
 */
export function getCg3SelfWakeService(): SelfWakeService | null {
  return _cg3?.selfWakeService ?? null;
}

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

/** 已接线过的调度器实例（幂等；`CronScheduler` 重启会换实例 ⇒ 用 WeakSet 而非布尔） */
const _wiredSchedulers = new WeakSet<object>();

/**
 * 将 CronScheduler.extraTick 连线到 SelfWakeService。
 * 在 CronScheduler 启动后调用。
 *
 * 幂等：`startCg3`（CG3 先起）与 `ensureGlobalCronSchedulerStarted`（cron 先起）**两侧**都会调用
 * 本函数 —— 重复接线会把 `extraTick` 叠成多条链，同一条到期唤醒被扫多次。
 *
 * @param selfWakeService  SelfWake 服务实例
 */
export async function wireSelfWakeToCron(
  selfWakeService: SelfWakeService
): Promise<boolean> {
  try {
    const { getGlobalCronScheduler } =
      await import('./cron/GlobalCronScheduler');
    const scheduler = getGlobalCronScheduler();
    if (!scheduler) {
      cg3Log('tasks:cg3:bootstrap', 'warn', 'wireSelfWake: cron not started');
      return false;
    }
    if (_wiredSchedulers.has(scheduler)) {
      cg3Log('tasks:cg3:bootstrap', 'debug', 'wireSelfWake: already wired');
      return true;
    }
    _wiredSchedulers.add(scheduler);

    const prevExtraTick = scheduler.extraTick;
    scheduler.extraTick = () => {
      try {
        prevExtraTick?.();
      } catch {
        /* best-effort */
      }

      // Fire-and-forget: SelfWake 操作异步执行，不阻塞 Cron tick 循环
      // 如果失败，到期唤醒条目会在下次 tick 重试
      selfWakeService
        .getDueWakes()
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
    await _logAndHandle(
      'warn',
      'tasks:cg3:bootstrap',
      'wireSelfWake: failed',
      err,
      'cg3_wire_selfwake'
    );
    return false;
  }
}

/**
 * 幂等接线入口：CG3 服务在位**且**全局 cron 已启动时才真正接上。
 *
 * A（2026-11-19 真机根因）：`startCg3` 在初始化管线里执行，早于 REPL/DAEMON 启动 cron ⇒
 * 彼时 `getGlobalCronScheduler()` 为 null，接线必然失败且**没有重试** ⇒ `extraTick` 永不扫
 * 到期条目 ⇒ 过期 `pending` 自唤醒不被 `fire()`、前端「⏳ 等待中」常驻。
 * 故由两侧各试一次：`startCg3`（CG3 先起）与 `ensureGlobalCronSchedulerStarted`（cron 先起）。
 */
export async function ensureSelfWakeWiredToCron(): Promise<boolean> {
  const svc = _cg3?.selfWakeService;
  if (!svc) return false;
  return wireSelfWakeToCron(svc);
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
    _logAndHandle(
      'warn',
      'tasks:cg3:bootstrap',
      'wireAlwaysOn: failed',
      err,
      'cg3_wire_alwayson'
    ).catch(() => {});
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

  // B+C（2026-11-19 真机根因）：`sleepFor(< tickInterval)` 只在**进程内**建 `setTimeout`，
  // 重启（含 `bun --watch` 热重载）后 timer 丢失，条目永远停在 `pending` ⇒ 前端「等待中」常驻。
  // 这里补触发已过期的 `timer` 条目，并清理陈旧 `fired` 文件（`gc()` 此前无调用点）。
  // 不 await：`fire()` 会走执行器续跑一轮对话，阻塞启动无收益；失败只记 warn。
  void (async () => {
    try {
      const recovered = await result.selfWakeService.recoverOverdueWakes();
      const cleaned = await result.selfWakeService.collectGarbage();
      if (recovered > 0 || cleaned > 0) {
        cg3Log('tasks:cg3:bootstrap', 'info', 'startupRecovery', {
          recovered,
          cleaned,
        });
      }
    } catch (err) {
      cg3Log('tasks:cg3:bootstrap', 'warn', 'startupRecoveryFailed', {
        error: String(err),
      });
    }
  })();

  cg3Log('tasks:cg3:bootstrap', 'info', 'startCg3: ready');
  return result;
}

/** 获取当前 CG3 实例 */
export function getCg3(): Cg3BootstrapResult | null {
  return _cg3;
}

export default startCg3;
