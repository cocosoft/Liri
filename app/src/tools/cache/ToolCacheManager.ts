import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/config/paths';
import crypto from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { ICache, CacheStats } from '@modules/cache/models/types';

const logger = new Logger({ level: LogLevel.INFO });

export interface ToolCacheItem {
  key: string;
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  expiration: number | null;
}

export class ToolCacheManager implements ICache<string, unknown> {
  private cache: Map<string, ToolCacheItem> = new Map();
  private cachePath: string;
  private maxCacheSize: number;
  private defaultExpiration: number | null;

  constructor(
    cachePath: string = path.join(
      resolvePyappHome(),
      'tool_cache.json'
    ),
    maxCacheSize: number = 1000,
    defaultExpiration: number | null = 24 * 60 * 60 * 1000
  ) {
    this.cachePath = cachePath;
    this.maxCacheSize = maxCacheSize;
    this.defaultExpiration = defaultExpiration;
    this.loadCache();
  }

  get(key: string): unknown | null {
    const item = this.getCache(key);
    return item ? item.result : null;
  }

  set(key: string, value: unknown, ttl?: number): void {
    const expiration = ttl ? Date.now() + ttl : this.defaultExpiration;
    const item: ToolCacheItem = {
      key,
      toolName: 'unknown',
      input: {},
      result: value,
      timestamp: Date.now(),
      expiration: expiration ? Date.now() + expiration : null,
    };
    this.cache.set(key, item);
    this.saveCache();
  }

  delete(key: string): boolean {
    const existed = this.cache.has(key);
    this.deleteCache(key);
    return existed;
  }

  clear(): void {
    this.clearCache();
  }

  has(key: string): boolean {
    const item = this.getCache(key);
    return item !== undefined;
  }

  size(): number {
    return this.getCacheSize();
  }

  getStats(): CacheStats {
    const stats = this.getCacheStatsInfo();
    return {
      size: stats.total,
      hits: 0,
      misses: 0,
      expirations: 0,
      cleanups: 0,
    };
  }

  generateCacheKey(toolName: string, input: Record<string, unknown>): string {
    const inputString = JSON.stringify(input, Object.keys(input).sort());
    const data = `${toolName}:${inputString}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  private loadCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.cachePath)) {
        const content = fs.readFileSync(this.cachePath, 'utf8');
        const items: ToolCacheItem[] = JSON.parse(content);

        const now = Date.now();
        for (const item of items) {
          if (!item.expiration || item.expiration > now) {
            this.cache.set(item.key, item);
          }
        }
      }
    } catch (error) {
      logger.warning('Failed to load tool cache:', { error });
      this.cache = new Map();
    }
  }

  private saveCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (this.cache.size > this.maxCacheSize) {
        const items = Array.from(this.cache.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, this.maxCacheSize);

        this.cache = new Map();
        for (const item of items) {
          this.cache.set(item.key, item);
        }
      }

      const items = Array.from(this.cache.values());
      fs.writeFileSync(this.cachePath, JSON.stringify(items, null, 2));
    } catch (error) {
      logger.warning('Failed to save tool cache:', { error });
    }
  }

  getCache(key: string): ToolCacheItem | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (item.expiration && item.expiration < Date.now()) {
      this.cache.delete(key);
      this.saveCache();
      return undefined;
    }

    return item;
  }

  setCache(
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
    expiration: number | null = this.defaultExpiration
  ): string {
    const key = this.generateCacheKey(toolName, input);
    const item: ToolCacheItem = {
      key,
      toolName,
      input,
      result,
      timestamp: Date.now(),
      expiration: expiration ? Date.now() + expiration : null,
    };

    this.cache.set(key, item);
    this.saveCache();
    return key;
  }

  deleteCache(key: string): void {
    this.cache.delete(key);
    this.saveCache();
  }

  clearCache(): void {
    this.cache.clear();
    this.saveCache();
  }

  clearToolCache(toolName: string): void {
    for (const [key, item] of this.cache.entries()) {
      if (item.toolName === toolName) {
        this.cache.delete(key);
      }
    }
    this.saveCache();
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  getCacheStatsInfo(): {
    total: number;
    tools: Record<string, number>;
    oldest: number | null;
    newest: number | null;
  } {
    const items = Array.from(this.cache.values());
    const tools: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const item of items) {
      if (tools[item.toolName]) {
        tools[item.toolName]++;
      } else {
        tools[item.toolName] = 1;
      }

      if (!oldest || item.timestamp < oldest) {
        oldest = item.timestamp;
      }

      if (!newest || item.timestamp > newest) {
        newest = item.timestamp;
      }
    }

    return {
      total: items.length,
      tools,
      oldest,
      newest,
    };
  }
}

export const toolCacheManager = new ToolCacheManager();
