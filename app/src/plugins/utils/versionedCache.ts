/**
 * 版本化缓存管理器
 * 支持版本化的插件缓存和失效策略
 * 参考CC源码 cc_code/backend/utils/plugins/zipCache.ts 实现
 */

import { readFile, writeFile, readdir, rm, stat, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 缓存条目信息
 */
export interface CacheEntry {
  key: string;
  version: string;
  path: string;
  createdAt: string;
  size: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  oldestEntry?: string;
  newestEntry?: string;
  byVersion: Record<string, number>;
}

/**
 * 缓存失效策略
 */
export type CacheEvictionPolicy = 'lru' | 'fifo' | 'lfu' | 'size';

/**
 * 缓存配置
 */
export interface VersionedCacheConfig {
  baseDir: string;
  maxSize?: number;
  maxAge?: number;
  maxEntries?: number;
  evictionPolicy?: CacheEvictionPolicy;
}

/**
 * 版本化缓存管理器
 */
export class VersionedCacheManager {
  private config: Required<VersionedCacheConfig>;
  private index: Map<string, CacheEntry> = new Map();
  private accessLog: Map<string, number> = new Map();
  private initialized: boolean = false;

  constructor(config: VersionedCacheConfig) {
    this.config = {
      baseDir: config.baseDir,
      maxSize: config.maxSize || 1024 * 1024 * 1024,
      maxAge: config.maxAge || 7 * 24 * 60 * 60 * 1000,
      maxEntries: config.maxEntries || 1000,
      evictionPolicy: config.evictionPolicy || 'lru',
    };
  }

  /**
   * 初始化缓存管理器
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.config.baseDir, { recursive: true });
      await this.loadIndex();
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize versioned cache:', error);
      throw error;
    }
  }

  /**
   * 加载缓存索引
   */
  private async loadIndex(): Promise<void> {
    const indexPath = this.getIndexPath();

    try {
      const content = await readFile(indexPath, 'utf-8');
      const data = JSON.parse(content) as CacheEntry[];

      this.index.clear();
      for (const entry of data) {
        this.index.set(entry.key, entry);
      }
    } catch {
      this.index.clear();
    }
  }

  /**
   * 保存缓存索引
   */
  private async saveIndex(): Promise<void> {
    const indexPath = this.getIndexPath();
    const data = Array.from(this.index.values());

    try {
      await mkdir(dirname(indexPath), { recursive: true });
      await writeFile(indexPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error('Failed to save cache index:', error);
    }
  }

  /**
   * 获取索引文件路径
   */
  private getIndexPath(): string {
    return join(this.config.baseDir, 'cache-index.json');
  }

  /**
   * 生成版本化缓存键
   */
  generateCacheKey(pluginId: string, version: string): string {
    const input = `${pluginId}:${version}`;
    const hash = createHash('sha256')
      .update(input)
      .digest('hex')
      .substring(0, 16);
    return `${pluginId}-${hash}`;
  }

  /**
   * 获取缓存路径
   */
  getCachePath(key: string, version: string): string {
    const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedVersion = version.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.config.baseDir, sanitizedKey, sanitizedVersion);
  }

  /**
   * 检查缓存是否存在
   */
  async has(key: string, version: string): Promise<boolean> {
    const cacheKey = this.generateCacheKey(key, version);
    const entry = this.index.get(cacheKey);

    if (!entry) return false;

    if (this.isExpired(entry)) {
      await this.evict(cacheKey);
      return false;
    }

    this.accessLog.set(cacheKey, Date.now());
    return true;
  }

  /**
   * 获取缓存条目
   */
  async get(key: string, version: string): Promise<CacheEntry | undefined> {
    const cacheKey = this.generateCacheKey(key, version);
    const entry = this.index.get(cacheKey);

    if (!entry) return undefined;

    if (this.isExpired(entry)) {
      await this.evict(cacheKey);
      return undefined;
    }

    this.accessLog.set(cacheKey, Date.now());
    return entry;
  }

  /**
   * 设置缓存
   */
  async set(
    key: string,
    version: string,
    path: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.initialize();

    const cacheKey = this.generateCacheKey(key, version);
    const entry: CacheEntry = {
      key: cacheKey,
      version,
      path,
      createdAt: new Date().toISOString(),
      size: 0,
      metadata,
    };

    try {
      const stats = await stat(path);
      entry.size = stats.size;
    } catch {
      entry.size = 0;
    }

    this.index.set(cacheKey, entry);
    this.accessLog.set(cacheKey, Date.now());

    await this.saveIndex();
    await this.enforceLimits();
  }

  /**
   * 删除缓存
   */
  async delete(key: string, version: string): Promise<void> {
    const cacheKey = this.generateCacheKey(key, version);
    await this.evict(cacheKey);
  }

  /**
   * 驱逐缓存条目
   */
  private async evict(cacheKey: string): Promise<void> {
    const entry = this.index.get(cacheKey);

    if (entry) {
      try {
        await rm(entry.path, { recursive: true, force: true });
      } catch (error) {
        logger.error(`Failed to delete cache path ${entry.path}:`, error);
      }

      this.index.delete(cacheKey);
      this.accessLog.delete(cacheKey);
      await this.saveIndex();
    }
  }

  /**
   * 检查缓存是否过期
   */
  private isExpired(entry: CacheEntry): boolean {
    const age = Date.now() - new Date(entry.createdAt).getTime();
    return age > this.config.maxAge;
  }

  /**
   * 强制执行限制
   */
  private async enforceLimits(): Promise<void> {
    const stats = await this.getStats();

    if (stats.totalSize > this.config.maxSize) {
      await this.evictByPolicy();
    }

    if (stats.totalEntries > this.config.maxEntries) {
      await this.evictByPolicy();
    }
  }

  /**
   * 根据策略驱逐缓存
   */
  private async evictByPolicy(): Promise<void> {
    const entries = Array.from(this.index.entries());

    switch (this.config.evictionPolicy) {
      case 'lru':
        entries.sort(
          (a, b) =>
            (this.accessLog.get(a[0]) || 0) - (this.accessLog.get(b[0]) || 0)
        );
        break;

      case 'fifo':
        entries.sort(
          (a, b) =>
            new Date(a[1].createdAt).getTime() -
            new Date(b[1].createdAt).getTime()
        );
        break;

      case 'lfu':
        entries.sort(
          (a, b) =>
            (this.accessLog.get(a[0]) || 0) - (this.accessLog.get(b[0]) || 0)
        );
        break;

      case 'size':
        entries.sort((a, b) => b[1].size - a[1].size);
        break;
    }

    const toRemove = Math.ceil(entries.length * 0.2);

    for (let i = 0; i < toRemove && i < entries.length; i++) {
      await this.evict(entries[i][0]);
    }
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<CacheStats> {
    await this.initialize();

    const entries = Array.from(this.index.values());
    const stats: CacheStats = {
      totalEntries: entries.length,
      totalSize: 0,
      byVersion: {},
    };

    let oldestTime = Infinity;
    let newestTime = -Infinity;

    for (const entry of entries) {
      stats.totalSize += entry.size;

      if (!stats.byVersion[entry.version]) {
        stats.byVersion[entry.version] = 0;
      }
      stats.byVersion[entry.version]++;

      const createdTime = new Date(entry.createdAt).getTime();
      if (createdTime < oldestTime) {
        oldestTime = createdTime;
        stats.oldestEntry = entry.key;
      }
      if (createdTime > newestTime) {
        newestTime = createdTime;
        stats.newestEntry = entry.key;
      }
    }

    return stats;
  }

  /**
   * 清理过期缓存
   */
  async cleanExpired(): Promise<number> {
    await this.initialize();

    let removed = 0;
    const entries = Array.from(this.index.entries());

    for (const [key, entry] of entries) {
      if (this.isExpired(entry)) {
        await this.evict(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    const entries = Array.from(this.index.keys());

    for (const key of entries) {
      await this.evict(key);
    }

    this.index.clear();
    this.accessLog.clear();
  }

  /**
   * 获取所有缓存键
   */
  async keys(): Promise<string[]> {
    await this.initialize();
    return Array.from(this.index.keys());
  }

  /**
   * 获取特定版本的所有缓存
   */
  async getByVersion(version: string): Promise<CacheEntry[]> {
    await this.initialize();
    const entries = Array.from(this.index.values());
    return entries.filter((e) => e.version === version);
  }
}
