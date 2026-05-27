/**
 * 工具缓存
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import crypto from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { resolveCacheDir } from '@modules/config/paths';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 缓存项
 */
export interface CacheItem {
  /**
   * 缓存键
   */
  key: string;

  /**
   * 缓存值
   */
  value: any;

  /**
   * 创建时间
   */
  createdAt: Date;

  /**
   * 过期时间
   */
  expiresAt: Date;
}

/**
 * 工具缓存
 */
export class ToolCache {
  private memoryCache: Map<string, CacheItem> = new Map();
  private diskCacheDir: string;
  private defaultTTL: number = 3600000; // 默认1小时

  /**
   * 构造函数
   */
  constructor(cacheDir: string = resolveCacheDir()) {
    this.diskCacheDir = cacheDir;
    this.ensureCacheDir();
    this.loadDiskCache();
  }

  /**
   * 确保缓存目录存在
   */
  private ensureCacheDir(): void {
    const { mkdirSync } = require('fs');
    const { existsSync } = require('fs');

    if (!existsSync(this.diskCacheDir)) {
      mkdirSync(this.diskCacheDir, { recursive: true });
    }
  }

  /**
   * 加载磁盘缓存
   */
  private loadDiskCache(): void {
    const { readdirSync, existsSync } = require('fs');
    const { join } = require('path');

    if (!existsSync(this.diskCacheDir)) {
      return;
    }

    const files = readdirSync(this.diskCacheDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const path = join(this.diskCacheDir, file);
        try {
          const data = readFileSync(path, 'utf8');
          const item = JSON.parse(data);
          item.createdAt = new Date(item.createdAt);
          item.expiresAt = new Date(item.expiresAt);

          if (item.expiresAt > new Date()) {
            this.memoryCache.set(item.key, item);
          } else {
            // 删除过期缓存
            unlinkSync(path);
          }
        } catch (error) {
          logger.error(`Error loading cache file ${file}:`, { error });
        }
      }
    }
  }

  /**
   * 设置缓存
   */
  async set(
    key: string,
    value: any,
    ttl: number = this.defaultTTL
  ): Promise<void> {
    const now = new Date();
    const item: CacheItem = {
      key,
      value,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttl),
    };

    // 存入内存缓存
    this.memoryCache.set(key, item);

    // 存入磁盘缓存
    const cacheFile = join(this.diskCacheDir, `${this.hashKey(key)}.json`);
    try {
      writeFileSync(cacheFile, JSON.stringify(item, null, 2), 'utf8');
    } catch (error) {
      logger.error('Error writing cache to disk:', { error });
    }
  }

  /**
   * 获取缓存
   */
  async get(key: string): Promise<any | null> {
    const item = this.memoryCache.get(key);

    if (!item) {
      // 尝试从磁盘加载
      const cacheFile = join(this.diskCacheDir, `${this.hashKey(key)}.json`);
      if (existsSync(cacheFile)) {
        try {
          const data = readFileSync(cacheFile, 'utf8');
          const diskItem = JSON.parse(data);
          diskItem.createdAt = new Date(diskItem.createdAt);
          diskItem.expiresAt = new Date(diskItem.expiresAt);

          if (diskItem.expiresAt > new Date()) {
            this.memoryCache.set(key, diskItem);
            return diskItem.value;
          } else {
            // 删除过期缓存
            unlinkSync(cacheFile);
          }
        } catch (error) {
          logger.error('Error reading cache from disk:', { error });
        }
      }
      return null;
    }

    if (item.expiresAt > new Date()) {
      return item.value;
    } else {
      // 删除过期缓存
      this.memoryCache.delete(key);
      const cacheFile = join(this.diskCacheDir, `${this.hashKey(key)}.json`);
      if (existsSync(cacheFile)) {
        try {
          unlinkSync(cacheFile);
        } catch (error) {
          logger.error('Error deleting expired cache:', { error });
        }
      }
      return null;
    }
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key);
    const cacheFile = join(this.diskCacheDir, `${this.hashKey(key)}.json`);
    if (existsSync(cacheFile)) {
      try {
        unlinkSync(cacheFile);
      } catch (error) {
        logger.error('Error deleting cache:', { error });
      }
    }
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    this.memoryCache.clear();
    const { readdirSync, existsSync, unlinkSync } = require('fs');
    const { join } = require('path');

    if (existsSync(this.diskCacheDir)) {
      const files = readdirSync(this.diskCacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const path = join(this.diskCacheDir, file);
          try {
            unlinkSync(path);
          } catch (error) {
            logger.error(`Error deleting cache file ${file}:`, { error });
          }
        }
      }
    }
  }

  /**
   * 生成缓存键哈希
   */
  private hashKey(key: string): string {
    return crypto.createHash('md5').update(key).digest('hex');
  }

  /**
   * 生成缓存键
   */
  generateKey(toolId: string, params: any): string {
    const key = `${toolId}:${JSON.stringify(params)}`;
    return this.hashKey(key);
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.memoryCache.size;
  }

  /**
   * 清理过期缓存
   */
  cleanup(): void {
    const now = new Date();
    const expiredKeys: string[] = [];

    for (const [key, item] of this.memoryCache) {
      if (item.expiresAt <= now) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.memoryCache.delete(key);
      const cacheFile = join(this.diskCacheDir, `${this.hashKey(key)}.json`);
      if (existsSync(cacheFile)) {
        try {
          unlinkSync(cacheFile);
        } catch (error) {
          logger.error('Error deleting expired cache:', { error });
        }
      }
    }
  }
}

/**
 * 全局工具缓存实例
 */
export const toolCache = new ToolCache();
