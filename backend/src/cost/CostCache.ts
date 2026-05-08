//
/**
 * 成本缓存模块
 * 用于缓存常用的成本计算结果，提升性能
 */

import { logForDebugging } from '../utils/debug.js';
import { calculateModelCost } from './ModelPricing.js';

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  /** 缓存的值 */
  value: T;
  /** 过期时间戳 */
  expireAt: number;
  /** 命中次数 */
  hitCount: number;
  /** 创建时间 */
  createdAt: number;
}

/**
 * 成本缓存键
 */
interface CostCacheKey {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  webSearchRequests?: number;
  isFastMode?: boolean;
}

/**
 * 成本缓存管理器
 */
export class CostCacheManager {
  private costCache: Map<string, CacheEntry<number>> = new Map();
  private maxCacheSize: number = 1000;
  private defaultTTL: number = 5 * 60 * 1000; // 默认5分钟过期

  /**
   * 生成缓存键
   */
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

  /**
   * 获取缓存的成本
   */
  getCachedCost(key: CostCacheKey): number | null {
    const cacheKey = this.generateCacheKey(key);
    const entry = this.costCache.get(cacheKey);

    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expireAt) {
      this.costCache.delete(cacheKey);
      return null;
    }

    entry.hitCount++;
    logForDebugging('缓存命中', {
      modelName: key.modelName,
      hitCount: entry.hitCount,
    });

    return entry.value;
  }

  /**
   * 缓存成本计算结果
   */
  cacheCost(key: CostCacheKey, cost: number, ttl?: number): void {
    this.cleanupIfNeeded();

    const cacheKey = this.generateCacheKey(key);
    const expireAt = Date.now() + (ttl ?? this.defaultTTL);

    this.costCache.set(cacheKey, {
      value: cost,
      expireAt,
      hitCount: 0,
      createdAt: Date.now(),
    });

    logForDebugging('成本已缓存', {
      modelName: key.modelName,
      cost,
      ttl: ttl ?? this.defaultTTL,
    });
  }

  /**
   * 计算并缓存成本
   */
  getOrCalculateCost(
    modelName: string,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number = 0,
    cacheCreationTokens: number = 0,
    webSearchRequests: number = 0,
    isFastMode: boolean = false,
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
      isFastMode,
    );

    this.cacheCost(key, cost);
    return cost;
  }

  /**
   * 清理过期缓存
   */
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

  /**
   * 如果缓存过大，清理过期和最久未使用的缓存
   */
  private cleanupIfNeeded(): void {
    if (this.costCache.size <= this.maxCacheSize) {
      return;
    }

    // 先清理过期缓存
    const removed = this.cleanup();
    if (this.costCache.size <= this.maxCacheSize) {
      return;
    }

    // 仍然过大，移除命中次数最少的缓存
    const entries = Array.from(this.costCache.entries())
      .sort((a, b) => a[1].hitCount - b[1].hitCount);

    const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
    for (const [key] of toRemove) {
      this.costCache.delete(key);
    }

    logForDebugging('已清理低命中缓存', { removedCount: toRemove.length });
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
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

  /**
   * 清空缓存
   */
  clear(): void {
    this.costCache.clear();
    logForDebugging('成本缓存已清空');
  }

  /**
   * 设置缓存最大大小
   */
  setMaxCacheSize(size: number): void {
    this.maxCacheSize = size;
    this.cleanupIfNeeded();
    logForDebugging('缓存最大大小已更新', { maxSize: size });
  }

  /**
   * 设置默认TTL
   */
  setDefaultTTL(ttlMs: number): void {
    this.defaultTTL = ttlMs;
    logForDebugging('默认缓存TTL已更新', { ttlMs });
  }
}

/**
 * 全局成本缓存管理器实例
 */
export const costCacheManager = new CostCacheManager();

/**
 * 获取或计算成本
 */
export function getOrCalculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number = 0,
  cacheCreationTokens: number = 0,
  webSearchRequests: number = 0,
  isFastMode: boolean = false,
): number {
  return costCacheManager.getOrCalculateCost(
    modelName,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    webSearchRequests,
    isFastMode,
  );
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  totalHits: number;
} {
  return costCacheManager.getCacheStats();
}

/**
 * 清空成本缓存
 */
export function clearCostCache(): void {
  costCacheManager.clear();
}

/**
 * 清理过期缓存
 */
export function cleanupCostCache(): number {
  return costCacheManager.cleanup();
}
