// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 成本概览聚合缓存
 *
 * 缓存 `CostRecordRepository.getDailyModelAggregatedCosts()`（「按天 + 按模型」）的结果，
 * 减少 `/api/cost/summary`、`/v1/usage/cost/summary` 等接口的重复 SQL 查询。
 *
 * C3-3（2026-11-04）：此前缓存的是「按天（不含模型）」聚合，而其**唯一调用点**传了 `startTime`
 * ⇒ 按本类原有语义（带范围不缓存）永远命中不了；概览于是每打开一次就把 20 万行的表扫 9 遍。
 * 现在改为缓存**无范围**的那一次聚合，由调用方按日桶切窗口 ⇒ 缓存真正生效且只剩一次扫描。
 */

import type { CostRecordRepository, DailyModelCost } from './CostRecordRepository.js';

interface CacheEntry {
  data: DailyModelCost[];
  timestamp: number;
}

/** 默认缓存 TTL：60 秒 */
const DAILY_COST_CACHE_TTL_MS = 60_000;

class DailyCostCache {
  private cache: CacheEntry | null = null;
  private ttlMs: number;

  constructor(ttlMs: number = DAILY_COST_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /** 获取「按天 + 按模型」聚合（命中缓存直接返回） */
  async get(repo: CostRecordRepository): Promise<DailyModelCost[]> {
    if (this.cache && Date.now() - this.cache.timestamp < this.ttlMs) {
      return this.cache.data;
    }

    const data = await repo.getDailyModelAggregatedCosts();
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
