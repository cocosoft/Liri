/**
 * 缓存存储实现
 * 基于CC源码缓存系统实现
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
  size?: number;
}

export interface CacheOptions {
  ttl?: number;
  maxSize?: number;
  onEvict?: (key: string, value: unknown) => void;
}

export class MemoryCache<K = string, V = unknown> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private options: Required<CacheOptions>;
  private accessOrder: K[] = [];

  constructor(options: CacheOptions = {}) {
    this.options = {
      ttl: options.ttl ?? 0,
      maxSize: options.maxSize ?? Infinity,
      onEvict: options.onEvict ?? (() => {}),
    };
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      this.delete(key);
      return undefined;
    }

    entry.hits++;
    this.updateAccessOrder(key);
    return entry.value;
  }

  set(key: K, value: V, ttl?: number): this {
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<V> = {
      value,
      timestamp: Date.now(),
      hits: 0,
    };

    this.cache.set(key, entry);
    this.updateAccessOrder(key);
    return this;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (this.isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.options.onEvict(key as string, entry.value);
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
      return true;
    }
    return false;
  }

  clear(): void {
    for (const [key, entry] of this.cache) {
      this.options.onEvict(key as string, entry.value);
    }
    this.cache.clear();
    this.accessOrder = [];
  }

  size(): number {
    return this.cache.size;
  }

  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  values(): V[] {
    const now = Date.now();
    const result: V[] = [];
    for (const [key, entry] of this.cache) {
      if (!this.isExpired(entry)) {
        result.push(entry.value);
      } else {
        this.delete(key);
      }
    }
    return result;
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    if (this.options.ttl <= 0) return false;
    return Date.now() - entry.timestamp > this.options.ttl;
  }

  private updateAccessOrder(key: K): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    const lruKey = this.accessOrder.shift();
    if (lruKey !== undefined) {
      this.delete(lruKey);
    }
  }

  cleanExpired(): number {
    let count = 0;
    const now = Date.now();
    const keysToDelete: K[] = [];

    for (const [key, entry] of this.cache) {
      if (this.options.ttl > 0 && now - entry.timestamp > this.options.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.delete(key);
      count++;
    }

    return count;
  }
}

export class LRUCache<K = string, V = unknown> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private accessOrder: K[] = [];
  private maxSize: number;
  private onEvict?: (key: K, value: V) => void;

  constructor(maxSize: number, onEvict?: (key: K, value: V) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }

  private moveToEnd(key: K): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }

  private evictLRU(): void {
    if (this.accessOrder.length === 0) return;
    const lruKey = this.accessOrder.shift();
    if (lruKey !== undefined) {
      const evicted = this.cache.get(lruKey);
      if (evicted && this.onEvict) {
        this.onEvict(lruKey, evicted.value);
      }
      this.cache.delete(lruKey);
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    entry.hits++;
    this.moveToEnd(key);
    return entry.value;
  }

  set(key: K, value: V): this {
    if (this.cache.has(key)) {
      this.cache.delete(key);
      this.accessOrder = this.accessOrder.filter(k => k !== key);
    } else if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
    });
    this.accessOrder.push(key);

    return this;
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    const entry = this.cache.get(key);
    if (entry && this.onEvict) {
      this.onEvict(key, entry.value);
    }
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    return this.cache.delete(key);
  }

  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value);
      }
    }
    this.cache.clear();
    this.accessOrder = [];
  }

  size(): number {
    return this.cache.size;
  }

  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  peek(key: K): V | undefined {
    return this.cache.get(key)?.value;
  }

  resetHits(key: K): void {
    const entry = this.cache.get(key);
    if (entry) {
      entry.hits = 0;
    }
  }

  getStats(): { size: number; maxSize: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    const size = this.cache.size;
    const hitRate = size > 0 ? totalHits / size : 0;
    return { size, maxSize: this.maxSize, hitRate };
  }
}

export interface TTLCacheOptions {
  ttl: number;
  maxSize: number;
  checkInterval?: number;
}

export class TTLCache<K = string, V = unknown> {
  private cache: Map<K, CacheEntry<V>> = new Map();
  private options: Required<TTLCacheOptions>;
  private intervalId?: Timer;

  constructor(options: TTLCacheOptions) {
    this.options = {
      ttl: options.ttl,
      maxSize: options.maxSize,
      checkInterval: options.checkInterval ?? 60000,
    };

    if (this.options.checkInterval > 0) {
      this.intervalId = setInterval(() => this.cleanExpired(), this.options.checkInterval);
    }
  }

  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: K, value: V): this {
    if (this.cache.size >= this.options.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
    });

    return this;
  }

  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.delete(key);
      return false;
    }
    return true;
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  cleanExpired(): number {
    const now = Date.now();
    let count = 0;
    const keysToDelete: K[] = [];

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.options.ttl) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
      count++;
    }

    return count;
  }

  destroy(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export class CacheManager {
  private caches: Map<string, MemoryCache | LRUCache | TTLCache> = new Map();

  register(id: string, cache: MemoryCache | LRUCache | TTLCache): void {
    this.caches.set(id, cache);
  }

  get(id: string): (MemoryCache | LRUCache | TTLCache) | undefined {
    return this.caches.get(id);
  }

  has(id: string): boolean {
    return this.caches.has(id);
  }

  clear(id?: string): void {
    if (id) {
      const cache = this.caches.get(id);
      if (cache) {
        cache.clear();
      }
    } else {
      for (const cache of this.caches.values()) {
        cache.clear();
      }
    }
  }

  remove(id: string): boolean {
    const cache = this.caches.get(id);
    if (cache) {
      cache.clear();
      return this.caches.delete(id);
    }
    return false;
  }

  size(id?: string): number {
    if (id) {
      const cache = this.caches.get(id);
      return cache?.size() ?? 0;
    }

    let total = 0;
    for (const cache of this.caches.values()) {
      total += cache.size();
    }
    return total;
  }

  ids(): string[] {
    return Array.from(this.caches.keys());
  }
}

let globalCacheManager: CacheManager | null = null;

export function getGlobalCacheManager(): CacheManager {
  if (!globalCacheManager) {
    globalCacheManager = new CacheManager();
  }
  return globalCacheManager;
}

export function resetGlobalCacheManager(): void {
  if (globalCacheManager) {
    globalCacheManager.clear();
    globalCacheManager = null;
  }
}
