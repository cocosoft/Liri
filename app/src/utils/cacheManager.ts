/**
 * 缓存管理器
 * 用于优化内存使用，减少重复计算和I/O操作
 */

import { logger } from './log.js';

/**
 * 缓存项
 */
export interface CacheItem<T> {
  value: T;
  timestamp: number;
  expiry: number;
  size?: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  maxSize: number; // 最大缓存大小（字节）
  maxItems: number; // 最大缓存项数量
  defaultExpiry: number; // 默认过期时间（毫秒）
  cleanupInterval: number; // 清理间隔（毫秒）
}

/**
 * 缓存管理器
 */
export class CacheManager<T> {
  private cache: Map<string, CacheItem<T>> = new Map();
  private config: CacheConfig;
  private size: number = 0;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      maxSize: 10 * 1024 * 1024, // 10MB
      maxItems: 1000,
      defaultExpiry: 5 * 60 * 1000, // 5分钟
      cleanupInterval: 60 * 1000, // 1分钟
      ...config,
    };

    this.startCleanupInterval();
  }

  /**
   * 开始清理间隔
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 停止清理间隔
   */
  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 计算值的大小
   */
  private calculateSize(value: T): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch (error) {
      return 0;
    }
  }

  /**
   * 设置缓存
   */
  public set(key: string, value: T, expiry?: number): void {
    const itemSize = this.calculateSize(value);
    const now = Date.now();
    const item: CacheItem<T> = {
      value,
      timestamp: now,
      expiry: expiry || this.config.defaultExpiry,
      size: itemSize,
    };

    // 如果缓存已满，删除最旧的项
    while (
      this.size + itemSize > this.config.maxSize ||
      this.cache.size >= this.config.maxItems
    ) {
      this.removeOldest();
    }

    // 移除旧值（如果存在）
    const oldItem = this.cache.get(key);
    if (oldItem && oldItem.size) {
      this.size -= oldItem.size;
    }

    // 添加新值
    this.cache.set(key, item);
    this.size += itemSize;

    logger.debug(`Cache set: ${key}, size: ${(itemSize / 1024).toFixed(2)} KB`);
  }

  /**
   * 获取缓存
   */
  public get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - item.timestamp > item.expiry) {
      this.cache.delete(key);
      if (item.size) {
        this.size -= item.size;
      }
      return null;
    }

    return item.value;
  }

  /**
   * 删除缓存
   */
  public delete(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      this.cache.delete(key);
      if (item.size) {
        this.size -= item.size;
      }
      logger.debug(`Cache deleted: ${key}`);
    }
  }

  /**
   * 清空缓存
   */
  public clear(): void {
    this.cache.clear();
    this.size = 0;
    logger.debug('Cache cleared');
  }

  /**
   * 移除最旧的项
   */
  private removeOldest(): void {
    if (this.cache.size === 0) return;

    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.timestamp < oldestTimestamp) {
        oldestTimestamp = item.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const item = this.cache.get(oldestKey);
      if (item && item.size) {
        this.size -= item.size;
      }
      this.cache.delete(oldestKey);
      logger.debug(`Cache evicted oldest item: ${oldestKey}`);
    }
  }

  /**
   * 清理过期项
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.expiry) {
        this.cache.delete(key);
        if (item.size) {
          this.size -= item.size;
        }
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired items`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  public getStats(): {
    size: number;
    itemCount: number;
    maxSize: number;
    maxItems: number;
  } {
    return {
      size: this.size,
      itemCount: this.cache.size,
      maxSize: this.config.maxSize,
      maxItems: this.config.maxItems,
    };
  }

  /**
   * 检查缓存是否存在
   */
  public has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取缓存键列表
   */
  public keys(): IterableIterator<string> {
    return this.cache.keys();
  }
}

/**
 * 全局缓存管理器
 */
const globalCache = new CacheManager<any>({
  maxSize: 50 * 1024 * 1024, // 50MB
  maxItems: 5000,
  defaultExpiry: 10 * 60 * 1000, // 10分钟
  cleanupInterval: 2 * 60 * 1000, // 2分钟
});

/**
 * 获取全局缓存管理器
 */
export function getGlobalCache<T>(): CacheManager<T> {
  return globalCache as CacheManager<T>;
}

/**
 * 缓存装饰器
 * 用于缓存函数的返回值
 */
export function cached(expiry?: number) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`;
      const cachedValue = getGlobalCache<any>().get(cacheKey);

      if (cachedValue !== null) {
        return cachedValue;
      }

      const result = originalMethod.apply(this, args);
      getGlobalCache<any>().set(cacheKey, result, expiry);
      return result;
    };
  };
}
