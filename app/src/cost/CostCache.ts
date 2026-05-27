import { logForDebugging } from '../utils/debug.js';
import { calculateModelCost } from './ModelPricing.js';
import type { ICache, CacheStats } from '@modules/cache/models/types';

interface CacheEntry<T> {
  value: T;
  expireAt: number;
  hitCount: number;
  createdAt: number;
}

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
  private costCache: Map<string, CacheEntry<number>> = new Map();
  private maxCacheSize: number = 1000;
  private defaultTTL: number = 5 * 60 * 1000;

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
    const entry = this.costCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expireAt) {
      this.costCache.delete(key);
      return null;
    }

    entry.hitCount++;
    return entry.value;
  }

  set(key: string, value: number, ttl?: number): void {
    this.cleanupIfNeeded();
    const expireAt = Date.now() + (ttl ?? this.defaultTTL);
    this.costCache.set(key, {
      value,
      expireAt,
      hitCount: 0,
      createdAt: Date.now(),
    });
  }

  delete(key: string): boolean {
    const existed = this.costCache.has(key);
    this.costCache.delete(key);
    return existed;
  }

  clear(): void {
    this.costCache.clear();
    logForDebugging('成本缓存已清空');
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  size(): number {
    return this.costCache.size;
  }

  getStats(): CacheStats {
    let totalHits = 0;
    for (const entry of this.costCache.values()) {
      totalHits += entry.hitCount;
    }
    return {
      size: this.costCache.size,
      hits: totalHits,
      misses: 0,
      expirations: 0,
      cleanups: 0,
    };
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

  cleanup(): number {
    let removedCount = 0;
    const now = Date.now();

    for (const [key, entry] of this.costCache.entries()) {
      if (now > entry.expireAt) {
        this.costCache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logForDebugging('已清理过期缓存', { removedCount });
    }

    return removedCount;
  }

  private cleanupIfNeeded(): void {
    if (this.costCache.size <= this.maxCacheSize) {
      return;
    }

    const removed = this.cleanup();
    if (this.costCache.size <= this.maxCacheSize) {
      return;
    }

    const entries = Array.from(this.costCache.entries()).sort(
      (a, b) => a[1].hitCount - b[1].hitCount
    );

    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
    for (const [key] of toRemove) {
      this.costCache.delete(key);
    }

    logForDebugging('已清理低命中缓存', { removedCount: toRemove.length });
  }

  getCacheStatsInfo(): {
    size: number;
    maxSize: number;
    totalHits: number;
  } {
    let totalHits = 0;
    for (const entry of this.costCache.values()) {
      totalHits += entry.hitCount;
    }

    return {
      size: this.costCache.size,
      maxSize: this.maxCacheSize,
      totalHits,
    };
  }

  setMaxCacheSize(size: number): void {
    this.maxCacheSize = size;
    this.cleanupIfNeeded();
    logForDebugging('缓存最大大小已更新', { maxSize: size });
  }

  setDefaultTTL(ttlMs: number): void {
    this.defaultTTL = ttlMs;
    logForDebugging('默认缓存TTL已更新', { ttlMs });
  }
}

export const costCacheManager = new CostCacheManager();
