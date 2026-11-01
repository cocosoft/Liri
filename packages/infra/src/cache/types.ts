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
 * 缓存统计信息 / 统一缓存接口 —— **契约已迁至 `@modules/common`**
 *
 * 2026-11-01（B4 解环）：`ICache` / `CacheStats` 是**跨层共享契约**，此前定义在本文件里，
 * 使 `utils/cache.ts`（通用 TTL/LRU 实现）必须 `import type … from '@modules/cache/types'`
 * ⇒ `utils → cache` 出边，与 `cache → utils` 无关但把 utils 拖进 infra 的强连通分量。
 * 契约下沉到叶子模块 `common` 后，两侧都只依赖 `common`，本文件保留**同名转出**
 * （`@modules/cache` 与 `@modules/cache/types` 的导出面逐字不变）。
 */
export type { CacheStats, ICache } from '@openliri/infra/common';

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
