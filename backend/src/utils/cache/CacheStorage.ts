//
/**
 * 缓存存储实现（向后兼容 re-export）
 * 所有功能已合并到 ../cache.ts
 *
 * CacheStorage 原为基于 CC 源码的独立缓存实现，
 * 已按双轨制消除模式合并到主缓存模块。
 */

export {
  MemoryCache,
  LRUCache,
  TTLCache,
  CacheManager,
  getGlobalCacheManager,
  resetGlobalCacheManager,
} from '../cache.js';
