import { TTLCache } from '@modules/utils/cache';

export interface CacheEntry {
  response: string;
  timestamp: number;
  ttl: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export class LocalAgentCache {
  private cache: TTLCache<string>;
  private maxSize: number;
  private defaultTtl: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number = 100, defaultTtlMs: number = 60000) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtlMs;
    this.cache = new TTLCache<string>(maxSize, defaultTtlMs);
  }

  get(key: string): string | null {
    const value = this.cache.get(key);
    if (value === null) {
      this.misses++;
      return null;
    }
    this.hits++;
    return value;
  }

  set(key: string, response: string, ttl?: number): void {
    this.cache.set(key, response, ttl ?? this.defaultTtl);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size(),
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
