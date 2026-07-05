/**
 * 慢查询检测器单元测试
 * 覆盖 SlowQueryDetector 的阈值检测、报告生成和边界情况
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { SlowQueryDetector } from '../../src/query/SlowQueryDetector';
import { QueryLogStore, resetQueryLogStore } from '../../src/query/QueryLogStore';
import type { QueryLogEntry } from '../../src/query/QueryLogTypes';

/**
 * 创建测试日志条目
 */
function makeEntry(overrides: Partial<Omit<QueryLogEntry, 'id'>> = {}): Omit<QueryLogEntry, 'id'> {
  return {
    sessionId: 'test-session',
    type: 'api_call',
    model: 'gpt-4',
    promptTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    durationMs: 500,
    success: true,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SlowQueryDetector', () => {
  let store: QueryLogStore;
  let detector: SlowQueryDetector;

  beforeEach(async () => {
    resetQueryLogStore();
    store = new QueryLogStore(':memory:');
    await store.init();
    detector = new SlowQueryDetector(100, 3600_000, store);
  });

  afterEach(async () => {
    await store.close();
    resetQueryLogStore();
  });

  describe('阈值配置', () => {
    it('应该使用默认阈值', () => {
      const d = new SlowQueryDetector();
      expect(d.getThreshold()).toBe(5000);
    });

    it('应该支持自定义阈值', () => {
      const d = new SlowQueryDetector(3000);
      expect(d.getThreshold()).toBe(3000);
    });

    it('应该支持动态修改阈值', () => {
      detector.setThreshold(2000);
      expect(detector.getThreshold()).toBe(2000);
    });

    it('应该支持修改统计窗口', () => {
      detector.setStatsWindow(1800_000);
      expect(detector.getThreshold()).toBe(100);
    });
  });

  describe('慢查询检测', () => {
    it('无慢查询时应返回空数组', async () => {
      await store.log(makeEntry({ durationMs: 50 }));
      await store.log(makeEntry({ durationMs: 80 }));
      await store.log(makeEntry({ durationMs: 30 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(0);
    });

    it('应该检测超过阈值的慢查询', async () => {
      await store.log(makeEntry({ durationMs: 50 }));
      await store.log(makeEntry({ durationMs: 200 }));
      await store.log(makeEntry({ durationMs: 150 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(2);
      expect(slow[0].entry.durationMs).toBe(200);
      expect(slow[1].entry.durationMs).toBe(150);
    });

    it('应该按耗时降序排列', async () => {
      await store.log(makeEntry({ durationMs: 150 }));
      await store.log(makeEntry({ durationMs: 300 }));
      await store.log(makeEntry({ durationMs: 200 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(3);
      expect(slow[0].entry.durationMs).toBe(300);
      expect(slow[1].entry.durationMs).toBe(200);
      expect(slow[2].entry.durationMs).toBe(150);
    });

    it('应该正确计算阈值倍数', async () => {
      await store.log(makeEntry({ durationMs: 250 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(1);
      expect(slow[0].thresholdMultiplier).toBe(2.5);
    });

    it('应该忽略其他类型的日志', async () => {
      await store.log(makeEntry({ type: 'tool_call', durationMs: 5000, promptTokens: 0, outputTokens: 0, totalTokens: 0 }));
      await store.log(makeEntry({ type: 'query', durationMs: 5000, turnCount: 1, toolCallCount: 1 }));
      await store.log(makeEntry({ durationMs: 200 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(1);
    });
  });

  describe('报告生成', () => {
    it('无慢查询时报告应为空', async () => {
      await store.log(makeEntry({ durationMs: 50 }));

      const report = await detector.generateReport();
      expect(report.totalSlowQueries).toBe(0);
      expect(report.slowQueries.length).toBe(0);
      expect(report.maxDurationMs).toBe(0);
      expect(report.avgSlowDurationMs).toBe(0);
    });

    it('应包含整体统计信息', async () => {
      await store.log(makeEntry({ durationMs: 200 }));
      await store.log(makeEntry({ durationMs: 300 }));

      const report = await detector.generateReport();
      expect(report.totalSlowQueries).toBe(2);
      expect(report.stats.totalApiCalls).toBe(2);
      expect(report.thresholdMs).toBe(100);
    });

    it('应正确统计最慢和平均耗时', async () => {
      await store.log(makeEntry({ durationMs: 200 }));
      await store.log(makeEntry({ durationMs: 300 }));
      await store.log(makeEntry({ durationMs: 500 }));

      const report = await detector.generateReport();
      expect(report.maxDurationMs).toBe(500);
      expect(report.avgSlowDurationMs).toBe(333);
      expect(report.slowQueries.length).toBe(3);
    });

    it('应包含时间范围信息', async () => {
      const before = Date.now() - 1000;
      await store.log(makeEntry({ durationMs: 200, timestamp: before + 100 }));
      await store.log(makeEntry({ durationMs: 300, timestamp: before + 200 }));

      const report = await detector.generateReport();
      expect(report.startTime).toBeLessThan(report.endTime);
      expect(report.endTime).toBeGreaterThan(report.startTime);
    });
  });

  describe('边界情况', () => {
    it('空数据库应返回空报告', async () => {
      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(0);

      const report = await detector.generateReport();
      expect(report.totalSlowQueries).toBe(0);
      expect(report.stats.totalApiCalls).toBe(0);
    });

    it('阈值恰好等于耗时不应触发', async () => {
      detector.setThreshold(100);
      await store.log(makeEntry({ durationMs: 100 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(0);
    });

    it('刚好超过阈值应触发', async () => {
      detector.setThreshold(100);
      await store.log(makeEntry({ durationMs: 101 }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(1);
    });

    it('失败 API 也应计入慢查询', async () => {
      await store.log(makeEntry({
        durationMs: 200,
        success: false,
        error: 'timeout',
      }));

      const slow = await detector.checkSlowQueries();
      expect(slow.length).toBe(1);
      expect(slow[0].entry.success).toBe(false);
      expect(slow[0].entry.error).toBe('timeout');
    });

    it('printReport 不应抛出异常', async () => {
      await store.log(makeEntry({ durationMs: 50 }));
      await store.log(makeEntry({ durationMs: 200 }));

      await expect(detector.printReport()).resolves.toBeUndefined();
    });
  });
});
