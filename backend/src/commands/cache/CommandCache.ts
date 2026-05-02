import type { Command } from '../types/index.js';

export class CommandCache {
  private cache: Map<string, Command> = new Map();
  private lastLoadTime: number = 0;
  private cacheTimeout: number = 300000; // 5分钟缓存超时

  set(key: string, command: Command): void {
    this.cache.set(key, command);
    this.lastLoadTime = Date.now();
  }

  get(key: string): Command | undefined {
    return this.cache.get(key);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  getAll(): Command[] {
    return Array.from(this.cache.values());
  }

  clear(): void {
    this.cache.clear();
    this.lastLoadTime = 0;
  }

  isExpired(): boolean {
    const now = Date.now();
    return now - this.lastLoadTime > this.cacheTimeout;
  }

  size(): number {
    return this.cache.size;
  }
}

export const commandCache = new CommandCache();

export function memoize<T extends (...args: any[]) => any>(fn: T): T {
  const cache = new Map<string, ReturnType<T>>();

  return ((...args: any[]) => {
    const key = JSON.stringify(args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}
