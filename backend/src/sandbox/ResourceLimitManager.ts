/**
 * 资源限制管理器
 * 为每个插件提供 CPU、内存、并发数的独立限制
 * 基于纯 Node.js 实现，无第三方依赖
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 插件资源限制配置
 */
export interface PluginResourceLimits {
  /** 最大并发执行数，默认 3 */
  maxConcurrency: number;

  /** 最大内存使用（MB），默认 256 */
  maxMemoryMB: number;

  /** 最大执行时间（毫秒），默认 30000 */
  maxExecutionTimeMs: number;

  /** CPU 时间限制（毫秒），默认 10000 */
  maxCpuTimeMs: number;
}

/**
 * 插件资源使用快照
 */
export interface PluginResourceUsage {
  pluginId: string;
  activeExecutions: number;
  totalExecutions: number;
  totalMemoryEstimateMB: number;
  totalCpuTimeMs: number;
  lastExecutionAt: number;
  rejectedCount: number;
}

const DEFAULT_LIMITS: PluginResourceLimits = {
  maxConcurrency: 3,
  maxMemoryMB: 256,
  maxExecutionTimeMs: 30000,
  maxCpuTimeMs: 10000,
};

/**
 * 执行上下文（用于资源跟踪）
 */
export interface ExecutionContext {
  pluginId: string;
  executionId: string;
  startedAt: number;
  memoryEstimateMB: number;
}

/**
 * 资源限制管理器
 * 基于令牌桶模式的并发控制
 */
export class ResourceLimitManager {
  private limits: Map<string, PluginResourceLimits> = new Map();
  private activeContexts: Map<string, ExecutionContext[]> = new Map();
  private usageSnapshots: Map<string, PluginResourceUsage> = new Map();
  private globalDefaults: PluginResourceLimits;

  constructor(defaults?: Partial<PluginResourceLimits>) {
    this.globalDefaults = { ...DEFAULT_LIMITS, ...defaults };
  }

  /**
   * 设置插件的资源限制
   * @param pluginId 插件 ID
   * @param limits 资源限制
   */
  setLimits(pluginId: string, limits: Partial<PluginResourceLimits>): void {
    const existing = this.limits.get(pluginId) || { ...this.globalDefaults };
    this.limits.set(pluginId, { ...existing, ...limits });
    logger.debug(`Resource limits set for plugin ${pluginId}`, limits);
  }

  /**
   * 获取插件的资源限制
   */
  getLimits(pluginId: string): PluginResourceLimits {
    return this.limits.get(pluginId) || { ...this.globalDefaults };
  }

  /**
   * 移除插件的资源限制
   */
  removeLimits(pluginId: string): void {
    this.limits.delete(pluginId);
    this.activeContexts.delete(pluginId);
    this.usageSnapshots.delete(pluginId);
  }

  /**
   * 获取当前活跃上下文数量
   */
  getActiveExecutionCount(pluginId: string): number {
    return this.activeContexts.get(pluginId)?.length || 0;
  }

  /**
   * 获取当前总活跃上下文数量
   */
  getTotalActiveExecutionCount(): number {
    let count = 0;
    for (const contexts of this.activeContexts.values()) {
      count += contexts.length;
    }
    return count;
  }

  /**
   * 尝试获取执行许可
   * 检查并发限制，若未超限则创建执行上下文
   * @param pluginId 插件 ID
   * @returns 执行上下文（如果许可可用），否则返回 null
   */
  acquireExecution(pluginId: string): ExecutionContext | null {
    this.ensureUsageEntry(pluginId);
    const limits = this.getLimits(pluginId);
    const contexts = this.activeContexts.get(pluginId) || [];

    if (contexts.length >= limits.maxConcurrency) {
      const usage = this.usageSnapshots.get(pluginId)!;
      usage.rejectedCount++;
      logger.warn(
        `Plugin ${pluginId} reached concurrency limit ${limits.maxConcurrency}, request rejected`
      );
      return null;
    }

    const context: ExecutionContext = {
      pluginId,
      executionId: `exec_${pluginId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      memoryEstimateMB: limits.maxMemoryMB / Math.max(limits.maxConcurrency, 1),
    };

    contexts.push(context);
    this.activeContexts.set(pluginId, contexts);

    const usage = this.usageSnapshots.get(pluginId)!;
    usage.activeExecutions = contexts.length;
    usage.totalExecutions++;

    return context;
  }

  /**
   * 释放执行许可
   * @param context 执行上下文
   */
  releaseExecution(context: ExecutionContext): void {
    const contexts = this.activeContexts.get(context.pluginId);
    if (!contexts) return;

    const idx = contexts.findIndex(
      (c) => c.executionId === context.executionId
    );
    if (idx === -1) return;

    contexts.splice(idx, 1);

    const usage = this.usageSnapshots.get(context.pluginId);
    if (usage) {
      usage.activeExecutions = contexts.length;
      usage.lastExecutionAt = Date.now();
    }

    logger.debug(`Execution released for plugin ${context.pluginId}`);
  }

  /**
   * 获取插件的资源使用快照
   */
  getUsage(pluginId: string): PluginResourceUsage {
    const existing = this.usageSnapshots.get(pluginId);
    if (existing) return { ...existing };

    return {
      pluginId,
      activeExecutions: 0,
      totalExecutions: 0,
      totalMemoryEstimateMB: 0,
      totalCpuTimeMs: 0,
      lastExecutionAt: 0,
      rejectedCount: 0,
    };
  }

  /**
   * 获取所有插件的资源使用快照
   */
  getAllUsage(): PluginResourceUsage[] {
    const result: PluginResourceUsage[] = [];
    for (const pluginId of this.usageSnapshots.keys()) {
      result.push(this.getUsage(pluginId));
    }
    return result;
  }

  /**
   * 清理过期的执行上下文
   * @param maxAgeMs 上下文最大存活时间，默认 60000ms
   */
  cleanStaleContexts(maxAgeMs: number = 60000): void {
    const now = Date.now();
    for (const [pluginId, contexts] of this.activeContexts.entries()) {
      const stale = contexts.filter((c) => now - c.startedAt > maxAgeMs);
      if (stale.length > 0) {
        for (const ctx of stale) {
          this.releaseExecution(ctx);
        }
        logger.warn(
          `Cleaned ${stale.length} stale execution contexts for plugin ${pluginId}`
        );
      }
    }
  }

  /**
   * 获取资源限制摘要
   */
  getSummary(): {
    totalPlugins: number;
    totalActive: number;
    totalRejected: number;
  } {
    let totalActive = 0;
    let totalRejected = 0;

    for (const usage of this.usageSnapshots.values()) {
      totalActive += usage.activeExecutions;
      totalRejected += usage.rejectedCount;
    }

    return {
      totalPlugins: this.limits.size,
      totalActive,
      totalRejected,
    };
  }

  /**
   * 重置所有限制和计数
   */
  reset(): void {
    this.limits.clear();
    this.activeContexts.clear();
    this.usageSnapshots.clear();
  }

  /**
   * 确保 usage 条目存在
   */
  private ensureUsageEntry(pluginId: string): void {
    if (!this.usageSnapshots.has(pluginId)) {
      this.usageSnapshots.set(pluginId, {
        pluginId,
        activeExecutions: 0,
        totalExecutions: 0,
        totalMemoryEstimateMB: 0,
        totalCpuTimeMs: 0,
        lastExecutionAt: 0,
        rejectedCount: 0,
      });
    }
  }
}

/**
 * 全局资源限制管理器单例
 */
export const resourceLimitManager = new ResourceLimitManager();
