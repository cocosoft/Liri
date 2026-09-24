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

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:promptCache');

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

/** 消息在"缓存前缀"中的语义角色（O2-3：替代"用数组下标模拟语义"） */
export type CacheMessageRole = 'system' | 'user' | 'assistant' | 'tool';

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
   * 判断是否应该在指定消息上插入 cache_control breakpoint。
   *
   * O2-3（2026-09-24「会话暴露问题分析与优化方案」§五）两处修正：
   * 1. **纯函数**：原实现把"TTL 过期 ⇒ 写 `lastCacheTime`"混在判断里 —— 判断动作改变了
   *    后续判断结果（同一入参连续两次调用结果不同）。现由调用方在**真正插入断点**后调
   *    `noteBreakpointInserted()`；TTL 查询拆为只读的 `isTtlExpired()`。
   * 2. **语义角色替代下标**：原实现用 `messageIndex === 0` 当"system prompt 末尾"、
   *    `totalMessages - 1` 当"最后一个工具结果后" —— 消息序列一旦插入/裁剪就静默错位，
   *    且无任何断言。现由调用方显式传入 `role` 与 `isPrefixEnd`（语义契约，不是下标推断，CS02）。
   */
  shouldInsertBreakpoint(params: {
    sessionId: string;
    /** 该消息的语义角色 */
    role: CacheMessageRole;
    /** 该消息是否位于**稳定前缀**末尾（最后一个工具结果之后 / 前缀最后一条） */
    isPrefixEnd: boolean;
    /** 会话消息总数（用于 `minMessagesForCache` 门槛） */
    totalMessages: number;
  }): boolean {
    const { sessionId, role, isPrefixEnd, totalMessages } = params;
    if (!this.config.enabled) return false;
    if (totalMessages < this.config.minMessagesForCache) return false;

    // system 消息恒为前缀起点；显式标记的前缀末尾同理 —— 不再靠下标推断
    if (role === 'system' || isPrefixEnd) return true;

    return this.isTtlExpired(sessionId);
  }

  /** TTL 是否已过期（**只读**，不写状态 —— 与判断解耦，保证 `shouldInsertBreakpoint` 纯函数性） */
  isTtlExpired(sessionId: string): boolean {
    const lastTime = this.lastCacheTime.get(sessionId) ?? 0;
    return Date.now() - lastTime > this.config.ttlMs;
  }

  /** 记录"本次确实插入了断点"（副作用单独成方法，由调用方在写入后调用） */
  noteBreakpointInserted(sessionId: string): void {
    this.lastCacheTime.set(sessionId, Date.now());
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
