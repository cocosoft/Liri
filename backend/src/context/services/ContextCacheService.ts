/**
 * 上下文缓存服务
 * 提供上下文信息的缓存和管理功能
 * 参考CC源码: cc_code/backend/context.ts (memoize)
 */

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  ttl: number;
  maxSize: number;
}

/**
 * 默认缓存配置
 */
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 60000, // 1分钟
  maxSize: 100,
};

/**
 * 上下文缓存服务类
 */
export class ContextCacheService {
  private static instance: ContextCacheService;
  private cache: Map<string, CacheEntry<any>> = new Map();
  private config: CacheConfig;

  private constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<CacheConfig>): ContextCacheService {
    if (!ContextCacheService.instance) {
      ContextCacheService.instance = new ContextCacheService(config);
    }
    return ContextCacheService.instance;
  }

  /**
   * 获取缓存值
   * @param key 缓存键
   * @returns 缓存值或undefined
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * 设置缓存值
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 可选的TTL
   */
  set<T>(key: string, value: T, ttl?: number): void {
    if (this.cache.size >= this.config.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.config.ttl,
    });
  }

  /**
   * 检查缓存是否存在
   * @param key 缓存键
   * @returns 是否存在
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   * @param key 缓存键
   * @returns 是否成功删除
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清除过期的缓存
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存大小
   * @returns 缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有缓存键
   * @returns 缓存键数组
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 创建memoize函数
   * @param fn 原始函数
   * @param keyGenerator 键生成器
   * @returns memoize后的函数
   */
  memoize<T extends (...args: any[]) => any>(
    fn: T,
    keyGenerator?: (...args: Parameters<T>) => string
  ): T {
    const cache = this;

    const memoized = async function (...args: Parameters<T>): Promise<ReturnType<T>> {
      const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
      
      const cached = cache.get<ReturnType<T>>(key);
      if (cached !== undefined) {
        return cached;
      }

      const result = await fn(...args);
      cache.set(key, result);
      return result;
    } as T;

    (memoized as any).cache = {
      clear: () => {
        cache.keys().forEach(key => {
          if (key.startsWith('memoize_')) {
            cache.delete(key);
          }
        });
      },
    };

    return memoized;
  }

  /**
   * 淘汰最旧的缓存
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
      hitRate: 0,
    };
  }
}

/**
 * 导出单例
 */
export const contextCacheService = ContextCacheService.getInstance();

/**
 * 创建memoize函数
 * @param fn 原始函数
 * @param keyGenerator 键生成器
 * @returns memoize后的函数
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  keyGenerator?: (...args: Parameters<T>) => string
): T {
  return contextCacheService.memoize(fn, keyGenerator);
}
