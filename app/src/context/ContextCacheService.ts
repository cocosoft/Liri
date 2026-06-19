/**
 * 上下文缓存服务（统一实现）
 * 合并 root 和 services 两个版本的接口
 */

import fs from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { TTLCache } from '@modules/utils/cache';

const logger = new Logger({ level: LogLevel.INFO });

export interface CacheConfig {
  ttl: number;
  maxSize: number;
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: 60000,
  maxSize: 100,
};

export class ContextCacheService {
  private static instance: ContextCacheService;
  private cache: TTLCache<unknown>;
  private fileWatchers: Map<string, fs.FSWatcher> = new Map();
  private config: CacheConfig;

  private constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.cache = new TTLCache<unknown>(this.config.maxSize, this.config.ttl);
  }

  static getInstance(config?: Partial<CacheConfig>): ContextCacheService {
    if (!ContextCacheService.instance) {
      ContextCacheService.instance = new ContextCacheService(config);
    }
    return ContextCacheService.instance;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    this.cache.set(key, value, ttl ?? this.config.ttl);
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get(key);
    return value === null ? undefined : (value as T);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size();
  }

  clearFileWatchers(): void {
    for (const watcher of this.fileWatchers.values()) {
      watcher.close();
    }
    this.fileWatchers.clear();
  }

  watchFile(filePath: string, cacheKeys?: string[]): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    if (this.fileWatchers.has(filePath)) {
      this.fileWatchers.get(filePath)?.close();
    }
    try {
      const watcher = fs.watch(filePath, (eventType) => {
        if (eventType === 'change' || eventType === 'rename') {
          logger.info(`File changed: ${filePath}`);
          if (cacheKeys) {
            for (const key of cacheKeys) {
              this.delete(key);
            }
          } else {
            this.clear();
          }
        }
      });
      this.fileWatchers.set(filePath, watcher);
    } catch (error) {
      logger.error(`Failed to watch file: ${filePath}`, { error });
    }
  }

  watchDirectory(dirPath: string, cacheKeys?: string[]): void {
    if (!fs.existsSync(dirPath)) {
      return;
    }
    if (this.fileWatchers.has(dirPath)) {
      this.fileWatchers.get(dirPath)?.close();
    }
    try {
      const watcher = fs.watch(
        dirPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename && (eventType === 'change' || eventType === 'rename')) {
            logger.info(`Directory changed: ${filename}`);
            if (cacheKeys) {
              for (const key of cacheKeys) {
                this.delete(key);
              }
            } else {
              this.clear();
            }
          }
        }
      );
      this.fileWatchers.set(dirPath, watcher);
    } catch (error) {
      logger.error(`Failed to watch directory: ${dirPath}`, { error });
    }
  }

  getStats(): {
    size: number;
    maxSize: number;
    ttl: number;
  } {
    return {
      size: this.cache.size(),
      maxSize: this.config.maxSize,
      ttl: this.config.ttl,
    };
  }

  setDefaultTTL(ttl: number): void {
    this.config.ttl = ttl;
  }

  getDefaultTTL(): number {
    return this.config.ttl;
  }

  memoize<T extends (...args: any[]) => any>(
    fn: T,
    keyGenerator?: (...args: Parameters<T>) => string
  ): T {
    const cache = this;
    const memoized = async function (
      ...args: Parameters<T>
    ): Promise<ReturnType<T>> {
      const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);
      const cached = cache.get<ReturnType<T>>(key);
      if (cached !== undefined) {
        return cached;
      }
      const result = await fn(...args);
      cache.set(key, result);
      return result;
    } as T;
    return memoized;
  }
}

export const ContextCacheKeys = {
  GIT_STATUS: 'context:git_status',
  USER_CONTEXT: 'context:user_context',
  SYSTEM_CONTEXT: 'context:system_context',
  ALL: 'context:*',
} as const;

export function getContextCacheService(): ContextCacheService {
  return ContextCacheService.getInstance();
}

export function clearContextCache(): void {
  getContextCacheService().clear();
}

export function clearContextCacheByKey(key: string): void {
  getContextCacheService().delete(key);
}

export const contextCacheService = ContextCacheService.getInstance();

export function memoize<T extends (...args: any[]) => any>(
  fn: T,
  keyGenerator?: (...args: Parameters<T>) => string
): T {
  return contextCacheService.memoize(fn, keyGenerator);
}
