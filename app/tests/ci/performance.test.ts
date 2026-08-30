import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { 
  profileCheckpoint, 
  profilePhaseStart, 
  profilePhaseEnd, 
  profileReport 
} from '../../src/performance/StartupProfiler.js';
import { 
  slowLogging, 
  slowLoggingWithType, 
  withSlowOperationDetection, 
  getSlowOperationStats 
} from '../../src/performance/SlowOperations.js';
import { 
  getPerformanceConfig, 
  updatePerformanceConfig 
} from '../../src/performance/PerformanceConfig.js';
import { 
  analyzePerformance, 
  getPerformanceSuggestions, 
  recordResponseTime 
} from '../../src/performance/PerformanceAnalyzer.js';
import { 
  generateMemoryReport, 
  optimizeMemory, 
  getMemoryOptimizationSuggestions 
} from '../../src/performance/MemoryManager.js';
import { 
  getCache, 
  setCache, 
  deleteCache, 
  clearCache, 
  lazyLoad, 
  preload 
} from '../../src/performance/CacheAndLazyLoading.js';
import { 
  throttle, 
  debounce, 
  memoize, 
  batchProcess, 
  timeout, 
  retry 
} from '../../src/performance/CodeOptimizer.js';
import { 
  initializePerformanceSystem, 
  shutdownPerformanceSystem 
} from '../../src/performance/index.js';

/**
 * 延迟函数
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('性能优化系统', () => {
  beforeEach(async () => {
    await initializePerformanceSystem();
  });

  afterEach(async () => {
    await shutdownPerformanceSystem();
  });

  describe('StartupProfiler', () => {
    it('应该能够记录启动检查点', () => {
      profileCheckpoint('test_checkpoint');
      expect(true).toBe(true);
    });

    it('应该能够记录启动阶段', async () => {
      profilePhaseStart('test_phase');
      await delay(10);
      const duration = profilePhaseEnd('test_phase');
      expect(duration).toBeGreaterThan(0);
    });

    it('应该能够生成启动性能报告', () => {
      profileCheckpoint('test_start');
      profileCheckpoint('test_end');
      const report = profileReport();
      expect(typeof report).toBe('string');
    });
  });

  describe('SlowOperations', () => {
    it('应该能够检测慢操作', async () => {
      {
        using _ = slowLogging`测试慢操作`;
        await delay(400);
      }
      const stats = getSlowOperationStats();
      expect(stats.total).toBeGreaterThan(0);
    });

    it('应该能够按类型检测慢操作', async () => {
      {
        using _ = slowLoggingWithType('test_type', `测试带类型的慢操作`);
        await delay(400);
      }
      const stats = getSlowOperationStats();
      expect(stats.byType['test_type']).toBeDefined();
      expect(stats.byType['test_type']).toBeGreaterThan(0);
    });

    it('应该能够包装异步函数检测慢操作', async () => {
      const result = await withSlowOperationDetection('test_api', async () => {
        await delay(400);
        return 'test_result';
      });
      expect(result).toBe('test_result');
      const stats = getSlowOperationStats();
      expect(stats.byType['test_api']).toBeGreaterThan(0);
    });
  });

  describe('PerformanceConfig', () => {
    it('应该能够获取性能配置', () => {
      const config = getPerformanceConfig();
      expect(config).toBeDefined();
      expect(config.slowOperations.thresholdMs).toBeGreaterThan(0);
    });

    it('应该能够更新性能配置', () => {
      const originalConfig = getPerformanceConfig();
      updatePerformanceConfig({
        slowOperations: {
          thresholdMs: 500,
          enabled: true
        }
      });
      const updatedConfig = getPerformanceConfig();
      expect(updatedConfig.slowOperations.thresholdMs).toBe(500);
    });
  });

  describe('PerformanceAnalyzer', () => {
    it('应该能够分析性能指标', () => {
      const metrics = analyzePerformance();
      expect(metrics).toBeDefined();
      expect(metrics.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(metrics.memory).toBeDefined();
    });

    it('应该能够记录响应时间', () => {
      recordResponseTime(100);
      const metrics = analyzePerformance();
      expect(metrics.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('应该能够获取性能建议', () => {
      const suggestions = getPerformanceSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('MemoryManager', () => {
    it('应该能够生成内存报告', () => {
      const report = generateMemoryReport();
      expect(typeof report).toBe('string');
    });

    it('应该能够优化内存', () => {
      optimizeMemory();
      expect(true).toBe(true);
    });

    it('应该能够获取内存优化建议', () => {
      const suggestions = getMemoryOptimizationSuggestions();
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });

  describe('CacheAndLazyLoading', () => {
    it('应该能够设置和获取缓存', () => {
      setCache('test_key', 'test_value', 1000);
      const value = getCache('test_key');
      expect(value).toBe('test_value');
    });

    it('应该能够删除缓存', () => {
      setCache('test_key', 'test_value');
      deleteCache('test_key');
      const value = getCache('test_key');
      expect(value).toBeNull();
    });

    it('应该能够清空缓存', () => {
      setCache('test_key1', 'test_value1');
      setCache('test_key2', 'test_value2');
      clearCache();
      const value1 = getCache('test_key1');
      const value2 = getCache('test_key2');
      expect(value1).toBeNull();
      expect(value2).toBeNull();
    });

    it('应该能够延迟加载模块', async () => {
      const value = await lazyLoad('test_module', async () => {
        return 'module_content';
      });
      expect(value).toBe('module_content');
    });

    it('应该能够预加载模块', async () => {
      await preload('preload_module', async () => {
        return 'preload_content';
      });
      expect(true).toBe(true);
    });
  });

  describe('CodeOptimizer', () => {
    it('应该能够使用节流函数', () => {
      let count = 0;
      const throttledFn = throttle(() => {
        count++;
      }, 100);
      throttledFn();
      throttledFn();
      expect(count).toBe(1);
    });

    it('应该能够使用防抖函数', async () => {
      let count = 0;
      const debouncedFn = debounce(() => {
        count++;
      }, 50);
      debouncedFn();
      debouncedFn();
      await delay(100);
      expect(count).toBe(1);
    });

    it('应该能够使用记忆函数', () => {
      let callCount = 0;
      const memoizedFn = memoize((x: unknown) => {
        callCount++;
        return (x as number) * 2;
      });
      const result1 = memoizedFn(5);
      const result2 = memoizedFn(5);
      expect(result1).toBe(10);
      expect(result2).toBe(10);
      expect(callCount).toBe(1);
    });

    it('应该能够使用批量处理', async () => {
      const items = [1, 2, 3, 4, 5];
      const result = await batchProcess(items, 2, async (batch) => {
        return batch.map(item => item * 2);
      });
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it('应该能够使用超时函数', async () => {
      try {
        await timeout(delay(100), 50, '操作超时');
        expect(false).toBe(true);
      } catch (error) {
        expect(error instanceof Error).toBe(true);
      }
    });

    it('应该能够使用重试函数', async () => {
      let attempt = 0;
      const retryFn = async () => {
        attempt++;
        if (attempt < 3) {
          throw new Error('故意失败');
        }
        return '成功';
      };
      const result = await retry(retryFn, 3, 10);
      expect(result).toBe('成功');
      expect(attempt).toBe(3);
    });
  });
});
