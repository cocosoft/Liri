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
export * from './CacheSystem.js';
export * from './SpecializedCaches.js';
export * from './DataAggregator.js';
export * from './CacheMonitor.js';
export * from './CacheStrategy.js';
export * from './CacheFactory.js';
export * from './types.js';

export { CacheService } from './CacheService.js';

export {
  CacheStrategyManager,
  cacheStrategyManager,
  StrategyType,
} from './strategy/CacheStrategyManager.js';
export type {
  StrategyConfig,
  StrategyEffectiveness,
  StrategySwitchEvent,
  ICacheStrategyManager,
} from './strategy/CacheStrategyManager.js';

export {
  CachePerformanceOptimizer,
  cachePerformanceOptimizer,
} from './performance/CachePerformanceOptimizer.js';
export type {
  MemoryPool,
  BatchOperation,
  BatchResult,
  OptimizationTargets,
  OptimizationResult,
  MemoryUsageReport,
  PerformanceMetrics,
  ICachePerformanceOptimizer,
} from './performance/CachePerformanceOptimizer.js';

export {
  EnhancedCacheMonitor,
  enhancedCacheMonitor,
} from './monitor/EnhancedCacheMonitor.js';
export type {
  TrendPoint,
  TrendAnalysis,
  Anomaly,
  CacheReport,
  IEnhancedCacheMonitor,
} from './monitor/EnhancedCacheMonitor.js';

export type { ICache } from './types.js';
export { CacheFactory, CacheNames } from './CacheFactory.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'cache:index', level: LogLevel.INFO });

export async function initializeCacheSystem(): Promise<void> {
  try {
    const { initializeCacheSystem: initCore } =
      await import('./CacheSystem.js');
    await initCore();
    logger.info('缓存系统初始化完成');
  } catch (error) {
    await handleError(error, { module: 'cache', action: 'initialize' });
  }
}

export async function shutdownCacheSystem(): Promise<void> {
  try {
    const { shutdownCacheSystem: shutdownCore } =
      await import('./CacheSystem.js');
    await shutdownCore();
    logger.info('缓存系统已关闭');
  } catch (error) {
    logger.error('缓存系统关闭失败:', { error });
  }
}
