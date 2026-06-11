/**
 * 缓存服务
 * 实现基于内存的缓存，支持TTL、最大缓存数量和自动清理
 */

import { CacheItem, CacheConfig, CacheStats } from './types';

/**
 * 缓存服务类
 */
export class CacheService<T> {
  /**
   * 缓存存储
   */
  private cache: Map<string, CacheItem<T>> = new Map();

  /**
   * 缓存配置
   */
  private config: Required<CacheConfig>;

  /**
   * 缓存统计信息
   */
  private stats: CacheStats = {
    size: 0,
    hits: 0,
    misses: 0,
    expirations: 0,
    cleanups: 0,
  };

  /**
   * 自动清理定时器
   */
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * 构造函数
   * @param config 缓存配置
   */
  constructor(config: CacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize || 1000,
      defaultTTL: config.defaultTTL || 3600000, // 默认1小时
      cleanupInterval: config.cleanupInterval || 60000, // 默认1分钟
      enableAutoCleanup: config.enableAutoCleanup ?? true,
    };

    // 启动自动清理
    if (this.config.enableAutoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 停止自动清理
   */
  private stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（毫秒）
   */
  set(key: string, value: T, ttl?: number): void {
    // 检查缓存大小
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest();
    }

    const effectiveTTL = ttl ?? this.config.defaultTTL;
    const expiresAt = effectiveTTL > 0 ? Date.now() + effectiveTTL : null;

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      expiresAt,
      accessCount: 0,
      lastAccessedAt: Date.now(),
    });

    this.stats.size = this.cache.size;
  }

  /**
   * 获取缓存
   * @param key 缓存键
   * @returns 缓存值或undefined
   */
  get(key: string): T | undefined {
    const item = this.cache.get(key);

    if (!item) {
      this.stats.misses++;
      return undefined;
    }

    // 检查是否过期
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.expirations++;
      this.stats.size = this.cache.size;
      this.stats.misses++;
      return undefined;
    }

    // 更新访问信息
    item.accessCount++;
    item.lastAccessedAt = Date.now();

    this.stats.hits++;
    return item.value;
  }

  /**
   * 删除缓存
   * @param key 缓存键
   * @returns 是否删除成功
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * 检查缓存是否存在
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    const item = this.cache.get(key);

    if (!item) {
      return false;
    }

    // 检查是否过期
    if (item.expiresAt && item.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.expirations++;
      this.stats.size = this.cache.size;
      return false;
    }

    return true;
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存键列表
   * @returns 缓存键列表
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取缓存值列表
   * @returns 缓存值列表
   */
  values(): T[] {
    const values: T[] = [];
    for (const item of this.cache.values()) {
      // 过滤过期项
      if (!item.expiresAt || item.expiresAt >= Date.now()) {
        values.push(item.value);
      }
    }
    return values;
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && item.expiresAt < now) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.stats.expirations += removed;
      this.stats.size = this.cache.size;
      this.stats.cleanups++;
    }
  }

  /**
   * 驱逐最旧的缓存项
   */
  private evictOldest(): void {
    if (this.cache.size === 0) {
      return;
    }

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.lastAccessedAt < oldestTime) {
        oldestTime = item.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.size = this.cache.size;
    }
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计信息
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      size: this.cache.size,
      hits: 0,
      misses: 0,
      expirations: 0,
      cleanups: 0,
    };
  }

  /**
   * 销毁缓存
   */
  destroy(): void {
    this.stopAutoCleanup();
    this.clear();
  }
}

/**
 * 创建缓存实例
 * @param config 缓存配置
 * @returns 缓存实例
 */
export function createCache<T>(config: CacheConfig = {}): CacheService<T> {
  return new CacheService<T>(config);
}
