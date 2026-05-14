/**
 * ActivationContext 激活上下文管理器
 * 对标 OpenClaw 的 activation-context/，管理插件激活时的上下文信息
 */

/**
 * 激活原因
 */
export type ActivationReason = 'startup' | 'install' | 'manual' | 'dependency' | 'reload' | 'config_change';

/**
 * 激活上下文
 */
export interface ActivationContext {
  pluginName: string;
  reason: ActivationReason;
  timestamp: number;
  triggeredBy?: string;
  config?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  previousState?: string;
}

/**
 * 激活上下文管理器
 */
export class ActivationContextManager {
  private contexts: Map<string, ActivationContext> = new Map();
  private history: ActivationContext[] = [];
  private maxHistory: number = 100;

  /**
   * 创建激活上下文
   */
  create(
    pluginName: string,
    reason: ActivationReason,
    options?: {
      triggeredBy?: string;
      config?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      previousState?: string;
    }
  ): ActivationContext {
    const context: ActivationContext = {
      pluginName,
      reason,
      timestamp: Date.now(),
      triggeredBy: options?.triggeredBy,
      config: options?.config,
      metadata: options?.metadata,
      previousState: options?.previousState,
    };

    this.contexts.set(pluginName, context);
    this.history.push(context);

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return context;
  }

  /**
   * 获取当前上下文
   */
  get(pluginName: string): ActivationContext | undefined {
    return this.contexts.get(pluginName);
  }

  /**
   * 移除上下文
   */
  remove(pluginName: string): boolean {
    return this.contexts.delete(pluginName);
  }

  /**
   * 获取历史记录
   */
  getHistory(limit?: number): ActivationContext[] {
    if (limit && limit > 0) {
      return this.history.slice(-limit);
    }

    return [...this.history];
  }

  /**
   * 按原因过滤历史
   */
  getByReason(reason: ActivationReason): ActivationContext[] {
    return this.history.filter((c) => c.reason === reason);
  }

  /**
   * 获取统计
   */
  getStats(): { active: number; totalHistory: number; byReason: Record<string, number> } {
    const byReason: Record<string, number> = {};

    for (const ctx of this.history) {
      byReason[ctx.reason] = (byReason[ctx.reason] || 0) + 1;
    }

    return {
      active: this.contexts.size,
      totalHistory: this.history.length,
      byReason,
    };
  }

  /**
   * 清理过期上下文
   */
  cleanExpired(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let count = 0;

    for (const [name, ctx] of this.contexts.entries()) {
      if (now - ctx.timestamp > maxAgeMs) {
        this.contexts.delete(name);
        count++;
      }
    }

    return count;
  }
}

export const activationContextManager = new ActivationContextManager();
