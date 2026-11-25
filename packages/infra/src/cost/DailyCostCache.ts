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

/**
 * 缓存 TTL（**安全网**，不是新鲜度来源）。
 *
 * 新鲜度由写路径保证：`cost/index.ts` 的 `COST_RECORDED` 订阅者在落库后立即
 * `getDailyCostCache().invalidate()` ⇒ 有新成本就一定重算。
 *
 * 2026-11-26（真机 263k 行 / 23.5 万次请求）：该聚合走覆盖索引仍要扫全部 `owner_key`
 * 行并建临时 B-Tree，实测 **210–240ms 同步阻塞事件循环**；前端 Footer 每 5s 轮询
 * `/v1/usage/cost/summary`，旧 TTL=60s ⇒ 空闲时也**每分钟**触发一次全量扫描
 * （日志 `sqlite3:慢查询 all` 每分钟一条）。既然写路径已精确失效，TTL 只需兜底
 * 绕过失效的写入面 ⇒ 放宽到 5 分钟（空闲扫描降 5 倍，数据最多滞后一个 TTL）。
 */
const DAILY_COST_CACHE_TTL_MS = 5 * 60_000;

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
