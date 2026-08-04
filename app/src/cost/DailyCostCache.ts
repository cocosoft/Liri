// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 按天成本聚合缓存
 *
 * 缓存 CostRecordRepository.getDailyAggregatedCosts 的结果，
 * 减少 /v1/usage/cost/summary 等 API 的重复 SQL 查询。
 *
 * 参考 codeburn-main src/daily-cache.ts 的设计：
 *   - TTL 过期自动刷新
 *   - 手动 invalidate 强制刷新
 *   - 轻量级单例
 */

import type { CostRecordRepository } from './CostRecordRepository.js';

interface DailyEntry {
  date: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  requests: number;
}

interface CacheEntry {
  data: DailyEntry[];
  timestamp: number;
}

/** 默认缓存 TTL：60 秒 */
const DEFAULT_TTL_MS = 60_000;

class DailyCostCache {
  private cache: CacheEntry | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** 获取每日聚合数据（命中缓存直接返回） */
  async get(
    repo: CostRecordRepository,
    startTime?: number,
    endTime?: number
  ): Promise<DailyEntry[]> {
    // 缓存 key 简化：全量查询始终命中同一缓存
    // 带时间范围的查询不缓存（按需查询场景）
    if (startTime !== undefined || endTime !== undefined) {
      return repo.getDailyAggregatedCosts(startTime, endTime);
    }

    if (this.cache && Date.now() - this.cache.timestamp < this.ttlMs) {
      return this.cache.data;
    }

    const data = await repo.getDailyAggregatedCosts();
    this.cache = { data, timestamp: Date.now() };
    return data;
  }

  /** 手动失效缓存 */
  invalidate(): void {
    this.cache = null;
  }
}

let defaultCache: DailyCostCache | null = null;

export function getDailyCostCache(ttlMs?: number): DailyCostCache {
  if (!defaultCache) {
    defaultCache = new DailyCostCache(ttlMs);
  }
  return defaultCache;
}

export { DailyCostCache };
