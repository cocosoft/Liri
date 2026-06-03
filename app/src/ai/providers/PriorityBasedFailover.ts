// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 基于优先级的故障转移引擎
 *
 * 从 ProviderManager 读取用户已保存的供应商列表，按优先级构建故障转移链。
 * 当主力供应商不可用时，自动依次尝试备用供应商。
 *
 * 对标 CC 源码 cc-switch/src-tauri/src/proxy/failover_switch.rs
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { AIProvider, ChatOptions } from './AIProvider';
import { providerRegistry } from './ProviderRegistry';
import type { ProviderRecord } from './ProviderManager';
import { UsageTracker } from '../UsageTracker.js';

const logger = new Logger({ level: LogLevel.INFO });

/** 故障转移配置 */
export interface FailoverConfig {
  /** 最大重试次数（备用供应商数量） */
  maxRetries: number;
  /** 基础退避时间 ms */
  backoffMs: number;
  /** 最大退避时间 ms */
  maxBackoffMs: number;
  /** 抖动因子 0-1 */
  jitterFactor: number;
}

const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  maxRetries: 3,
  backoffMs: 1000,
  maxBackoffMs: 30000,
  jitterFactor: 0.1,
};

/** 故障转移事件 */
export interface FailoverEvent {
  reason: string;
  fromProviderId: string;
  toProviderId: string;
  errorMessage: string;
  timestamp: number;
}

/** 健康状态缓存 */
interface HealthRecord {
  lastCheck: number;
  isHealthy: boolean;
  consecutiveFailures: number;
  cooldownUntil: number;
}

/**
 * 基于优先级的故障转移引擎
 *
 * 从 DB 动态读取供应商列表，按 sortIndex 排序构建优先级链。
 */
export class PriorityBasedFailover {
  private config: FailoverConfig;
  private health: Map<string, HealthRecord> = new Map();
  private events: FailoverEvent[] = [];

  constructor(config?: Partial<FailoverConfig>) {
    this.config = { ...DEFAULT_FAILOVER_CONFIG, ...config };
  }

  /** 获取故障转移事件历史 */
  getEvents(): FailoverEvent[] {
    return [...this.events];
  }

  /** 获取所有健康状态 */
  getHealth(): Map<string, HealthRecord> {
    return new Map(this.health);
  }

  /** 为供应商记录一次失败 */
  private recordFailure(providerId: string): void {
    const record = this.getOrCreateHealthRecord(providerId);
    record.consecutiveFailures++;
    record.isHealthy = false;
    record.cooldownUntil =
      Date.now() + this.calculateBackoff(record.consecutiveFailures);
  }

  /** 为供应商记录一次成功 */
  private recordSuccess(providerId: string): void {
    const record = this.getOrCreateHealthRecord(providerId);
    record.consecutiveFailures = 0;
    record.isHealthy = true;
    record.lastCheck = Date.now();
    record.cooldownUntil = 0;
  }

  /** 检查供应商是否可用 */
  private isProviderAvailable(record: HealthRecord): boolean {
    if (!record.isHealthy && record.cooldownUntil > Date.now()) {
      return false;
    }
    return true;
  }

  private getOrCreateHealthRecord(providerId: string): HealthRecord {
    if (!this.health.has(providerId)) {
      this.health.set(providerId, {
        lastCheck: 0,
        isHealthy: true,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      });
    }
    return this.health.get(providerId)!;
  }

  /** 计算退避延迟（含抖动） */
  private calculateBackoff(failures: number): number {
    const base = Math.min(
      this.config.backoffMs * Math.pow(2, failures - 1),
      this.config.maxBackoffMs
    );
    const jitter = base * this.config.jitterFactor * (Math.random() * 2 - 1);
    return Math.round(base + jitter);
  }

  /**
   * 获取排序后的活跃供应商ID列表
   */
  private async getActiveProviderIds(): Promise<string[]> {
    try {
      const { providerManager } = await import('./ProviderManager.js');
      await providerManager.initialize();
      const providers = await providerManager.listProviders({ isActive: true });
      // 按 sortIndex 排序
      return providers
        .sort((a, b) => a.sortIndex - b.sortIndex)
        .map((p) => p.id);
    } catch (err) {
      logger.warning('获取供应商列表失败，使用默认Provider', {
        error: (err as Error).message,
      });
      return [];
    }
  }

  /**
   * 构建故障转移调用链
   *
   * 依次尝试供应商，直至成功或超出 maxRetries。
   * 每次调用后报告执行结果（成功/失败），由引擎决定是否继续尝试下一个。
   */
  async executeWithFailover<T>(
    /** 调用函数：(providerId, model) → 结果 */
    fn: (providerId: string, model: string) => Promise<T>,
    model: string,
    primaryProviderId?: string
  ): Promise<{ result: T; providerId: string }> {
    const activeIds = await this.getActiveProviderIds();

    // 构建优先级队列：首选指定的 primaryProviderId，然后按 sortIndex 排序
    let candidates: string[];

    if (primaryProviderId && activeIds.includes(primaryProviderId)) {
      candidates = [
        primaryProviderId,
        ...activeIds.filter((id) => id !== primaryProviderId),
      ];
    } else if (primaryProviderId) {
      // primary 不在 DB 中，但也尝试
      candidates = [primaryProviderId, ...activeIds];
    } else {
      candidates = [...activeIds];
    }

    if (candidates.length === 0) {
      throw new Error('没有可用的供应商');
    }

    const maxAttempts = Math.min(candidates.length, this.config.maxRetries + 1);

    let lastError: Error | undefined;

    for (let i = 0; i < maxAttempts; i++) {
      const providerId = candidates[i];
      const record = this.getOrCreateHealthRecord(providerId);

      if (!this.isProviderAvailable(record)) {
        logger.debug(`跳过不健康的供应商: ${providerId}`);
        continue;
      }

      try {
        const result = await fn(providerId, model);
        this.recordSuccess(providerId);

        if (i > 0) {
          // 发生了故障转移
          this.events.push({
            reason: 'primary_failed',
            fromProviderId: candidates[0],
            toProviderId: providerId,
            errorMessage: lastError?.message || 'unknown',
            timestamp: Date.now(),
          });
        }

        return { result, providerId };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.recordFailure(providerId);

        if (i > 0) {
          this.events.push({
            reason: 'failover_failed',
            fromProviderId: candidates[i - 1],
            toProviderId: providerId,
            errorMessage: lastError.message,
            timestamp: Date.now(),
          });
        }

        logger.warning(`供应商 ${providerId} 调用失败`, {
          error: lastError.message,
        });
      }
    }

    throw new Error(
      `所有供应商均调用失败 (${maxAttempts} 次尝试): ${lastError?.message}`
    );
  }

  /** 重置所有健康状态 */
  resetHealth(): void {
    this.health.clear();
    this.events = [];
    logger.info('故障转移引擎: 健康状态已重置');
  }
}

/** 导出单例 */
export const priorityFailover = new PriorityBasedFailover();
