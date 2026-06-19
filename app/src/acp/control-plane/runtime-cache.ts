import type { AcpRuntimeCapabilities } from '../runtime/types.js';
import { TtlCache } from '@modules/core';

export class RuntimeCapabilitiesCache {
  private cache: TtlCache<AcpRuntimeCapabilities>;
  private ttlMs: number;

  constructor(ttlMs: number = 60_000) {
    this.ttlMs = ttlMs;
    this.cache = new TtlCache<AcpRuntimeCapabilities>(1000, ttlMs);
  }

  set(key: string, capabilities: AcpRuntimeCapabilities): void {
    this.cache.set(key, capabilities, this.ttlMs);
  }

  get(key: string): AcpRuntimeCapabilities | null {
    return this.cache.get(key);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size();
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
