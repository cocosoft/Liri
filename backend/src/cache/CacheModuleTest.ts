import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CacheStrategyManager,
  StrategyType,
} from './strategy/CacheStrategyManager';
import type { StrategyConfig } from './strategy/CacheStrategyManager';
import { CachePerformanceOptimizer } from './performance/CachePerformanceOptimizer';
import type { BatchOperation } from './performance/CachePerformanceOptimizer';
import { EnhancedCacheMonitor } from './monitor/EnhancedCacheMonitor';
import type { TrendPoint } from './monitor/EnhancedCacheMonitor';

describe('CacheStrategyManager', () => {
  let manager: CacheStrategyManager;

  beforeEach(() => {
    manager = new CacheStrategyManager({
      maxSize: 100,
      ttl: 5000,
      monitorInterval: 600000,
    });
  });

  it('stores and retrieves values', async () => {
    await manager.set('key1', 'value1');
    const val = await manager.get('key1');
    expect(val).toBe('value1');
  });

  it('returns undefined for missing keys', async () => {
    const val = await manager.get('nonexistent');
    expect(val).toBeUndefined();
  });

  it('respects TTL expiry', async () => {
    await manager.set('temp', 'data', 10);
    expect(await manager.get('temp')).toBe('data');
    await new Promise((r) => setTimeout(r, 20));
    expect(await manager.get('temp')).toBeUndefined();
  });

  it('deletes existing keys', async () => {
    await manager.set('del', 'value');
    expect(await manager.delete('del')).toBe(true);
    expect(await manager.get('del')).toBeUndefined();
  });

  it('returns false when deleting nonexistent key', async () => {
    expect(await manager.delete('nothing')).toBe(false);
  });

  it('clears all data', async () => {
    await manager.set('a', 1);
    await manager.set('b', 2);
    manager.clear();
    expect(await manager.get('a')).toBeUndefined();
    expect(await manager.get('b')).toBeUndefined();
    expect(manager.getSize()).toBe(0);
  });

  it('evicts old entries when at capacity', async () => {
    for (let i = 0; i < 120; i++) {
      await manager.set(`key${i}`, i);
    }
    expect(manager.getSize()).toBeLessThanOrEqual(100);
  });

  it('starts with specified strategy', () => {
    const lru = new CacheStrategyManager({
      type: StrategyType.LRU,
      maxSize: 50,
      ttl: 5000,
      monitorInterval: 600000,
    });
    expect(lru.getStrategy()).toBe(StrategyType.LRU);
  });

  it('provides effectiveness metrics', async () => {
    await manager.set('hit', 'value');
    await manager.get('hit');
    await manager.get('miss');
    const eff = manager.getEffectiveness();
    expect(eff.length).toBe(3);
    eff.forEach((e) => {
      expect(e.type).toBeDefined();
      expect(e.score).toBeGreaterThanOrEqual(0);
    });
  });

  it('tracks switch history', () => {
    const hist = manager.getSwitchHistory();
    expect(Array.isArray(hist)).toBe(true);
  });
});

