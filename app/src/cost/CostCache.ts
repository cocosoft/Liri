/**
 * CostCacheManager — 成本计算缓存
 *
 * 基于 CacheService 实现的带 TTL 的成本计算结果缓存。
 * 避免重复计算相同模型/Token 组合的成本，提升性能。
 */

import { CacheService } from '@modules/cache/services/CacheService';
import { logForDebugging } from '../utils/debug.js';
import { calculateModelCost } from './ModelPricing.js';
import type { ICache, CacheStats } from '@modules/cache/models/types';

interface CostCacheKey {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  webSearchRequests?: number;
  isFastMode?: boolean;
}

export class CostCacheManager implements ICache<string, number> {
  /** 基于 CacheService 的内存缓存，TTL 默认 5 分钟 */
  private cache: CacheService<number>;
  private maxCacheSize: number = 1000;
  private defaultTTL: number = 5 * 60 * 1000;

  constructor() {
    this.cache = new CacheService<number>({
      maxSize: this.maxCacheSize,
      defaultTTL: this.defaultTTL,
      cleanupInterval: 60_000,
    });
  }

  private generateCacheKey(key: CostCacheKey): string {
    return JSON.stringify({
      modelName: key.modelName,
      inputTokens: key.inputTokens,
      outputTokens: key.outputTokens,
      cacheReadTokens: key.cacheReadTokens ?? 0,
      cacheCreationTokens: key.cacheCreationTokens ?? 0,
      webSearchRequests: key.webSearchRequests ?? 0,
      isFastMode: key.isFastMode ?? false,
    });
  }

  get(key: string): number | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, value: number, ttl?: number): void {
    this.cache.set(key, value, ttl ?? this.defaultTTL);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    logForDebugging('成本缓存已清空');
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  size(): number {
    return this.cache.size();
  }

  getStats(): CacheStats {
    return this.cache.getStats();
  }

  getCacheStats(): CacheStats {
    return this.getStats();
  }

  getCachedCost(key: CostCacheKey): number | null {
    const cacheKey = this.generateCacheKey(key);
    return this.get(cacheKey);
  }

  cacheCost(key: CostCacheKey, cost: number, ttl?: number): void {
    const cacheKey = this.generateCacheKey(key);
    this.set(cacheKey, cost, ttl);
    logForDebugging('成本已缓存', {
      modelName: key.modelName,
      cost,
      ttl: ttl ?? this.defaultTTL,
    });
  }

  getOrCalculateCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
    webSearchRequests: number = 0,
    isFastMode: boolean = false
  ): number {
    const key: CostCacheKey = {
      modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      webSearchRequests,
      isFastMode,
    };

    const cached = this.getCachedCost(key);
    if (cached !== null) {
      return cached;
    }

    const cost = calculateModelCost(
      modelName,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      webSearchRequests,
      isFastMode
    );

    this.cacheCost(key, cost);
    return cost;
  }

  /** 清理过期缓存（委托给 CacheService） */
  cleanup(): number {
    const stats = this.cache.getStats();
    this.cache.cleanup();
    const newStats = this.cache.getStats();
    return newStats.cleanups - stats.cleanups;
  }

  getCacheStatsInfo(): {
    size: number;
    maxSize: number;
    totalHits: number;
  } {
    const stats = this.cache.getStats();
    return {
      size: stats.size,
      maxSize: this.maxCacheSize,
      totalHits: stats.hits,
    };
  }

  setMaxCacheSize(size: number): void {
    this.maxCacheSize = size;
    logForDebugging('缓存最大大小已更新', { maxSize: size });
  }

  setDefaultTTL(ttlMs: number): void {
    this.defaultTTL = ttlMs;
    logForDebugging('默认缓存TTL已更新', { ttlMs });
  }
}

export const costCacheManager = new CostCacheManager();
