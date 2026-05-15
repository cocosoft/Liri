/**
 * SandboxPruner 沙箱回收器
 * 定期清理过期/闲置的沙箱实例，释放系统资源
 * 对标 OpenClaw agents/sandbox/pruner.ts
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 沙箱实例信息
 */
export interface SandboxInstance {
  id: string;
  type: 'docker' | 'pty' | 'ssh';
  createdAt: number;
  lastActiveAt: number;
  idleTimeoutMs: number;
  maxLifetimeMs: number;
  label?: string;
}

/**
 * 回收结果
 */
export interface PruneResult {
  removedCount: number;
  removedIds: string[];
  remainingCount: number;
  durationMs: number;
}

/**
 * 沙箱回收策略
 */
export interface PruneStrategy {
  /** 闲置超时（毫秒） */
  idleTimeoutMs: number;
  /** 最大生命周期（毫秒），0 表示不限制 */
  maxLifetimeMs: number;
  /** 是否回收已断开连接的沙箱 */
  pruneDisconnected: boolean;
}

const DEFAULT_STRATEGY: PruneStrategy = {
  idleTimeoutMs: 30 * 60 * 1000,
  maxLifetimeMs: 24 * 60 * 60 * 1000,
  pruneDisconnected: true,
};

/**
 * 沙箱回收器
 */
export class SandboxPruner {
  private strategy: PruneStrategy;
  private instances: Map<string, SandboxInstance>;
  private intervalId: ReturnType<typeof setInterval> | null;
  private intervalMs: number;
  private running: boolean;

  /**
   * @param strategy 回收策略
   * @param intervalMs 检查间隔（毫秒），默认 5 分钟
   */
  constructor(strategy?: Partial<PruneStrategy>, intervalMs: number = 5 * 60 * 1000) {
    this.strategy = { ...DEFAULT_STRATEGY, ...strategy };
    this.instances = new Map();
    this.intervalId = null;
    this.intervalMs = intervalMs;
    this.running = false;
  }

  /**
   * 注册沙箱实例
   */
  register(instance: SandboxInstance): void {
    this.instances.set(instance.id, instance);
    logger.info(`沙箱已注册: ${instance.id} (${instance.type})`);
  }

  /**
   * 注销沙箱实例
   */
  unregister(id: string): boolean {
    const existed = this.instances.delete(id);
    if (existed) {
      logger.info(`沙箱已注销: ${id}`);
    }
    return existed;
  }

  /**
   * 更新沙箱活跃时间
   */
  touch(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    instance.lastActiveAt = Date.now();
    return true;
  }

  /**
   * 获取指定沙箱实例
   */
  get(id: string): SandboxInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * 获取所有沙箱实例
   */
  getAll(): SandboxInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 获取统计数据
   */
  getStats(): { total: number; byType: Record<string, number>; idleCount: number } {
    const byType: Record<string, number> = {};

    let idleCount = 0;
    const now = Date.now();

    for (const inst of this.instances.values()) {
      byType[inst.type] = (byType[inst.type] || 0) + 1;
      if (now - inst.lastActiveAt > this.strategy.idleTimeoutMs) {
        idleCount++;
      }
    }

    return {
      total: this.instances.size,
      byType,
      idleCount,
    };
  }

  /**
   * 执行一次回收
   */
  prune(): PruneResult {
    const startTime = Date.now();
    const removedIds: string[] = [];
    const now = Date.now();

    for (const [id, instance] of this.instances.entries()) {
      let shouldRemove = false;
      let reason = '';

      const idleTime = now - instance.lastActiveAt;
      const lifetime = now - instance.createdAt;

      if (this.strategy.pruneDisconnected && idleTime > instance.idleTimeoutMs) {
        if (instance.idleTimeoutMs > 0 && idleTime > instance.idleTimeoutMs) {
          shouldRemove = true;
          reason = `闲置超时 (${idleTime}ms > ${instance.idleTimeoutMs}ms)`;
        }
      }

      if (!shouldRemove && instance.maxLifetimeMs > 0 && lifetime > instance.maxLifetimeMs) {
        shouldRemove = true;
        reason = `生命周期超限 (${lifetime}ms > ${instance.maxLifetimeMs}ms)`;
      }

      if (!shouldRemove && this.strategy.maxLifetimeMs > 0 && lifetime > this.strategy.maxLifetimeMs) {
        shouldRemove = true;
        reason = `全局生命周期超限 (${lifetime}ms > ${this.strategy.maxLifetimeMs}ms)`;
      }

      if (!shouldRemove && idleTime > this.strategy.idleTimeoutMs) {
        shouldRemove = true;
        reason = `全局闲置超时 (${idleTime}ms > ${this.strategy.idleTimeoutMs}ms)`;
      }

      if (shouldRemove) {
        this.instances.delete(id);
        removedIds.push(id);
        logger.info(`沙箱已回收: ${id} - ${reason}`);
      }
    }

    return {
      removedCount: removedIds.length,
      removedIds,
      remainingCount: this.instances.size,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 启动定期回收
   */
  start(): void {
    if (this.running) return;

    this.running = true;
    this.intervalId = setInterval(() => {
      const result = this.prune();
      if (result.removedCount > 0) {
        logger.info(`回收完成: ${result.removedCount} 个沙箱已清理，剩余 ${result.remainingCount} 个`);
      }
    }, this.intervalMs);

    logger.info(`沙箱回收器已启动，间隔: ${this.intervalMs}ms`);
  }

  /**
   * 停止定期回收
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    logger.info('沙箱回收器已停止');
  }

  /**
   * 获取运行状态
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * 清空所有沙箱
   */
  clearAll(): void {
    const count = this.instances.size;
    this.instances.clear();
    logger.info(`所有沙箱已清空: ${count} 个实例已移除`);
  }
}
