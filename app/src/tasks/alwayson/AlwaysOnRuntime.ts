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
import type { CommandBridge } from '../commands/CommandBridge';
import type { SteeringBridge } from '../steering/SteeringBridge';
import type { WatchdogBridge } from '../watchdog/WatchdogBridge';

export class AlwaysOnRuntime {
  readonly config: AlwaysOnConfig;
  readonly gates: DiscoveryGates;
  readonly signalWatcher: SignalWatcher;
  readonly resourceArbiter: ResourceArbiter;
  readonly fireRunner: DiscoveryFire;
  readonly scheduler: DiscoveryScheduler;
  private cmdBridge?: CommandBridge;
  private steerBridge?: SteeringBridge;
  private watchdog?: WatchdogBridge;

  constructor(
    config: Partial<AlwaysOnConfig> = {},
    projectPath: string = '',
    cmdBridge?: CommandBridge,
    steerBridge?: SteeringBridge,
    watchdog?: WatchdogBridge
  ) {
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
    this.cmdBridge = cmdBridge;
    this.steerBridge = steerBridge;
    this.watchdog = watchdog;
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

      // 阶段 1: Discovery
      const plan = await this.fireRunner.discovery();
      if (!plan) {
        cg3Log('tasks:alwayson:runtime', 'debug', 'noPlan');
        return;
      }

      // P1-9: 将 plan 入队统一命令队列
      if (this.cmdBridge) {
        await this.cmdBridge.enqueue({
          id: `alwayson-${plan.id}`,
          type: 'agent',
          content: plan.summary,
          priority: 'next',
          sessionId: 'alwayson',
          metadata: { plan, timestamp: Date.now() },
        });
      }

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
      cg3Log('tasks:alwayson:runtime', 'error', 'runtime:error', {
        error: String(err),
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
