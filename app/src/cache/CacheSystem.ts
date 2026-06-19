/**
 * 缓存系统
 * 提供持久化存储、版本管理和并发控制功能
 */

import { join } from 'path';
import { randomBytes } from 'crypto';
import { resolveCacheDir } from '@modules/core';
import {
  open,
  writeFile,
  readFile,
  mkdir,
  rename,
  unlink,
  readdir,
  stat,
} from 'fs/promises';
import { logForDebugging } from '../utils/debug.js';
import { isEnvTruthy } from '../utils/envUtils.js';
import { configManager } from '@modules/config';
import { jsonStringify, jsonParse } from '../performance/SlowOperations.js';
import {
  type PersistentCacheItem,
  type PersistentCache,
  type PersistentCacheStorage,
  type CacheVersion,
} from './types.js';

/**
 * 缓存版本常量
 */
export const CACHE_VERSION = 1;
export const MIN_MIGRATABLE_VERSION = 1;

/**
 * 全局锁机制
 * 防止并发缓存操作
 */
let cacheLockPromise: Promise<void> | null = null;

/**
 * 执行带锁的缓存操作
 */
export async function withCacheLock<T>(fn: () => Promise<T>): Promise<T> {
  // 等待现有锁释放
  while (cacheLockPromise) {
    await cacheLockPromise;
  }

  // 创建新锁
  let releaseLock: (() => void) | undefined;
  cacheLockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  try {
    return await fn();
  } finally {
    // 释放锁
    cacheLockPromise = null;
    releaseLock?.();
  }
}

/**
 * 内存存储实现
 */
