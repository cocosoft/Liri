/**
 * 上下文缓存服务
 * 实现上下文信息的缓存和清除
 */

import fs from 'fs';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 缓存条目
 */
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number | null;
}

/**
 * 上下文缓存服务
 */
export class ContextCacheService {
  private static instance: ContextCacheService;
  private cache: Map<string, CacheEntry<any>>;
  private fileWatchers: Map<string, fs.FSWatcher>;
  private defaultTTL: number; // 默认缓存生存时间（毫秒）

  private constructor(defaultTTL: number = 300000) {
    // 5分钟
    this.cache = new Map();
    this.fileWatchers = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * 获取单例实例
   */
  static getInstance(defaultTTL?: number): ContextCacheService {
    if (!ContextCacheService.instance) {
      ContextCacheService.instance = new ContextCacheService(defaultTTL);
    }
    return ContextCacheService.instance;
  }

  /**
   * 设置缓存
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      expiresAt: ttl ? now + ttl : null,
    };
    this.cache.set(key, entry);
  }

  /**
   * 获取缓存
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * 检查缓存是否存在
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // 检查是否过期
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清空所有文件监听器
   */
  clearFileWatchers(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }

  /**
   * 监听文件变化并清除缓存
   */
  watchFile(filePath: string, cacheKeys?: string[]): void {
    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      return;
    }

    // 如果已经有监听器，先关闭
    if (this.fileWatchers.has(filePath)) {
      this.fileWatchers.get(filePath)?.close();
    }

    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          logger.info(`[context] File changed: ${filePath}`);

          // 清除指定的缓存键
          if (cacheKeys) {
            for (const key of cacheKeys) {
              this.delete(key);
            }
          } else {
            // 清除所有缓存
            this.clear();
          }
        }
      });

      this.fileWatchers.set(filePath, watcher);
    } catch (error) {
      logger.error(`[context] Failed to watch file: ${filePath}`, { error });
    }
  }

  /**
   * 监听目录变化并清除缓存
   */
  watchDirectory(dirPath: string, cacheKeys?: string[]): void {
    // 检查目录是否存在
    if (!fs.existsSync(dirPath)) {
      return;
    }

    // 如果已经有监听器，先关闭
    if (this.fileWatchers.has(dirPath)) {
      this.fileWatchers.get(dirPath)?.close();
    }

    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename && (eventType === 'change' || eventType === 'rename')) {
            logger.info(`[context] Directory changed: ${filename}`);

            // 清除指定的缓存键
            if (cacheKeys) {
              for (const key of cacheKeys) {
                this.delete(key);
              }
            } else {
              // 清除所有缓存
              this.clear();
            }
          }
        }
      );

      this.fileWatchers.set(dirPath, watcher);
    } catch (error) {
      logger.error(`[context] Failed to watch directory: ${dirPath}`, {
        error,
      });
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    size: number;
    keys: string[];
    memoryUsage: number;
  } {
    const keys = Array.from(this.cache.keys());
    let memoryUsage = 0;

    for (const entry of this.cache.values()) {
      memoryUsage += JSON.stringify(entry.value).length;
    }

    return {
      size: this.cache.size,
      keys,
      memoryUsage,
    };
  }

  /**
   * 清除过期缓存
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 设置默认TTL
   */
  setDefaultTTL(ttl: number): void {
    this.defaultTTL = ttl;
  }

  /**
   * 获取默认TTL
   */
  getDefaultTTL(): number {
    return this.defaultTTL;
  }
}

/**
 * 缓存键常量
 */
export const ContextCacheKeys = {
  GIT_STATUS: 'context:git_status',
  USER_CONTEXT: 'context:user_context',
  SYSTEM_CONTEXT: 'context:system_context',
  ALL: 'context:*',
} as const;

/**
 * 获取上下文缓存服务实例
 */
export function getContextCacheService(): ContextCacheService {
  return ContextCacheService.getInstance();
}

/**
 * 清除上下文缓存
 */
export function clearContextCache(): void {
  const service = getContextCacheService();
  service.clear();
}

/**
 * 清除指定上下文缓存
 */
export function clearContextCacheByKey(key: string): void {
  const service = getContextCacheService();
  service.delete(key);
}
