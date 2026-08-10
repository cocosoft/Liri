import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import crypto from 'crypto';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { ICache, CacheStats } from '@modules/cache/types';
import { TTLCache } from '@modules/utils/cache';

const logger = getLogger('tools:cacheManager');

export interface ToolCacheItem {
  key: string;
  toolName: string;
  input: Record<string, unknown>;
  result: unknown;
  timestamp: number;
  expiration: number | null;
}

/**
 * 工具缓存管理器
 * 使用标准 TTLCache 作为底层存储，提供工具执行结果的持久化缓存。
 */
export class ToolCacheManager implements ICache<string, unknown> {
  /** 标准缓存实例，接管 TTL/过期管理 */
  private cache: TTLCache<ToolCacheItem>;
  /** 工具名→键集合索引，用于按工具批量清除 */
  private toolIndex: Map<string, Set<string>> = new Map();
  private cachePath: string;
  private maxCacheSize: number;
  private defaultExpiration: number;

  constructor(
    cachePath: string = path.join(resolvePyappHome(), 'tool_cache.json'),
    maxCacheSize: number = 1000,
    defaultExpiration: number = 24 * 60 * 60 * 1000
  ) {
    this.cachePath = cachePath;
    this.maxCacheSize = maxCacheSize;
    this.defaultExpiration = defaultExpiration;
    // 使用标准 TTLCache 接管 TTL 管理
    this.cache = new TTLCache<ToolCacheItem>(maxCacheSize, defaultExpiration);
    this.loadCache();
  }

  get(key: string): unknown | null {
    const item = this.cache.get(key);
    return item ? item.result : null;
  }

  set(key: string, value: unknown, ttl?: number): void {
    const item: ToolCacheItem = {
      key,
      toolName: 'unknown',
      input: {},
      result: value,
      timestamp: Date.now(),
      expiration: ttl ? Date.now() + ttl : this.defaultExpiration,
    };
    this.cache.set(key, item, ttl);
    this.saveCache();
  }

  delete(key: string): boolean {
    const existed = this.cache.has(key);
    if (existed) {
      const item = this.cache.get(key);
      if (item) {
        this.removeFromToolIndex(item.toolName, key);
      }
      this.cache.delete(key);
      this.saveCache();
    }
    return existed;
  }

  clear(): void {
    this.cache.clear();
    this.toolIndex.clear();
    this.saveCache();
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  size(): number {
    return this.cache.size();
  }

  getStats(): CacheStats {
    return {
      size: this.cache.size(),
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

  getCache(key: string): ToolCacheItem | undefined {
    const item = this.cache.get(key);
    return item ?? undefined;
  }

  setCache(
    toolName: string,
    input: Record<string, unknown>,
    result: unknown,
    expiration: number | null = this.defaultExpiration
  ): string {
    const key = this.generateCacheKey(toolName, input);
    const ttl = expiration ? expiration - Date.now() : this.defaultExpiration;
    const item: ToolCacheItem = {
      key,
      toolName,
      input,
      result,
      timestamp: Date.now(),
      expiration: expiration,
    };

    this.cache.set(key, item, ttl > 0 ? ttl : undefined);

    // 维护工具名索引
    if (!this.toolIndex.has(toolName)) {
      this.toolIndex.set(toolName, new Set());
    }
    this.toolIndex.get(toolName)!.add(key);

    this.saveCache();
    return key;
  }

  deleteCache(key: string): void {
    const item = this.cache.get(key);
    if (item) {
      this.removeFromToolIndex(item.toolName, key);
    }
    this.cache.delete(key);
    this.saveCache();
  }

  clearCache(): void {
    this.cache.clear();
    this.toolIndex.clear();
    this.saveCache();
  }

  clearToolCache(toolName: string): void {
    const keys = this.toolIndex.get(toolName);
    if (keys) {
      for (const key of keys) {
        this.cache.delete(key);
      }
      this.toolIndex.delete(toolName);
      this.saveCache();
    }
  }

  getCacheSize(): number {
    return this.cache.size();
  }

  getCacheStatsInfo(): {
    total: number;
    tools: Record<string, number>;
    oldest: number | null;
    newest: number | null;
  } {
    // 通过标准 TTLCache 获取统计信息不可行，使用工具索引估算
    const tools: Record<string, number> = {};
    for (const [toolName, keys] of this.toolIndex.entries()) {
      tools[toolName] = keys.size;
    }
    return {
      total: this.cache.size(),
      tools,
      oldest: null,
      newest: null,
    };
  }

  /** 从工具索引中移除键 */
  private removeFromToolIndex(toolName: string, key: string): void {
    const keys = this.toolIndex.get(toolName);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) {
        this.toolIndex.delete(toolName);
      }
    }
  }

  /** 从磁盘加载缓存 */
  private loadCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.cachePath)) {
        const content = fs.readFileSync(this.cachePath, 'utf8');
        const items: ToolCacheItem[] = JSON.parse(content);

        for (const item of items) {
          // 交给 TTLCache 的 TTL 管理，不过期的才放入
          if (!item.expiration || item.expiration > Date.now()) {
            const ttl = item.expiration
              ? item.expiration - Date.now()
              : this.defaultExpiration;
            this.cache.set(item.key, item, ttl > 0 ? ttl : undefined);

            if (!this.toolIndex.has(item.toolName)) {
              this.toolIndex.set(item.toolName, new Set());
            }
            this.toolIndex.get(item.toolName)!.add(item.key);
          }
        }
      }
    } catch (error) {
      void handleError(error, {
        module: 'tools:cacheManager',
        action: 'loadCache',
      });
    }
  }

  /** 保存缓存到磁盘 */
  private saveCache(): void {
    try {
      const dir = path.dirname(this.cachePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 从标准缓存导出所有未过期的项（无法直接枚举 TTLCache，使用工具索引反向获取）
      const items: ToolCacheItem[] = [];
      for (const keys of this.toolIndex.values()) {
        for (const key of keys) {
          const item = this.cache.get(key);
          if (item) {
            items.push(item);
          }
        }
      }

      fs.writeFileSync(this.cachePath, JSON.stringify(items, null, 2));
    } catch (error) {
      void handleError(error, {
        module: 'tools:cacheManager',
        action: 'saveCache',
      });
    }
  }
}

export const toolCacheManager = new ToolCacheManager();
