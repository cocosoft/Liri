/**
 * 缓存过期和刷新策略
 * 基于CC源码缓存系统实现
 */

export enum EvictionPolicy {
  LRU = 'lru',
  LFU = 'lfu',
  FIFO = 'fifo',
  TTL = 'ttl',
  SIZE = 'size',
}

export interface EvictionOptions {
  policy: EvictionPolicy;
  maxSize: number;
  maxAge?: number;
}

export class CacheEvictionManager {
  private options: EvictionOptions;
  private lastCleanup: number = 0;
  private cleanupInterval: number;

  constructor(options: EvictionOptions, cleanupInterval: number = 60000) {
    this.options = options;
    this.cleanupInterval = cleanupInterval;
  }

  shouldCleanup(): boolean {
    return Date.now() - this.lastCleanup > this.cleanupInterval;
  }

  recordCleanup(): void {
    this.lastCleanup = Date.now();
  }

  selectEvictionCandidates<K, V>(
    entries: Map<K, { value: V; timestamp: number; hits: number; size?: number }>
  ): K[] {
    switch (this.options.policy) {
      case EvictionPolicy.LRU:
        return this.selectLRU(entries);
      case EvictionPolicy.LFU:
        return this.selectLFU(entries);
      case EvictionPolicy.FIFO:
        return this.selectFIFO(entries);
      case EvictionPolicy.TTL:
        return this.selectTTL(entries);
      case EvictionPolicy.SIZE:
        return this.selectBySize(entries);
      default:
        return this.selectLRU(entries);
    }
  }

  private selectLRU<K, V>(
    entries: Map<K, { value: V; timestamp: number; hits: number }>
  ): K[] {
    const candidates: K[] = [];
    for (const [key, entry] of entries) {
      if (this.options.maxAge && Date.now() - entry.timestamp > this.options.maxAge) {
        candidates.push(key);
      }
    }
    return candidates;
  }

  private selectLFU<K, V>(
    entries: Map<K, { value: V; timestamp: number; hits: number }>
  ): K[] {
    const candidates: K[] = [];
    for (const [key, entry] of entries) {
      if (entry.hits === 0) {
        candidates.push(key);
      }
    }
    return candidates;
  }

  private selectFIFO<K, V>(
    entries: Map<K, { value: V; timestamp: number }>
  ): K[] {
    const candidates: K[] = [];
    for (const [key, entry] of entries) {
      candidates.push(key);
    }
    return candidates.sort((a, b) => {
      const entryA = entries.get(a)!;
      const entryB = entries.get(b)!;
      return entryA.timestamp - entryB.timestamp;
    });
  }

  private selectTTL<K, V>(
    entries: Map<K, { value: V; timestamp: number }>
  ): K[] {
    const candidates: K[] = [];
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (this.options.maxAge && now - entry.timestamp > this.options.maxAge) {
        candidates.push(key);
      }
    }
    return candidates;
  }

  private selectBySize<K, V>(
    entries: Map<K, { value: V; timestamp: number; hits: number; size?: number }>
  ): K[] {
    const candidates: K[] = [];
    for (const [key, entry] of entries) {
      if (entry.size && entry.size > this.options.maxSize) {
        candidates.push(key);
      }
    }
    return candidates;
  }
}

export interface RefreshOptions {
  backgroundRefresh: boolean;
  refreshThreshold?: number;
  maxRefreshAge?: number;
}

export class StaleWhileRevalidate<V> {
  private cache: Map<string, { value: V; timestamp: number; refreshing: boolean }> = new Map();
  private ttl: number;
  private refreshOptions: RefreshOptions;

  constructor(ttl: number, refreshOptions: RefreshOptions) {
    this.ttl = ttl;
    this.refreshOptions = refreshOptions;
  }

  get(key: string): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      if (this.refreshOptions.backgroundRefresh && !entry.refreshing) {
        return undefined;
      }
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: V): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      refreshing: false,
    });
  }

  scheduleRefresh(key: string, fetchFn: () => Promise<V>): void {
    const entry = this.cache.get(key);
    if (!entry || entry.refreshing) return;

    entry.refreshing = true;

    Promise.resolve()
      .then(() => fetchFn())
      .then(newValue => {
        if (this.cache.get(key)?.refreshing) {
          this.cache.set(key, {
            value: newValue,
            timestamp: Date.now(),
            refreshing: false,
          });
        }
      })
      .catch(() => {
        const current = this.cache.get(key);
        if (current?.refreshing) {
          current.refreshing = false;
        }
      });
  }

  isRefreshing(key: string): boolean {
    return this.cache.get(key)?.refreshing ?? false;
  }

  clear(): void {
    this.cache.clear();
  }
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
}

export class CacheMetricsCollector {
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    size: 0,
    hitRate: 0,
  };

  recordHit(): void {
    this.metrics.hits++;
    this.updateHitRate();
  }

  recordMiss(): void {
    this.metrics.misses++;
    this.updateHitRate();
  }

  recordEviction(): void {
    this.metrics.evictions++;
  }

  updateSize(size: number): void {
    this.metrics.size = size;
  }

  private updateHitRate(): void {
    const total = this.metrics.hits + this.metrics.misses;
    this.metrics.hitRate = total > 0 ? this.metrics.hits / total : 0;
  }

  getMetrics(): CacheMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
      hitRate: 0,
    };
  }

  getHitRatePercentage(): number {
    return this.metrics.hitRate * 100;
  }

  getTotalRequests(): number {
    return this.metrics.hits + this.metrics.misses;
  }
}

export function createEvictionManager(
  policy: EvictionPolicy = EvictionPolicy.LRU,
  maxSize: number = 100,
  maxAge?: number
): CacheEvictionManager {
  return new CacheEvictionManager({ policy, maxSize, maxAge });
}

export function createStaleWhileRevalidate<V>(
  ttl: number = 5 * 60 * 1000,
  backgroundRefresh: boolean = true
): StaleWhileRevalidate<V> {
  return new StaleWhileRevalidate<V>(ttl, { backgroundRefresh });
}
