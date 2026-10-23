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
import {
  principalFromKey,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope';
import type { AlwaysOnQuota } from './AlwaysOnQuota';
// 2026-10-08（架构治理 P1 续，用户裁定「一并处理 watchdog 和 cmdBridge」）：
// 删除 `cmdBridge` / `watchdog` 两个**从未注入**的可选依赖（取证见下方 tryRun 注释）。

export class AlwaysOnRuntime {
  readonly config: AlwaysOnConfig;
  readonly gates: DiscoveryGates;
  readonly signalWatcher: SignalWatcher;
  readonly resourceArbiter: ResourceArbiter;
  readonly fireRunner: DiscoveryFire;
  readonly scheduler: DiscoveryScheduler;
  /**
   * 归属键（多租户 P3）：`<tenantId>:<userId>`。
   *
   * 为空 ⇒ 本地项目：**不查配额、不加身份作用域**（与改造前逐字相同）。
   * 非空 ⇒ 本轮运行在归属者身份作用域内执行，并受 `AlwaysOnQuota` 的归属配额约束。
   */
  readonly ownerKey?: string;
  private readonly quota?: AlwaysOnQuota;
  /** 当前持有归属配额的数量（并发安全：用计数而非布尔） */
  private ownerQuotaHeld = 0;

  constructor(
    config: Partial<AlwaysOnConfig> = {},
    projectPath: string = '',
    ownerKey?: string,
    quota?: AlwaysOnQuota
  ) {
    this.config = { ...DEFAULT_ALWAYSON_CONFIG, ...config };
    this.ownerKey = ownerKey;
    this.quota = quota;
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
    // 多租户 P3：有归属 ⇒ 整轮（4 阶段 + 桥接器里的 ChatManager 调用）都在归属者身份作用域内，
    // 工具 cwd（P3）／存储（P1）／事件（P2）才落到该租户名下；无归属 ⇒ 原样执行（零变更）。
    const principal = principalFromKey(this.ownerKey);
    if (!principal) return this.runGuarded();
    return runWithPrincipal(principal, () => this.runGuarded());
  }

  /** 门控 + 配额 + 4 阶段（`tryRun` 的身份作用域包装在它外面） */
  private async runGuarded(): Promise<void> {
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

      cg3Log('tasks:alwayson:runtime', 'info', 'gatePassed', {
        ownerKey: this.ownerKey,
      });

      // P3-3（2026-08-31）：统一排空协议——排空中不启动新自主运行循环
      if (drainManager.isDraining()) {
        cg3Log('tasks:alwayson:runtime', 'debug', 'drainingBlocked', {
          reason: drainManager.getReason(),
        });
        return;
      }

      // 多租户 P3：归属配额（跨该归属的所有项目共享）。放在门控/排空之后 ⇒
      // 被拦下的 tick 不消耗租户配额；无归属 ⇒ 直接放行。
      if (!this.acquireOwnerQuota()) return;

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
      // 多租户 P3：整轮跑完才计入归属每日次数（与 gates.recordRun 同一点）——
      // 无计划 / 中途失败 / 被中止的轮次不消耗租户配额。
      this.gates.recordRun();
      this.recordOwnerQuotaRun();
    } catch (err) {
      handleError(err, {
        module: 'tasks:alwayson',
        action: 'runtime',
        context: { projectPath: this.config.dormantDebounceMs },
      });
    } finally {
      this.releaseOwnerQuota();
      this.resourceArbiter.release('alwayson');
    }
  }

  /** 尝试占用归属配额（无归属 / 无配额实例 ⇒ 直接放行） */
  private acquireOwnerQuota(): boolean {
    if (!this.ownerKey || !this.quota) return true;
    const decision = this.quota.tryAcquire(this.ownerKey);
    if (!decision.allowed) {
      cg3Log('tasks:alwayson:runtime', 'info', 'ownerQuotaBlocked', {
        ownerKey: this.ownerKey,
        reason: decision.reason,
      });
      return false;
    }
    this.ownerQuotaHeld += 1;
    return true;
  }

  /** 记录一次成功完成的运行（无归属 / 无配额 ⇒ no-op） */
  private recordOwnerQuotaRun(): void {
    if (!this.ownerKey || !this.quota) return;
    this.quota.recordRun(this.ownerKey);
  }

  /** 释放归属配额（未持有时为 no-op） */
  private releaseOwnerQuota(): void {
    if (this.ownerQuotaHeld === 0 || !this.ownerKey || !this.quota) return;
    this.ownerQuotaHeld -= 1;
    this.quota.release(this.ownerKey);
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

  /** 阶段 4 报告（U-02 2026-10-20：由桥接器注入真实落盘实现） */
  setReportFn(
    fn: (result: import('./types').ExecutionResult) => Promise<string>
  ): void {
    this.fireRunner.report = fn;
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
