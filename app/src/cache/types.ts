// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 缓存系统类型定义
 */

/**
 * 缓存项
 */
export interface CacheItem<T> {
  /**
   * 缓存值
   */
  value: T;
  /**
   * 创建时间戳
   */
  createdAt: number;
  /**
   * 过期时间戳
   */
  expiresAt: number | null;
  /**
   * 访问次数
   */
  accessCount: number;
  /**
   * 最后访问时间戳
   */
  lastAccessedAt: number;
}

/**
 * 缓存配置
 */
export interface CacheConfig {
  /**
   * 最大缓存数量
   */
  maxSize?: number;
  /**
   * 默认过期时间（毫秒）
   */
  defaultTTL?: number;
  /**
   * 清理间隔（毫秒）
   */
  cleanupInterval?: number;
  /**
   * 启用自动清理
   */
  enableAutoCleanup?: boolean;
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /**
   * 缓存项数量
   */
  size: number;
  /**
   * 命中次数
   */
  hits: number;
  /**
   * 未命中次数
   */
  misses: number;
  /**
   * 过期次数
   */
  expirations: number;
  /**
   * 清理次数
   */
  cleanups: number;
}

/**
 * 统一缓存接口
 * 所有缓存实现必须遵循此接口
 * 缓存键命名规范: 模块名:子模块:具体键名
 */
export interface ICache<K = string, V = unknown> {
  get(key: K): V | null;
  set(key: K, value: V, ttl?: number): void;
  delete(key: K): boolean;
  clear(): void;
  has(key: K): boolean;
  size(): number;
  getStats(): CacheStats;
}

// ───── 持久化缓存类型（源自 CacheSystem） ─────

/** 持久化缓存项 */
export interface PersistentCacheItem<T = unknown> {
  key: string;
  value: T;
  timestamp: number;
  expiry?: number;
  metadata?: Record<string, unknown>;
}

/** 缓存版本信息 */
export interface CacheVersion {
  version: string;
  timestamp: number;
  description: string;
}

/** 持久化缓存顶层结构 */
export interface PersistentCache {
  version: number;
  lastUpdated: number;
  data: Record<string, PersistentCacheItem>;
}

/** 持久化缓存存储后端接口 */
export interface PersistentCacheStorage {
  get<T = unknown>(key: string): Promise<PersistentCacheItem<T> | undefined>;
  set<T = unknown>(
    key: string,
    value: T,
    options?: {
      expiry?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  close(): Promise<void>;
}
