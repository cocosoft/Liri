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
