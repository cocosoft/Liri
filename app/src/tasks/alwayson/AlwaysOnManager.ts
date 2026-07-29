/**
 * AlwaysOnManager — 多项目协调器
 *
 * P0-2: 管理多个 AlwaysOnRuntime 实例（每个项目一个），协调跨项目预算和资源。
 */
import type { AlwaysOnConfig } from './types';
import { AlwaysOnRuntime } from './AlwaysOnRuntime';
import { cg3Log } from '../cg3Env';

export class AlwaysOnManager {
  private runtimes = new Map<string, AlwaysOnRuntime>();
  private config: AlwaysOnConfig;
  private enabled = false;

  constructor(config: Partial<AlwaysOnConfig> = {}) {
    this.config = { ...config } as AlwaysOnConfig;
  }

  /** 注册项目 */
  registerProject(projectId: string, projectPath: string): AlwaysOnRuntime {
    const runtime = new AlwaysOnRuntime(this.config, projectPath);
    this.runtimes.set(projectId, runtime);
    cg3Log('tasks:alwayson:manager', 'info', 'projectRegistered', {
      projectId,
      projectPath,
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

  /** 是否启用 */
  isEnabled(): boolean {
    return this.enabled;
  }
}