export class MemoryStorage implements PersistentCacheStorage {
  private data: Map<string, PersistentCacheItem> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // 启动定期清理过期缓存的任务
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60000);
  }

  async get<T = unknown>(
    key: string
  ): Promise<PersistentCacheItem<T> | undefined> {
    const item = this.data.get(key);
    if (!item) return undefined;

    // 检查是否过期
    if (item.expiry && Date.now() > item.expiry) {
      this.data.delete(key);
      return undefined;
    }

    return item as PersistentCacheItem<T>;
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: {
      expiry?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    const item: PersistentCacheItem<T> = {
      key,
      value,
      timestamp: Date.now(),
      expiry: options?.expiry,
      metadata: options?.metadata,
    };
    this.data.set(key, item as PersistentCacheItem);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.data.clear();
  }

  /**
   * 清理过期的缓存项
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.data.entries()) {
      if (item.expiry && now > item.expiry) {
        this.data.delete(key);
      }
    }
  }
}

/**
 * 磁盘存储实现
 */
export class DiskStorage implements PersistentCacheStorage {
  private cacheDir: string;
  private memoryCache = new MemoryStorage();
  private isInitialized = false;
  private cacheFileName = 'cache.json';

  constructor(cacheDir: string) {
    this.cacheDir = cacheDir;
  }

  /**
   * 生成随机临时文件名
   */
  private generateTempFileName(baseName: string): string {
    const randomHex = randomBytes(8).toString('hex');
    return `${baseName}.${randomHex}.tmp`;
  }

  /**
   * 原子写入文件
   * 使用临时文件+重命名模式防止文件损坏
   */
  private async atomicWriteFile(
    filePath: string,
    content: string
  ): Promise<void> {
    const tempPath = join(this.cacheDir, this.generateTempFileName('cache'));

    try {
      // 确保目录存在
      await mkdir(this.cacheDir, { recursive: true });

      // 写入临时文件
      const handle = await open(tempPath, 'w', 0o600);
      try {
        await handle.writeFile(content, 'utf-8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      // 原子重命名
      await rename(tempPath, filePath);
    } catch (error) {
      // 清理临时文件
      try {
        await unlink(tempPath);
      } catch {
        // 忽略清理错误
      }
      throw error;
    }
  }

  /**
   * 迁移旧版本缓存
   */
  private migrateCache(parsed: unknown): PersistentCache | null {
    const cacheData = parsed as Record<string, unknown>;
    if (
      typeof cacheData.version !== 'number' ||
      cacheData.version < MIN_MIGRATABLE_VERSION ||
      cacheData.version > CACHE_VERSION
    ) {
      return null;
    }

    if (typeof cacheData.data !== 'object' || cacheData.data === null) {
      return null;
    }

    const migrated: PersistentCache = {
      version: CACHE_VERSION,
      lastUpdated: (cacheData.lastUpdated as number) || Date.now(),
      data: {},
    };

    for (const [key, item] of Object.entries(
      cacheData.data as Record<string, unknown>
    )) {
      if (item && typeof item === 'object' && 'value' in item) {
        const record = item as Record<string, unknown>;
        migrated.data[key] = {
          key,
          value: record.value,
          timestamp: (record.timestamp as number) || Date.now(),
          expiry: record.expiry as number | undefined,
          metadata: record.metadata as Record<string, unknown> | undefined,
        };
      }
    }

    logForDebugging(
      `缓存已从版本 ${String(cacheData.version)} 迁移到 ${CACHE_VERSION}`
    );
    return migrated;
  }

  /**
   * 创建空缓存
   */
  private createEmptyCache(): PersistentCache {
    return {
      version: CACHE_VERSION,
      lastUpdated: Date.now(),
      data: {},
    };
  }

  /**
   * 从磁盘加载缓存
   */
  private async loadCacheFromDisk(): Promise<PersistentCache> {
    const cachePath = join(this.cacheDir, this.cacheFileName);

    try {
      const content = await readFile(cachePath, 'utf-8');
      const parsed = jsonParse(content);

      // 检查版本
      if (parsed.version !== CACHE_VERSION) {
        const migrated = this.migrateCache(parsed);
        if (!migrated) {
          logForDebugging(`缓存版本 ${parsed.version} 不可迁移，使用空缓存`);
          return this.createEmptyCache();
        }
        // 保存迁移后的缓存
        await this.saveCacheToDisk(migrated);
        return migrated;
      }

      // 验证结构
      if (typeof parsed.data !== 'object' || parsed.data === null) {
        logForDebugging('缓存结构无效，使用空缓存');
        return this.createEmptyCache();
      }

      return parsed as PersistentCache;
    } catch (error) {
      logForDebugging(
        `加载缓存失败: ${error instanceof Error ? error.message : String(error)}`
      );
      return this.createEmptyCache();
    }
  }

  /**
   * 保存缓存到磁盘
   */
  private async saveCacheToDisk(cache: PersistentCache): Promise<void> {
    const cachePath = join(this.cacheDir, this.cacheFileName);
    cache.lastUpdated = Date.now();
    const content = jsonStringify(cache, null, 2);
    await this.atomicWriteFile(cachePath, content);
  }

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 确保缓存目录存在
      await mkdir(this.cacheDir, { recursive: true });

      // 从磁盘加载缓存
      const cache = await this.loadCacheFromDisk();

      // 加载到内存缓存
      for (const [key, item] of Object.entries(cache.data)) {
        try {
          // 检查是否过期
          if (!item.expiry || Date.now() < item.expiry) {
            await this.memoryCache.set(key, item.value, {
              expiry: item.expiry,
              metadata: item.metadata,
            });
          }
        } catch (error) {
          logForDebugging(
            `加载缓存项 ${key} 失败: ${error instanceof Error ? error.message : String(error)}`,
            { level: 'warn' }
          );
        }
      }

      this.isInitialized = true;
      logForDebugging(`磁盘存储已初始化: ${this.cacheDir}`);
    } catch (error) {
      logForDebugging(
        `初始化磁盘存储失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'error' }
      );
      throw error;
    }
  }

  async get<T = unknown>(
    key: string
  ): Promise<PersistentCacheItem<T> | undefined> {
    await this.initialize();
    return this.memoryCache.get<T>(key);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: {
      expiry?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.initialize();

    // 先更新内存缓存
    await this.memoryCache.set(key, value, options);

    // 然后持久化到磁盘
    try {
      await withCacheLock(async () => {
        const cache = await this.loadCacheFromDisk();
        cache.data[key] = {
          key,
          value,
          timestamp: Date.now(),
          expiry: options?.expiry,
          metadata: options?.metadata,
        };
        await this.saveCacheToDisk(cache);
        logForDebugging(`缓存项已持久化: ${key}`);
      });
    } catch (error) {
      logForDebugging(
        `持久化缓存项 ${key} 失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' }
      );
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.initialize();

    // 先从内存缓存中删除
    const deleted = await this.memoryCache.delete(key);
    if (!deleted) return false;

    // 然后从磁盘中删除
    try {
      await withCacheLock(async () => {
        const cache = await this.loadCacheFromDisk();
        delete cache.data[key];
        await this.saveCacheToDisk(cache);
        logForDebugging(`缓存项已删除: ${key}`);
      });
    } catch (error) {
      logForDebugging(
        `删除缓存项 ${key} 失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' }
      );
    }

    return true;
  }

  async clear(): Promise<void> {
    await this.initialize();

    // 清空内存缓存
    await this.memoryCache.clear();

    // 清空磁盘缓存
    try {
      await withCacheLock(async () => {
        const emptyCache = this.createEmptyCache();
        await this.saveCacheToDisk(emptyCache);
        logForDebugging('缓存已清空');
      });
    } catch (error) {
      logForDebugging(
        `清空磁盘缓存失败: ${error instanceof Error ? error.message : String(error)}`,
        { level: 'warn' }
      );
    }
  }

  async keys(): Promise<string[]> {
    await this.initialize();
    return this.memoryCache.keys();
  }

  async close(): Promise<void> {
    await this.memoryCache.close();
  }
}

/**
 * 缓存系统
 */
export class CacheSystem {
  private storage: PersistentCacheStorage;
  private version: string = '1.0.0';
  private versionHistory: CacheVersion[] = [];

  constructor(storage: PersistentCacheStorage) {
    this.storage = storage;
    this.versionHistory.push({
      version: this.version,
      timestamp: Date.now(),
      description: 'Initial version',
    });
  }

  /**
   * 获取缓存
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const item = await this.storage.get<T>(key);
    return item?.value;
  }

  /**
   * 设置缓存
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options?: {
      expiry?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await withCacheLock(async () => {
      await this.storage.set(key, value, options);
    });
  }

  /**
   * 删除缓存
   */
  async delete(key: string): Promise<boolean> {
    return await withCacheLock(async () => {
      return await this.storage.delete(key);
    });
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    await withCacheLock(async () => {
      await this.storage.clear();
    });
  }

  /**
   * 获取所有缓存键
   */
  async keys(): Promise<string[]> {
    return await this.storage.keys();
  }

  /**
   * 获取缓存项的详细信息
   */
  async getItem<T = unknown>(
    key: string
  ): Promise<PersistentCacheItem<T> | undefined> {
    return await this.storage.get<T>(key);
  }

  /**
   * 检查缓存项是否存在
   */
  async has(key: string): Promise<boolean> {
    const item = await this.storage.get(key);
    return item !== undefined;
  }

  /**
   * 获取缓存大小（键的数量）
   */
  async size(): Promise<number> {
    const keys = await this.storage.keys();
    return keys.length;
  }

  /**
   * 关闭缓存系统
   */
  async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * 获取当前版本
   */
  getVersion(): string {
    return this.version;
  }

  /**
   * 升级版本
   */
  upgradeVersion(description: string): string {
    // 简单的版本号递增逻辑
    const parts = this.version.split('.').map(Number);
    parts[2]++; // 增加补丁版本
    this.version = parts.join('.');

    this.versionHistory.push({
      version: this.version,
      timestamp: Date.now(),
      description,
    });

    return this.version;
  }

  /**
   * 获取版本历史
   */
  getVersionHistory(): CacheVersion[] {
    return [...this.versionHistory];
  }

  /**
   * 执行版本迁移
   */
  async migrateVersion(
    fromVersion: string,
    toVersion: string
  ): Promise<boolean> {
    // 这里可以实现版本迁移逻辑
    // 例如从旧版本的缓存格式迁移到新版本
    logForDebugging(`执行版本迁移: ${fromVersion} -> ${toVersion}`);
    return true;
  }
}

/**
 * 创建缓存系统实例
 */
export function createCacheSystem(options?: {
  storage?: PersistentCacheStorage;
  cacheDir?: string;
}): CacheSystem {
  let storage: PersistentCacheStorage;

  if (options?.storage) {
    storage = options.storage;
  } else if (options?.cacheDir) {
    storage = new DiskStorage(options.cacheDir);
  } else {
    storage = new MemoryStorage();
  }

  return new CacheSystem(storage);
}

/**
 * 全局缓存系统实例
 */
let globalCacheSystem: CacheSystem | null = null;

/**
 * 获取全局缓存系统实例
 */
export function getCacheSystem(): CacheSystem {
  if (!globalCacheSystem) {
    const cacheDir = configManager.env('Liri_CACHE_DIR') || resolveCacheDir();
    globalCacheSystem = createCacheSystem({ cacheDir });
  }
  return globalCacheSystem;
}

/**
 * 初始化全局缓存系统
 */
export async function initializeCacheSystem(): Promise<void> {
  const cacheSystem = getCacheSystem();
  // 这里可以添加初始化逻辑
  logForDebugging('缓存系统初始化完成');
}

/**
 * 关闭全局缓存系统
 */
export async function shutdownCacheSystem(): Promise<void> {
  if (globalCacheSystem) {
    await globalCacheSystem.close();
    globalCacheSystem = null;
    logForDebugging('缓存系统已关闭');
  }
}
