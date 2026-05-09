export * from './CacheSystem.js';
export * from './SpecializedCaches.js';
export * from './DataAggregator.js';
export * from './CacheMonitor.js';
export * from './CacheStrategy.js';
export * from './CacheFactory.js';
export * from './strategy/index.js';
export * from './performance/index.js';
export * from './monitor/index.js';

export { CacheService } from './services/CacheService.js';

export {
  CacheStrategyManager,
  cacheStrategyManager,
  StrategyType,
} from './strategy/index.js';
export type {
  StrategyConfig,
  StrategyEffectiveness,
  StrategySwitchEvent,
  ICacheStrategyManager,
} from './strategy/index.js';

export {
  CachePerformanceOptimizer,
  cachePerformanceOptimizer,
} from './performance/index.js';
export type {
  MemoryPool,
  BatchOperation,
  BatchResult,
  OptimizationTargets,
  OptimizationResult,
  MemoryUsageReport,
  PerformanceMetrics,
  ICachePerformanceOptimizer,
} from './performance/index.js';

export { EnhancedCacheMonitor, enhancedCacheMonitor } from './monitor/index.js';
export type {
  TrendPoint,
  TrendAnalysis,
  Anomaly,
  CacheReport,
  IEnhancedCacheMonitor,
} from './monitor/index.js';

export type { ICache } from './models/types.js';
export { CacheFactory, CacheNames } from './CacheFactory.js';

export async function initializeCacheSystem(): Promise<void> {
  try {
    const { initializeCacheSystem: initCore } =
      await import('./CacheSystem.js');
    await initCore();
    console.log('缓存系统初始化完成');
  } catch (error) {
    console.error('缓存系统初始化失败:', error);
  }
}

export async function shutdownCacheSystem(): Promise<void> {
  try {
    const { shutdownCacheSystem: shutdownCore } =
      await import('./CacheSystem.js');
    await shutdownCore();
    console.log('缓存系统已关闭');
  } catch (error) {
    console.error('缓存系统关闭失败:', error);
  }
}