describe('CachePerformanceOptimizer', () => {
  let optimizer: CachePerformanceOptimizer;

  beforeEach(() => {
    optimizer = new CachePerformanceOptimizer();
  });

  it('gets batch of keys', async () => {
    await optimizer.setBatch([
      { key: 'a', value: 1 },
      { key: 'b', value: 2 },
    ]);
    const results = await optimizer.getBatch(['a', 'b', 'c']);
    expect(results.get('a')).toBe(1);
    expect(results.get('b')).toBe(2);
    expect(results.has('c')).toBe(false);
  });

  it('sets batch of entries', async () => {
    const count = await optimizer.setBatch([
      { key: 'x', value: 10, ttl: 60000 },
      { key: 'y', value: 20 },
    ]);
    expect(count).toBe(2);
  });

  it('deletes batch of keys', async () => {
    await optimizer.setBatch([
      { key: 'd1', value: 1 },
      { key: 'd2', value: 2 },
    ]);
    const deleted = await optimizer.deleteBatch(['d1', 'd2', 'nonexistent']);
    expect(deleted).toBe(2);
  });

  it('executes mixed batch operations', async () => {
    const ops: BatchOperation[] = [
      { type: 'set', key: 'batch1', value: 'hello' },
      { type: 'set', key: 'batch2', value: 'world' },
      { type: 'get', key: 'batch1' },
      { type: 'delete', key: 'batch2' },
      { type: 'get', key: 'nonexistent' },
    ];
    const result = await optimizer.executeBatch(ops);
    expect(result.success).toBe(false);
    expect(result.results.length).toBe(5);
    const setResult = result.results.find(
      (r) => r.key === 'batch1' && r.value !== undefined
    );
    expect(setResult?.value).toBe('hello');
    const delResult = result.results.find(
      (r) => r.key === 'batch2' && r.success === true
    );
    expect(delResult?.success).toBe(true);
    const missResult = result.results.find((r) => r.key === 'nonexistent');
    expect(missResult?.success).toBe(false);
  });

  it('analyzes memory usage', () => {
    const report = optimizer.analyzeMemoryUsage();
    expect(report.totalItems).toBe(0);
    expect(report.totalSizeBytes).toBe(0);
    expect(report.recommendations).toBeDefined();
    expect(report.pools.length).toBe(1);
  });

  it('reports memory usage with data', async () => {
    await optimizer.setBatch([{ key: 'big', value: 'x'.repeat(1000) }]);
    const report = optimizer.analyzeMemoryUsage();
    expect(report.totalItems).toBe(1);
    expect(report.totalSizeBytes).toBeGreaterThan(900);
  });

  it('performs optimization', async () => {
    await optimizer.setBatch([{ key: 'stale', value: 'old', ttl: 1 }]);
    await new Promise((r) => setTimeout(r, 5));
    const result = await optimizer.optimize(true);
    expect(result.performed).toBe(true);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(Array.isArray(result.actions)).toBe(true);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('skips optimization when within cooldown', async () => {
    await optimizer.optimize(true);
    const result = await optimizer.optimize(false);
    expect(result.performed).toBe(false);
  });

  it('sets optimization targets', () => {
    optimizer.setTargets({ maxMemoryUsage: 50000, targetHitRate: 0.9 });
    const metrics = optimizer.getPerformanceMetrics();
    expect(metrics).toBeDefined();
  });

  it('tracks performance metrics', async () => {
    await optimizer.setBatch([{ key: 'm1', value: 'test' }]);
    await optimizer.getBatch(['m1', 'miss1']);
    const metrics = optimizer.getPerformanceMetrics();
    expect(metrics.totalOperations).toBeGreaterThan(0);
  });
});

describe('EnhancedCacheMonitor', () => {
  let monitor: EnhancedCacheMonitor;

  beforeEach(() => {
    monitor = new EnhancedCacheMonitor();
  });

  it('records trend samples', () => {
    monitor.recordSample({
      hitRate: 0.9,
      missRate: 0.1,
      avgLatency: 10,
      memoryUsage: 1000,
      itemCount: 50,
    });
    const report = monitor.generateReport(60000);
    expect(report.metrics.avgHitRate).toBe(0.9);
  });

  it('analyzes trends with sufficient data', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      monitor.recordSample({
        hitRate: 0.8 + i * 0.01,
        missRate: 0.2 - i * 0.01,
        avgLatency: 10 - i * 0.2,
        memoryUsage: 1000 + i * 10,
        itemCount: 50 + i,
      });
    }
    const trends = monitor.analyzeTrends(60000, 10);
    expect(trends.length).toBeGreaterThan(0);
  });

  it('returns empty anomalies with insufficient data', () => {
    const anomalies = monitor.detectAnomalies(60000);
    expect(anomalies.length).toBe(0);
  });

  it('detects hit rate drop anomaly', () => {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      monitor.recordSample({
        hitRate: 0.9,
        missRate: 0.1,
        avgLatency: 5,
        memoryUsage: 1000,
        itemCount: 50,
      });
    }
    monitor.recordSample({
      hitRate: 0.5,
      missRate: 0.5,
      avgLatency: 5,
      memoryUsage: 1000,
      itemCount: 50,
    });
    const anomalies = monitor.detectAnomalies(60000);
    const hitRateAnomaly = anomalies.find((a) => a.type === 'hit_rate_drop');
    expect(hitRateAnomaly).toBeDefined();
  });

  it('generates comprehensive report', () => {
    for (let i = 0; i < 10; i++) {
      monitor.recordSample({
        hitRate: 0.85,
        missRate: 0.15,
        avgLatency: 8,
        memoryUsage: 2000,
        itemCount: 100,
      });
    }
    const report = monitor.generateReport(60000);
    expect(report.generatedAt).toBeGreaterThan(0);
    expect(report.periodMs).toBe(60000);
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.healthScore).toBeLessThanOrEqual(100);
    expect(Array.isArray(report.recommendations)).toBe(true);
    expect(Array.isArray(report.trends)).toBe(true);
  });

  it('calculates health score', () => {
    for (let i = 0; i < 10; i++) {
      monitor.recordSample({
        hitRate: 0.95,
        missRate: 0.05,
        avgLatency: 2,
        memoryUsage: 500,
        itemCount: 30,
      });
    }
    const score = monitor.getHealthScore();
    expect(score).toBeGreaterThan(80);
  });

  it('clears all data', () => {
    monitor.recordSample({
      hitRate: 0.9,
      missRate: 0.1,
      avgLatency: 5,
      memoryUsage: 100,
      itemCount: 10,
    });
    monitor.clear();
    const report = monitor.generateReport(60000);
    expect(report.metrics.totalOperations).toBe(0);
  });
});

describe('Cache Integration', () => {
  it('integrates strategy manager with optimizer and monitor', async () => {
    const manager = new CacheStrategyManager({
      maxSize: 50,
      ttl: 60000,
      monitorInterval: 600000,
    });
    const optimizer = new CachePerformanceOptimizer();
    const monitor = new EnhancedCacheMonitor();

    await manager.set('shared1', 'alpha');
    await manager.set('shared2', 'beta');

    await optimizer.setBatch([
      { key: 'opt1', value: 'gamma' },
      { key: 'opt2', value: 'delta' },
    ]);

    const val1 = await manager.get('shared1');
    const val2 = await manager.get('shared2');
    expect(val1).toBe('alpha');
    expect(val2).toBe('beta');

    await manager.set('shared3', 'epsilon');
    const managerVal = await manager.get('shared3');
    expect(managerVal).toBe('epsilon');

    const memReport = optimizer.analyzeMemoryUsage();
    expect(memReport.totalItems).toBe(2);

    const managerEff = manager.getEffectiveness();
    expect(managerEff.length).toBe(3);

    const managerStrategy = manager.getStrategy();
    expect([
      StrategyType.LRU,
      StrategyType.LFU,
      StrategyType.FIFO,
      StrategyType.ADAPTIVE,
      StrategyType.HYBRID,
    ]).toContain(managerStrategy);

    monitor.recordSample({
      hitRate: 0.9,
      missRate: 0.1,
      avgLatency: 5,
      memoryUsage: memReport.totalSizeBytes,
      itemCount: memReport.totalItems,
    });
    const report = monitor.generateReport(60000);
    expect(report.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.anomalies).toBeDefined();
  });
});
