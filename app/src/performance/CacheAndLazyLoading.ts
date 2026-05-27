//
/**
 * 缓存和延迟加载管理
 * 实现高效的缓存策略和延迟加载功能
 */

import { logForDebugging } from '../utils/debug.js';
import { getPerformanceConfig } from './PerformanceConfig.js';
import { slowLogging } from './SlowOperations.js';

/**
 * 缓存项
 */
export interface CacheItem<T> {
  /** 缓存值 */
  value: T;
  /** 过期时间戳 */
  expiry: number;
  /** 访问时间戳 */
  accessed: number;
  /** 大小（字节） */
  size: number;
}

/**
 * 缓存管理器
 */
export class CacheManager<T> {
  private cache: Map<string, CacheItem<T>> = new Map();
  private size: number = 0;
  private maxSize: number;
  private defaultExpiry: number;

  /**
   * 构造函数
   */
  constructor(maxSizeMb: number = 100, defaultExpiryMs: number = 3600000) {
    const config = getPerformanceConfig();
    this.maxSize = (config.cache.sizeLimitMb || maxSizeMb) * 1024 * 1024; // 转换为字节
    this.defaultExpiry = config.cache.expirationMs || defaultExpiryMs;

    // 定期清理过期缓存
    setInterval(() => this.cleanup(), 60000); // 每分钟清理一次
  }

  /**
   * 获取缓存
   */
  get(key: string): T | null {
    using _ = slowLogging`CacheManager.get(${key})`;

    const item = this.cache.get(key);
    if (!item) {
      return null;
    }

    // 检查是否过期
    if (item.expiry < Date.now()) {
      this.cache.delete(key);
      this.size -= item.size;
      return null;
    }

    // 更新访问时间
    item.accessed = Date.now();
    return item.value;
  }

  /**
   * 设置缓存
   */
  set(key: string, value: T, expiryMs?: number): void {
    using _ = slowLogging`CacheManager.set(${key})`;

    const size = this.calculateSize(value);
    const expiry = Date.now() + (expiryMs || this.defaultExpiry);
    const accessed = Date.now();

    // 如果缓存项已存在，更新大小
    const existingItem = this.cache.get(key);
    if (existingItem) {
      this.size -= existingItem.size;
    }

    // 检查缓存大小
    while (this.size + size > this.maxSize) {
      this.evict();
    }

    // 添加到缓存
    this.cache.set(key, { value, expiry, accessed, size });
    this.size += size;
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    using _ = slowLogging`CacheManager.delete(${key})`;

    const item = this.cache.get(key);
    if (item) {
      this.size -= item.size;
      this.cache.delete(key);
    }
  }

  /**
   * 清空缓存
   */
  clear(): void {
    using _ = slowLogging`CacheManager.clear()`;

    this.cache.clear();
    this.size = 0;
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取缓存项数量
   */
  getCount(): number {
    return this.cache.size;
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    using _ = slowLogging`CacheManager.cleanup()`;

    const now = Date.now();
    let cleaned = 0;

    for (const [key, item] of this.cache.entries()) {
      if (item.expiry < now) {
        this.size -= item.size;
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logForDebugging(`清理了 ${cleaned} 个过期缓存项`);
    }
  }

  /**
   * 驱逐缓存项（使用LRU策略）
   */
  private evict(): void {
    if (this.cache.size === 0) {
      return;
    }

    // 找到最久未使用的缓存项
    let oldestKey: string | null = null;
    let oldestAccessed = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.accessed < oldestAccessed) {
        oldestAccessed = item.accessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const item = this.cache.get(oldestKey);
      if (item) {
        this.size -= item.size;
        this.cache.delete(oldestKey);
      }
    }
  }

  /**
   * 计算值的大小（字节）
   */
  private calculateSize(value: T): number {
    try {
      return Buffer.byteLength(JSON.stringify(value), 'utf8');
    } catch {
      return 0;
    }
  }
}

/**
 * 延迟加载选项
 */
export interface LazyLoadingOptions {
  /** 预加载阈值（毫秒） */
  preloadThresholdMs?: number;
  /** 是否启用缓存 */
  cache?: boolean;
  /** 缓存过期时间（毫秒） */
  cacheExpiryMs?: number;
}

/**
 * 延迟加载管理器
 */
export class LazyLoadingManager {
  private cache: CacheManager<any> = new CacheManager();
  private loadingPromises: Map<string, Promise<unknown>> = new Map();

  /**
   * 延迟加载函数
   */
  async lazyLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options: LazyLoadingOptions = {}
  ): Promise<T> {
    using _ = slowLogging`LazyLoadingManager.lazyLoad(${key})`;

    const config = getPerformanceConfig();
    const preloadThresholdMs =
      options.preloadThresholdMs || config.lazyLoading.preloadThresholdMs;
    const useCache = options.cache !== false;
    const cacheExpiryMs = options.cacheExpiryMs;

    // 检查缓存
    if (useCache) {
      const cached = this.cache.get(key);
      if (cached !== null) {
        return cached as T;
      }
    }

    // 检查是否正在加载
    const loadingPromise = this.loadingPromises.get(key);
    if (loadingPromise) {
      return loadingPromise as Promise<T>;
    }

    // 开始加载
    const loadPromise = (async () => {
      try {
        const result = await loader();

        // 缓存结果
        if (useCache) {
          this.cache.set(key, result, cacheExpiryMs);
        }

        return result;
      } finally {
        // 移除加载中的标记
        this.loadingPromises.delete(key);
      }
    })();

    // 记录加载中的标记
    this.loadingPromises.set(key, loadPromise);

    return loadPromise;
  }

  /**
   * 预加载
   */
  async preload<T>(
    key: string,
    loader: () => Promise<T>,
    options: LazyLoadingOptions = {}
  ): Promise<void> {
    using _ = slowLogging`LazyLoadingManager.preload(${key})`;

    // 检查缓存
    if (options.cache !== false && this.cache.get(key) !== null) {
      return;
    }

    // 检查是否正在加载
    if (this.loadingPromises.has(key)) {
      return;
    }

    // 开始预加载
    void this.lazyLoad(key, loader, options);
  }

  /**
   * 清除缓存
   */
  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache.getSize();
  }

  /**
   * 获取缓存项数量
   */
  getCacheCount(): number {
    return this.cache.getCount();
  }
}

/**
 * 全局缓存管理器实例
 */
export const globalCacheManager = new CacheManager();

/**
 * 全局延迟加载管理器实例
 */
export const globalLazyLoadingManager = new LazyLoadingManager();

/**
 * 获取缓存
 */
export function getCache<T>(key: string): T | null {
  return globalCacheManager.get(key) as T | null;
}

/**
 * 设置缓存
 */
export function setCache<T>(key: string, value: T, expiryMs?: number): void {
  globalCacheManager.set(key, value, expiryMs);
}

/**
 * 删除缓存
 */
export function deleteCache(key: string): void {
  globalCacheManager.delete(key);
}

/**
 * 清空缓存
 */
export function clearCache(): void {
  globalCacheManager.clear();
}

/**
 * 延迟加载
 */
export async function lazyLoad<T>(
  key: string,
  loader: () => Promise<T>,
  options: LazyLoadingOptions = {}
): Promise<T> {
  return globalLazyLoadingManager.lazyLoad(key, loader, options);
}

/**
 * 预加载
 */
export async function preload<T>(
  key: string,
  loader: () => Promise<T>,
  options: LazyLoadingOptions = {}
): Promise<void> {
  return globalLazyLoadingManager.preload(key, loader, options);
}
