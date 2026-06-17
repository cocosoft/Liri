/**
 * PromptCache 管理器
 *
 * 配置 Anthropic prompt prefix caching 策略，
 * 自动在适当的边界点插入 cache_control breakpoints。
 *
 * 参考:
 *   - Anthropic Docs: prompt-caching.md
 *   - hermes agent/prompt_caching.py apply_anthropic_cache_control
 *   - openclaw prompt-cache.ts（TTL 检查 + 失效策略）
 */

import { Logger } from '@modules/monitoring/logs/Logger';

const logger = new Logger();

/** 缓存命中的统计 */
export interface CacheStats {
  /** 缓存读取 token 数 */
  cacheReadTokens: number;
  /** 缓存创建 token 数 */
  cacheCreationTokens: number;
  /** 估算成本节省 (USD) */
  estimatedSavingsUsd: number;
  /** 上一次缓存命中时间 */
  lastHitAt: number;
}

/**
 * 缓存策略配置
 */
export interface PromptCacheConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 缓存 TTL (ms) — 超过后需重新建缓存 */
  ttlMs: number;
  /** 最小消息数才启用缓存 */
  minMessagesForCache: number;
  /** input token 价格 (per 1M tokens) */
  inputPricePer1M: number;
  /** cache write token 价格 (per 1M tokens，通常是 input * 1.25) */
  cacheWritePricePer1M: number;
  /** cache read token 价格 (per 1M tokens，通常是 input * 0.1) */
  cacheReadPricePer1M: number;
}

const DEFAULT_CONFIG: PromptCacheConfig = {
  enabled: true,
  ttlMs: 5 * 60 * 1000, // 5 分钟
  minMessagesForCache: 2,
  inputPricePer1M: 3.0,
  cacheWritePricePer1M: 3.75,
  cacheReadPricePer1M: 0.3,
};

export class PromptCacheManager {
  private config: PromptCacheConfig;
  private stats: Map<string, CacheStats> = new Map();
  private lastCacheTime: Map<string, number> = new Map();

  constructor(config?: Partial<PromptCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /**
   * 判断是否应该在当前位置插入 cache_control breakpoint
   */
  shouldInsertBreakpoint(
    sessionId: string,
    messageIndex: number,
    totalMessages: number
  ): boolean {
    if (!this.config.enabled) return false;
    if (totalMessages < this.config.minMessagesForCache) return false;

    // 在 system prompt 末尾和最后一个工具结果后断点
    const isSystemPromptEnd = messageIndex === 0;
    const isLastToolResult = messageIndex === totalMessages - 1;

    // 检查 TTL 是否过期
    const lastTime = this.lastCacheTime.get(sessionId) ?? 0;
    const expired = Date.now() - lastTime > this.config.ttlMs;

    if (expired) {
      this.lastCacheTime.set(sessionId, Date.now());
    }

    return isSystemPromptEnd || isLastToolResult || expired;
  }

  /**
   * 记录缓存统计
   */
  recordCacheStats(
    sessionId: string,
    usage: {
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  ): void {
    const read = usage.cacheReadInputTokens ?? 0;
    const creation = usage.cacheCreationInputTokens ?? 0;

    if (read === 0 && creation === 0) return;

    const existing = this.stats.get(sessionId) || {
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      estimatedSavingsUsd: 0,
      lastHitAt: 0,
    };

    existing.cacheReadTokens += read;
    existing.cacheCreationTokens += creation;
    existing.lastHitAt = Date.now();

    // 估算节省：cache_read 比正常 input 便宜 90%
    const readSavings =
      (read / 1_000_000) *
      (this.config.inputPricePer1M - this.config.cacheReadPricePer1M);
    const creationCost =
      (creation / 1_000_000) * this.config.cacheWritePricePer1M;
    existing.estimatedSavingsUsd += readSavings - creationCost;

    this.stats.set(sessionId, existing);

    logger.info('Prompt cache stats', {
      sessionId,
      cacheReadTokens: read,
      cacheCreationTokens: creation,
      estimatedSavingsUsd: existing.estimatedSavingsUsd.toFixed(6),
    });
  }

  /**
   * 获取会话缓存统计
   */
  getCacheStats(sessionId: string): CacheStats | undefined {
    return this.stats.get(sessionId);
  }

  /**
   * 获取累计节省
   */
  getTotalSavings(): number {
    let total = 0;
    for (const s of this.stats.values()) {
      total += s.estimatedSavingsUsd;
    }
    return total;
  }

  /**
   * 清理过期统计数据
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, stats] of this.stats) {
      if (stats.lastHitAt < cutoff) {
        this.stats.delete(key);
        this.lastCacheTime.delete(key);
      }
    }
  }

  /** 重置会话缓存统计 */
  reset(sessionId: string): void {
    this.stats.delete(sessionId);
    this.lastCacheTime.delete(sessionId);
  }
}

/** 全局单例 */
export const promptCacheManager = new PromptCacheManager();
