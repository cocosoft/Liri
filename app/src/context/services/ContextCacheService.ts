/**
 * 上下文缓存服务（向后兼容 re-export）
 * 委托到 @modules/context/ContextCacheService 统一实现
 */

export {
  ContextCacheService,
  contextCacheService,
  memoize,
  type CacheConfig,
} from '../ContextCacheService.js';
