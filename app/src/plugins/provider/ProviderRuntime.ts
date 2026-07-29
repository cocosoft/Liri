/**
 * ProviderRuntime 提供者运行时
 * 管理提供者的运行时状态和执行环境
 */
import type {
  ProviderMetadata,
  ProviderCapability,
} from './ProviderCatalog.js';
import type { ProviderCredentials } from './ProviderAuth.js';

import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:provider:ProviderRuntime',
  level: LogLevel.INFO,
});

/**
 * 运行时状态
 */
export interface RuntimeStatus {
  providerId: string;
  initialized: boolean;
  active: boolean;
  lastPing: number;
  errorCount: number;
  requestCount: number;
  avgResponseTime: number;
}

/**
 * 运行时选项
 */
export interface RuntimeOptions {
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  enableMetrics: boolean;
}

/**
 * 运行时事件
 */
export interface RuntimeEvent {
  type: 'initialized' | 'ready' | 'error' | 'degraded' | 'shutdown';
  providerId: string;
  timestamp: number;
  message?: string;
}

/**
 * 提供者运行时管理器
 */
export class ProviderRuntime {
  private statuses: Map<string, RuntimeStatus> = new Map();
  private options: Map<string, RuntimeOptions> = new Map();
  private eventListeners: Array<(event: RuntimeEvent) => void> = [];

  /**
   * 初始化提供者运行时
   */
  initialize(
    provider: ProviderMetadata,
    options?: Partial<RuntimeOptions>
  ): void {
    const defaultOptions: RuntimeOptions = {
      timeout: 30000,
      maxRetries: 3,
      retryDelay: 1000,
      enableMetrics: true,
    };

    this.options.set(provider.id, { ...defaultOptions, ...options });

    this.statuses.set(provider.id, {
      providerId: provider.id,
      initialized: true,
      active: true,
      lastPing: Date.now(),
      errorCount: 0,
      requestCount: 0,
      avgResponseTime: 0,
    });

    this.emitEvent({
      type: 'initialized',
      providerId: provider.id,
      timestamp: Date.now(),
    });

    this.emitEvent({
      type: 'ready',
      providerId: provider.id,
      timestamp: Date.now(),
    });
  }

  /**
   * 关闭提供者运行时
   */
  shutdown(providerId: string): void {
    const status = this.statuses.get(providerId);
    if (status) {
      status.active = false;
      this.emitEvent({
        type: 'shutdown',
        providerId,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 获取运行时状态
   */
  getStatus(providerId: string): RuntimeStatus | undefined {
    return this.statuses.get(providerId);
  }

  /**
   * 获取运行时选项
   */
  getOptions(providerId: string): RuntimeOptions | undefined {
    return this.options.get(providerId);
  }

  /**
   * 记录请求
   */
  recordRequest(providerId: string, duration: number, success: boolean): void {
    const status = this.statuses.get(providerId);
    if (!status || !status.active) return;

    status.requestCount++;
    status.lastPing = Date.now();

    if (!success) {
      status.errorCount++;
    }

    status.avgResponseTime = Math.round(
      (status.avgResponseTime * (status.requestCount - 1) + duration) /
        status.requestCount
    );
  }

  /**
   * 检查提供者是否可用
   */
  isAvailable(providerId: string): boolean {
    const status = this.statuses.get(providerId);
    if (!status) return false;
    if (!status.active || !status.initialized) return false;
    if (status.errorCount > 10) return false;
    return true;
  }

  /**
   * 获取所有运行时提供者
   */
  getActiveProviders(): string[] {
    return Array.from(this.statuses.entries())
      .filter(([, s]) => s.active && s.initialized)
      .map(([id]) => id);
  }

  /**
   * 添加运行时事件监听
   */
  addEventListener(listener: (event: RuntimeEvent) => void): void {
    this.eventListeners.push(listener);
  }

  /**
   * 移除运行时事件监听
   */
  removeEventListener(listener: (event: RuntimeEvent) => void): void {
    this.eventListeners = this.eventListeners.filter((l) => l !== listener);
  }

  /**
   * 获取健康状态
   */
  getHealthSummary(): {
    healthy: number;
    degraded: number;
    down: number;
    total: number;
  } {
    let healthy = 0;
    let degraded = 0;
    let down = 0;

    for (const status of this.statuses.values()) {
      if (!status.active) {
        down++;
      } else if (status.errorCount > 5) {
        degraded++;
      } else {
        healthy++;
      }
    }

    return {
      healthy,
      degraded,
      down,
      total: this.statuses.size,
    };
  }

  /**
   * 触发运行时事件
   */
  private emitEvent(event: RuntimeEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        // 忽略监听器错误

        handleError(err, {
          module: 'plugins:provider',
          action: 'notifyEventListener',
        });
      }
    }
  }
}

export const providerRuntime = new ProviderRuntime();
