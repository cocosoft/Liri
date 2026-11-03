/**
 * AlwaysOnManager — 多项目协调器
 *
 * P0-2: 管理多个 AlwaysOnRuntime 实例（每个项目一个），协调跨项目预算和资源。
 */
import type { AlwaysOnConfig } from './types';
import { AlwaysOnRuntime } from './AlwaysOnRuntime';
import { AlwaysOnQuota, type AlwaysOnQuotaConfig } from './AlwaysOnQuota';
import { cg3Log } from '../cg3Env';

export class AlwaysOnManager {
  private runtimes = new Map<string, AlwaysOnRuntime>();
  private config: AlwaysOnConfig;
  private enabled = false;
  /**
   * 多租户 P3：**归属配额账本**由 Manager 持有 ⇒ 同一租户的多个项目共享
   * 「每天 N 次 / 同时 M 个」的配额（放在 Runtime 里就变成"每项目一份"，等于没有租户级限流）。
   */
  private readonly quota: AlwaysOnQuota;

  constructor(
    config: Partial<AlwaysOnConfig> = {},
    quotaConfig: Partial<AlwaysOnQuotaConfig> = {}
  ) {
    this.config = { ...config } as AlwaysOnConfig;
    this.quota = new AlwaysOnQuota(quotaConfig);
  }

  /**
   * 注册项目。
   *
   * @param ownerKey 归属键（`<tenantId>:<userId>`）；本地项目（桌面 / CLI）不传 ⇒
   *   运行时既不查配额也不加身份作用域，与改造前一致。
   */
  registerProject(
    projectId: string,
    projectPath: string,
    ownerKey?: string
  ): AlwaysOnRuntime {
    const runtime = new AlwaysOnRuntime(
      this.config,
      projectPath,
      ownerKey,
      this.quota
    );
    this.runtimes.set(projectId, runtime);
    cg3Log('tasks:alwayson:manager', 'info', 'projectRegistered', {
      projectId,
      projectPath,
      ownerKey,
    });
    return runtime;
  }

  /** 移除项目 */
  unregisterProject(projectId: string): void {
    const runtime = this.runtimes.get(projectId);
    if (runtime) {
      runtime.stop();
      this.runtimes.delete(projectId);
      cg3Log('tasks:alwayson:manager', 'info', 'projectUnregistered', {
        projectId,
      });
    }
  }

  /** 获取项目运行时 */
  getRuntime(projectId: string): AlwaysOnRuntime | undefined {
    return this.runtimes.get(projectId);
  }

  /** 启动所有项目 */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    for (const [id, rt] of this.runtimes) {
      rt.start();
    }
    cg3Log('tasks:alwayson:manager', 'info', 'allStarted', {
      count: this.runtimes.size,
    });
  }

  /** 停止所有项目 */
  stop(): void {
    this.enabled = false;
    for (const rt of this.runtimes.values()) {
      rt.stop();
    }
    cg3Log('tasks:alwayson:manager', 'info', 'allStopped');
  }

  /** 通知所有运行时用户活动 */
  notifyUserActivity(): void {
    for (const rt of this.runtimes.values()) {
      rt.notifyUserActivity();
    }
  }

  /** 获取项目数量 */
  getProjectCount(): number {
    return this.runtimes.size;
  }

  /**
   * 2026-11-03 P1：全部已注册项目的运行态快照（`/v1/autonomy/status` 的唯一数据源）。
   *
   * 只读、无副作用；项目名/路径由调用方（entry）补全（manager 不持有项目元数据）。
   */
  runtimeSnapshots(): Array<{
    projectId: string;
    running: boolean;
    gates: ReturnType<AlwaysOnRuntime['snapshot']>['gates'];
  }> {
    return [...this.runtimes.entries()].map(([projectId, runtime]) => {
      const snap = runtime.snapshot();
      return { projectId, running: snap.running, gates: snap.gates };
    });
  }

  /** 是否启用 */
  isEnabled(): boolean {
    return this.enabled;
  }
}
