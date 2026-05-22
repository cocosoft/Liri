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
  private cache: Map<string, CacheEntry>;
  private maxSize: number;
  private defaultTtl: number;
  private hits: number = 0;
  private misses: number = 0;

  constructor(maxSize: number = 100, defaultTtlMs: number = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtlMs;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.response;
  }

  set(key: string, response: string, ttl?: number): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTtl,
    });
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
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
