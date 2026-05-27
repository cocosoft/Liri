import type { AcpRuntimeCapabilities } from '../runtime/types.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class RuntimeCapabilitiesCache {
  private cache: Map<string, CacheEntry<AcpRuntimeCapabilities>> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 60_000) {
    this.ttlMs = ttlMs;
  }

  set(key: string, capabilities: AcpRuntimeCapabilities): void {
    this.cache.set(key, {
      value: capabilities,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  get(key: string): AcpRuntimeCapabilities | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

export class NoopRuntimeCapabilitiesCache {
  set(_key: string, _capabilities: AcpRuntimeCapabilities): void {}
  get(_key: string): null {
    return null;
  }
  invalidate(_key: string): void {}
  clear(): void {}
}
