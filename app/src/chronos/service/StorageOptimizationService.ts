/**
 * 存储优化服务
 * 实现文件系统存储和缓存机制，优化数据库访问
 */

import { Logger, LogLevel } from '@modules/monitoring';
import {
  readFile,
  writeFile,
  mkdir,
  access,
  readdir,
  unlink,
} from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { resolveDataDir } from '@modules/core';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 缓存项
 */
interface CacheItem<T> {
  value: T;
  expiresAt: number;
}

/**
 * 存储配置
 */
export interface StorageConfig {
  fileStoragePath: string;
  enableFileStorage: boolean;
  enableCache: boolean;
  cacheTTLMs: number;
  maxCacheSize: number;
  persistCache: boolean;
  cacheFilePath: string;
}

/**
 * 存储统计
 */
export interface StorageStats {
  fileStorageEnabled: boolean;
  cacheEnabled: boolean;
  cacheSize: number;
  cacheHits: number;
  cacheMisses: number;
  fileOperations: number;
  dbOperations: number;
}

/**
 * 存储优化服务类
 */
export class StorageOptimizationService {
  private static instance: StorageOptimizationService;
  private config: StorageConfig = {
    fileStoragePath: join(resolveDataDir(), 'chronos_tasks.json'),
    enableFileStorage: true,
    enableCache: true,
    cacheTTLMs: 60000,
    maxCacheSize: 1000,
    persistCache: false,
    cacheFilePath: join(resolveDataDir(), 'chronos_cache.json'),
  };

