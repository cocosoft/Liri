/**
 * AlwaysOnRuntime — 单项目自主执行运行时
 *
 * P0-2: 核心入口 — 门控检查 + 4阶段执行
 * try/finally 兜底防止资源锁永久泄露
 * 执行中重检 agent_busy + recent_user_msg
 */
import type { AlwaysOnConfig, DiscoveryPlan } from './types';
import { DEFAULT_ALWAYSON_CONFIG } from './types';
import { DiscoveryGates } from './DiscoveryGates';
import { SignalWatcher } from './SignalWatcher';
import { ResourceArbiter } from './ResourceArbiter';
import { DiscoveryScheduler } from './DiscoveryScheduler';
import { DiscoveryFire } from './DiscoveryFire';
import { cg3Log } from '../cg3Env';
import { drainManager } from '../drain/DrainManager';
import { handleError } from '@modules/error';
// 2026-10-08（架构治理 P1 续，用户裁定「一并处理 watchdog 和 cmdBridge」）：
// 删除 `cmdBridge` / `watchdog` 两个**从未注入**的可选依赖（取证见下方 tryRun 注释）。

export class AlwaysOnRuntime {
  readonly config: AlwaysOnConfig;
  readonly gates: DiscoveryGates;
  readonly signalWatcher: SignalWatcher;
  readonly resourceArbiter: ResourceArbiter;
  readonly fireRunner: DiscoveryFire;
  readonly scheduler: DiscoveryScheduler;

  constructor(config: Partial<AlwaysOnConfig> = {}, projectPath: string = '') {
    this.config = { ...DEFAULT_ALWAYSON_CONFIG, ...config };
    this.signalWatcher = new SignalWatcher(this.config.dormantDebounceMs);
    this.gates = new DiscoveryGates(
      this.config,
      this.signalWatcher,
      projectPath
    );
    this.resourceArbiter = new ResourceArbiter();
    this.fireRunner = new DiscoveryFire(this.config.execution);
    this.scheduler = new DiscoveryScheduler(
      this.config.tickIntervalMinutes,
      () => this.tryRun()
    );
  }

  /** P0-2: 核心入口 */
  async tryRun(): Promise<void> {
    if (!this.resourceArbiter.acquire('alwayson')) return;

    try {
      const gate = this.gates.evaluate();
      if (!gate.passed) {
        cg3Log('tasks:alwayson:runtime', 'debug', 'gateBlocked', {
          reason: gate.reason,
          detail: gate.detail,
        });
        return;
      }

      cg3Log('tasks:alwayson:runtime', 'info', 'gatePassed');

      // P3-3（2026-08-31）：统一排空协议——排空中不启动新自主运行循环
      if (drainManager.isDraining()) {
        cg3Log('tasks:alwayson:runtime', 'debug', 'drainingBlocked', {
          reason: drainManager.getReason(),
        });
        return;
      }

      // 阶段 1: Discovery
      const plan = await this.fireRunner.discovery();
      if (!plan) {
        cg3Log('tasks:alwayson:runtime', 'debug', 'noPlan');
        return;
      }

      // P1-9「将 plan 入队统一命令队列」**未接线，代码已移除**（2026-10-08）：该链三处均未打通 ——
      // ① `cmdBridge` 从未注入（**唯一**构造点 `AlwaysOnManager.registerProject()` 只传 2 参）；
      // ② 队列的消费端（对标 cc_code `queueProcessor`）**从未移植** ⇒ 队列只进不出；
      // ③ 上游 `tryRun()` 本身不跑（无任何 `registerProject` 调用，见 `main.ts` 启动注释）。
      // 按 CS03 **不凭空接线**（接线只会把 plan 投进无人消费的队列，多造一条 inert 链接）。
      // 队列 `MessageCommandQueue`（`query/`）随之**删除**（零生产者/零消费者/零需求；且其头注
      // 声称的 `waitForSlot()` 实际不存在 ⇒ 头注失实）。
      // 重启条件：同时补上「①队列 ②注入 ③drainer ④registerProject 上游」后再恢复本段入队。

      // 重检关键门控
      const recheck1 = this.gates.quickRecheck();
      if (!recheck1.passed) {
        cg3Log('tasks:alwayson:runtime', 'info', 'quickRecheckBlocked', {
          reason: recheck1.reason,
        });
        return;
      }

      // 阶段 2: Workspace
      const workspace = await this.fireRunner.workspace(plan);

      // 阶段 3: Execution
      const result = await this.fireRunner.execution(workspace);

      // 阶段 4: Report
      const report = await this.fireRunner.report(result);
      cg3Log('tasks:alwayson:runtime', 'info', 'completed', {
        success: result.success,
        durationMs: result.durationMs,
      });
      this.gates.recordRun();
    } catch (err) {
      handleError(err, {
        module: 'tasks:alwayson',
        action: 'runtime',
        context: { projectPath: this.config.dormantDebounceMs },
      });
    } finally {
      this.resourceArbiter.release('alwayson');
    }
  }

  /** 设置执行函数（由外部注入具体的 ChatManager 调用） */
  setDiscoveryFn(fn: () => Promise<DiscoveryPlan | null>): void {
    this.fireRunner.discovery = fn;
  }

  setWorkspaceFn(fn: (plan: DiscoveryPlan) => Promise<string>): void {
    this.fireRunner.workspace = fn;
  }

  setExecutionFn(
    fn: (workspace: string) => Promise<import('./types').ExecutionResult>
  ): void {
    this.fireRunner.execution = fn;
  }

  /** 更新外部状态 */
  notifyUserActivity(): void {
    this.gates.setLastUserMsg(Date.now());
    this.gates.setDormant(false);
  }

  notifyBusyChanged(busy: boolean): void {
    this.gates.setBusy(busy);
  }

  start(): void {
    this.scheduler.start();
    this.signalWatcher.start();
    cg3Log('tasks:alwayson:runtime', 'info', 'started');
  }

  stop(): void {
    this.scheduler.stop();
    this.signalWatcher.stop();
    cg3Log('tasks:alwayson:runtime', 'info', 'stopped');
  }
}
