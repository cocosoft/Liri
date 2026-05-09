import type { ICache, CacheConfig, CacheStats } from './models/types';

/**
 * 默认缓存键命名前缀
 */
const CACHE_NAME_PREFIX = 'cache';

/**
 * 默认内存缓存实现
 */
class DefaultMemoryCache<V = unknown> implements ICache<string, V> {
  private storage = new Map<string, { value: V; expiresAt: number | null }>();
  private hits = 0;
  private misses = 0;
  private expirations = 0;
  private cleanups = 0;
  private maxSize: number;
  private defaultTTL: number;
  private lastCleanup = Date.now();

  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.defaultTTL = config?.defaultTTL ?? 5 * 60 * 1000;
  }

  get(key: string): V | null {
    const entry = this.storage.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      this.expirations++;
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value;
  }

  set(key: string, value: V, ttl?: number): void {
    if (this.storage.size >= this.maxSize) {
      this.evictOne();
    }
    const expiresAt = ttl !== undefined ? Date.now() + ttl : this.defaultTTL > 0 ? Date.now() + this.defaultTTL : null;
    this.storage.set(key, { value, expiresAt });
  }

  delete(key: string): boolean {
    const existed = this.storage.has(key);
    this.storage.delete(key);
    return existed;
  }

  clear(): void {
    this.storage.clear();
    this.hits = 0;
    this.misses = 0;
    this.expirations = 0;
    this.cleanups = 0;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  size(): number {
    return this.storage.size;
  }

  getStats(): CacheStats {
    return {
      size: this.storage.size,
      hits: this.hits,
      misses: this.misses,
      expirations: this.expirations,
      cleanups: this.cleanups,
    };
  }

  cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.storage.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.storage.delete(key);
        removed++;
      }
    }
    this.expirations += removed;
    this.cleanups++;
    this.lastCleanup = now;
  }

  private evictOne(): void {
    const oldest = this.storage.keys().next();
    if (!oldest.done && oldest.value) {
      this.storage.delete(oldest.value);
    }
  }
}

/**
 * 缓存实例注册表
 */
const cacheRegistry = new Map<string, ICache<string, any>>();

/**
 * 缓存工厂
 * 提供统一创建和获取缓存实例的能力
 */
export class CacheFactory {
  static create<V = unknown>(
    name: string,
    config?: CacheConfig
  ): ICache<string, V> {
    const fullName = `${CACHE_NAME_PREFIX}:${name}`;
    if (cacheRegistry.has(fullName)) {
      return cacheRegistry.get(fullName)! as ICache<string, V>;
    }
    const cache = new DefaultMemoryCache<V>(config);
    cacheRegistry.set(fullName, cache);
    return cache;
  }

  static getOrCreate<V = unknown>(
    name: string,
    config?: CacheConfig
  ): ICache<string, V> {
    return CacheFactory.create<V>(name, config);
  }

  static get<V = unknown>(name: string): ICache<string, V> | null {
    const fullName = `${CACHE_NAME_PREFIX}:${name}`;
    const cache = cacheRegistry.get(fullName);
    return cache ? (cache as ICache<string, V>) : null;
  }

  static remove(name: string): boolean {
    const fullName = `${CACHE_NAME_PREFIX}:${name}`;
    const cache = cacheRegistry.get(fullName);
    if (cache) {
      cache.clear();
      return cacheRegistry.delete(fullName);
    }
    return false;
  }

  static clearAll(): void {
    for (const cache of cacheRegistry.values()) {
      cache.clear();
    }
    cacheRegistry.clear();
  }

  static getAllNames(): string[] {
    return Array.from(cacheRegistry.keys()).map((k) =>
      k.replace(`${CACHE_NAME_PREFIX}:`, '')
    );
  }

  static size(): number {
    return cacheRegistry.size;
  }
}

/**
 * 预定义缓存名称常量
 */
export const CacheNames = {
  COST: 'cost',
  TOOL: 'tool',
  MCP: 'mcp',
  CONTEXT: 'context',
  PERMISSION: 'permission',
  PLUGIN: 'plugin',
  SETTINGS: 'settings',
  SESSION: 'session',
  MODEL: 'model',
} as const;