  private memoryCache: Map<string, CacheItem<unknown>> = new Map();
  private cacheStats = {
    hits: 0,
    misses: 0,
    fileOperations: 0,
    dbOperations: 0,
  };
  private accessTimes: Map<string, number> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): StorageOptimizationService {
    if (!StorageOptimizationService.instance) {
      StorageOptimizationService.instance = new StorageOptimizationService();
    }
    return StorageOptimizationService.instance;
  }

  /**
   * 更新配置
   * @param config 新配置
   */
  updateConfig(config: Partial<StorageConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取配置
   * @returns 配置
   */
  getConfig(): StorageConfig {
    return { ...this.config };
  }

  /**
   * 确保目录存在
   * @param filePath 文件路径
   */
  private async ensureDirectory(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  /**
   * 检查文件是否存在
   * @param filePath 文件路径
   * @returns 是否存在
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 从缓存获取数据
   * @param key 缓存键
   * @returns 缓存值
   */
  private getFromCache<T>(key: string): T | null {
    if (!this.config.enableCache) {
      return null;
    }

    const item = this.memoryCache.get(key) as CacheItem<T> | undefined;
    if (!item) {
      this.cacheStats.misses++;
      return null;
    }

    if (Date.now() > item.expiresAt) {
      this.memoryCache.delete(key);
      this.cacheStats.misses++;
      return null;
    }

    this.cacheStats.hits++;
    this.accessTimes.set(key, Date.now());
    return item.value;
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   */
  private setCache<T>(key: string, value: T): void {
    if (!this.config.enableCache) {
      return;
    }

    if (this.memoryCache.size >= this.config.maxCacheSize) {
      this.evictLeastRecentlyUsed();
    }

    const item: CacheItem<T> = {
      value,
      expiresAt: Date.now() + this.config.cacheTTLMs,
    };

    this.memoryCache.set(key, item);
    this.accessTimes.set(key, Date.now());
  }

  /**
   * 删除缓存
   * @param key 缓存键
   */
  private deleteCache(key: string): void {
    this.memoryCache.delete(key);
    this.accessTimes.delete(key);
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.memoryCache.clear();
    this.accessTimes.clear();
  }

  /**
   * 驱逐最近最少使用的缓存项
   */
  private evictLeastRecentlyUsed(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, time] of this.accessTimes) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.memoryCache.delete(oldestKey);
      this.accessTimes.delete(oldestKey);
    }
  }

  /**
   * 从文件读取数据
   * @param filePath 文件路径
   * @returns 数据
   */
  async readFromFile<T>(filePath: string): Promise<T | null> {
    if (!this.config.enableFileStorage) {
      return null;
    }

    const cacheKey = `file:${filePath}`;
    const cached = this.getFromCache<T>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    try {
      this.cacheStats.fileOperations++;
      await this.ensureDirectory(filePath);

      const exists = await this.fileExists(filePath);
      if (!exists) {
        return null;
      }

      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as T;

      this.setCache(cacheKey, data);

      return data;
    } catch (error) {
      logger.error(`Failed to read from file ${filePath}:`, error);
      return null;
    }
  }

  /**
   * 写入数据到文件
   * @param filePath 文件路径
   * @param data 数据
   */
  async writeToFile<T>(filePath: string, data: T): Promise<boolean> {
    if (!this.config.enableFileStorage) {
      return false;
    }

    try {
      this.cacheStats.fileOperations++;
      await this.ensureDirectory(filePath);

      const content = JSON.stringify(data, null, 2);
      await writeFile(filePath, content, 'utf-8');

      const cacheKey = `file:${filePath}`;
      this.setCache(cacheKey, data);

      return true;
    } catch (error) {
      logger.error(`Failed to write to file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * 删除文件
   * @param filePath 文件路径
   * @returns 是否成功
   */
  async deleteFile(filePath: string): Promise<boolean> {
    if (!this.config.enableFileStorage) {
      return false;
    }

    try {
      this.cacheStats.fileOperations++;
      const exists = await this.fileExists(filePath);
      if (!exists) {
        return true;
      }

      await unlink(filePath);

      const cacheKey = `file:${filePath}`;
      this.deleteCache(cacheKey);

      return true;
    } catch (error) {
      logger.error(`Failed to delete file ${filePath}:`, error);
      return false;
    }
  }

  /**
   * 读取任务文件
   * @param filePath 文件路径
   * @returns 任务数组
   */
  async readTaskFile<T extends { id: string }>(
    filePath?: string
  ): Promise<T[]> {
    const path = filePath || this.config.fileStoragePath;
    const data = await this.readFromFile<T[]>(path);
    return data || [];
  }

  /**
   * 写入任务文件
   * @param tasks 任务数组
   * @param filePath 文件路径
   * @returns 是否成功
   */
  async writeTaskFile<T extends { id: string }>(
    tasks: T[],
    filePath?: string
  ): Promise<boolean> {
    const path = filePath || this.config.fileStoragePath;
    return this.writeToFile(path, tasks);
  }

  /**
   * 获取缓存命中率
   * @returns 命中率
   */
  getCacheHitRate(): number {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return total > 0 ? this.cacheStats.hits / total : 0;
  }

  /**
   * 获取统计信息
   * @returns 统计信息
   */
  getStats(): StorageStats {
    return {
      fileStorageEnabled: this.config.enableFileStorage,
      cacheEnabled: this.config.enableCache,
      cacheSize: this.memoryCache.size,
      cacheHits: this.cacheStats.hits,
      cacheMisses: this.cacheStats.misses,
      fileOperations: this.cacheStats.fileOperations,
      dbOperations: this.cacheStats.dbOperations,
    };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.cacheStats = {
      hits: 0,
      misses: 0,
      fileOperations: 0,
      dbOperations: 0,
    };
  }

  /**
   * 保存缓存到磁盘
   */
  async persistCache(): Promise<void> {
    if (!this.config.persistCache) {
      return;
    }

    try {
      const cacheData: Record<string, unknown> = {};
      for (const [key, item] of this.memoryCache) {
        if (Date.now() < item.expiresAt) {
          cacheData[key] = item.value;
        }
      }

      await this.writeToFile(this.config.cacheFilePath, cacheData);
    } catch (error) {
      logger.error('Failed to persist cache:', error);
    }
  }

  /**
   * 从磁盘加载缓存
   */
  async loadCache(): Promise<void> {
    if (!this.config.persistCache) {
      return;
    }

    try {
      const exists = await this.fileExists(this.config.cacheFilePath);
      if (!exists) {
        return;
      }

      const content = await readFile(this.config.cacheFilePath, 'utf-8');
      const cacheData = JSON.parse(content) as Record<string, unknown>;

      for (const [key, value] of Object.entries(cacheData)) {
        this.memoryCache.set(key, {
          value,
          expiresAt: Date.now() + this.config.cacheTTLMs,
        });
      }
    } catch (error) {
      logger.error('Failed to load cache:', error);
    }
  }

  /**
   * 获取文件列表
   * @param dirPath 目录路径
   * @returns 文件列表
   */
  async listFiles(dirPath: string): Promise<string[]> {
    try {
      this.cacheStats.fileOperations++;
      const files = await readdir(dirPath);
      return files;
    } catch (error) {
      logger.error(`Failed to list files in ${dirPath}:`, error);
      return [];
    }
  }

  /**
   * 批量读取文件
   * @param filePaths 文件路径数组
   * @returns 数据数组
   */
  async batchReadFiles<T>(filePaths: string[]): Promise<(T | null)[]> {
    const results: (T | null)[] = [];

    for (const filePath of filePaths) {
      const data = await this.readFromFile<T>(filePath);
      results.push(data);
    }

    return results;
  }

  /**
   * 批量写入文件
   * @param files 文件数据数组
   * @returns 是否全部成功
   */
  async batchWriteFiles<T>(
    files: { path: string; data: T }[]
  ): Promise<boolean[]> {
    const results: boolean[] = [];

    for (const file of files) {
      const success = await this.writeToFile(file.path, file.data);
      results.push(success);
    }

    return results;
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.clearCache();
    this.resetStats();
  }
}

/**
 * 导出单例
 */
export const storageOptimizationService =
  StorageOptimizationService.getInstance();
