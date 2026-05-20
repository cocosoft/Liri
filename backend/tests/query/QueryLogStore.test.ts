/**
 * 查询日志存储单元测试
 * 覆盖 QueryLogStore 的 CRUD 操作、查询过滤和统计功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { QueryLogStore } from '../../src/query/QueryLogStore';
import type { QueryLogEntry, QueryLogFilter, QueryLogStats } from '../../src/query/QueryLogTypes';

const TEST_DB_DIR = join(import.meta.dir, '.test_data');
const TEST_DB_PATH = join(TEST_DB_DIR, 'test_query_logs.db');

/**
 * 创建一条测试日志条目（不含 id）
 */
function makeEntry(overrides: Partial<Omit<QueryLogEntry, 'id'>> = {}): Omit<QueryLogEntry, 'id'> {
  return {
    sessionId: 'test-session-1',
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

describe('QueryLogStore', () => {
  let store: QueryLogStore;

  beforeEach(async () => {
    if (!existsSync(TEST_DB_DIR)) {
      mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    store = new QueryLogStore(TEST_DB_PATH);
    await store.init();
  });

  afterEach(async () => {
    await store.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('初始化', () => {
    it('应该成功初始化数据库', async () => {
      const newStore = new QueryLogStore(TEST_DB_PATH);
      await newStore.init();
      expect(newStore).toBeDefined();
      await newStore.close();
    });

    it('重复初始化应该幂等', async () => {
      await store.init();
      await store.init();
      // 不抛出异常即通过
    });
  });

  describe('记录日志', () => {
    it('应该成功记录一条 API 调用日志', async () => {
      const id = await store.log(makeEntry());
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('应该成功记录一条工具调用日志', async () => {
      const id = await store.log(makeEntry({
        type: 'tool_call',
        toolName: 'read_file',
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }));
      expect(id).toBeDefined();
    });

    it('应该成功记录一条查询级别日志', async () => {
      const id = await store.log(makeEntry({
        type: 'query',
        turnCount: 3,
        toolCallCount: 5,
      }));
      expect(id).toBeDefined();
    });

    it('应该记录失败日志', async () => {
      const id = await store.log(makeEntry({
        success: false,
        error: 'API rate limit exceeded',
      }));
      expect(id).toBeDefined();
    });

    it('应该记录包含元数据的日志', async () => {
      const id = await store.log(makeEntry({
        metadata: { source: 'test', version: '1.0' },
      }));
      expect(id).toBeDefined();
    });

    it('应该为每条日志生成唯一 ID', async () => {
      const id1 = await store.log(makeEntry());
      const id2 = await store.log(makeEntry());
      expect(id1).not.toBe(id2);
    });
  });

  describe('查询日志', () => {
    beforeEach(async () => {
      // 插入多条测试数据
      const baseTime = Date.now() - 60000;
      await store.log(makeEntry({
        sessionId: 'session-a',
        type: 'api_call',
        model: 'gpt-4',
        promptTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        durationMs: 500,
        timestamp: baseTime,
      }));
      await store.log(makeEntry({
        sessionId: 'session-a',
        type: 'tool_call',
        toolName: 'read_file',
        model: undefined,
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 200,
        timestamp: baseTime + 1000,
      }));
      await store.log(makeEntry({
        sessionId: 'session-b',
        type: 'api_call',
        model: 'claude-3',
        promptTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        durationMs: 800,
        success: false,
        error: 'timeout',
        timestamp: baseTime + 2000,
      }));
      await store.log(makeEntry({
        sessionId: 'session-a',
        type: 'query',
        turnCount: 2,
        toolCallCount: 1,
        model: undefined,
        promptTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        durationMs: 1500,
        timestamp: baseTime + 3000,
      }));
    });

    it('应该查询所有日志（默认限制）', async () => {
      const entries = await store.query();
      expect(entries.length).toBeGreaterThanOrEqual(4);
    });

    it('应该按会话 ID 过滤', async () => {
      const entries = await store.query({ sessionId: 'session-a' });
      expect(entries.length).toBe(3);
      entries.forEach((e) => {
        expect(e.sessionId).toBe('session-a');
      });
    });

    it('应该按类型过滤', async () => {
      const entries = await store.query({ type: 'api_call' });
      expect(entries.length).toBe(2);
      entries.forEach((e) => {
        expect(e.type).toBe('api_call');
      });
    });

    it('应该按时间范围过滤', async () => {
      const baseTime = Date.now() - 60000;
      const entries = await store.query({
        startTime: baseTime + 1500,
        endTime: baseTime + 2500,
      });
      expect(entries.length).toBe(1);
      expect(entries[0].sessionId).toBe('session-b');
    });

    it('应该按成功/失败过滤', async () => {
      const entries = await store.query({ successOnly: true });
      entries.forEach((e) => {
        expect(e.success).toBe(true);
      });
    });

    it('应该按模型过滤', async () => {
      const entries = await store.query({ model: 'gpt-4' });
      expect(entries.length).toBe(1);
    });

    it('应该支持分页', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = await store.query({ limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      // 结果按时间戳降序排列，两页不应包含相同记录
      const page1Ids = new Set(page1.map((e) => e.id));
      const page2Ids = new Set(page2.map((e) => e.id));
      page2Ids.forEach((id) => {
        expect(page1Ids.has(id)).toBe(false);
      });
    });

    it('应该按会话获取', async () => {
      const entries = await store.getBySession('session-b');
      expect(entries.length).toBe(1);
      expect(entries[0].sessionId).toBe('session-b');
    });
  });

  describe('统计', () => {
    beforeEach(async () => {
      await store.log(makeEntry({
        sessionId: 'session-a',
        type: 'api_call',
        model: 'gpt-4',
        promptTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        durationMs: 500,
        timestamp: Date.now() - 30000,
      }));
      await store.log(makeEntry({
        sessionId: 'session-a',
        type: 'tool_call',
        toolName: 'search',
        promptTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        durationMs: 200,
        timestamp: Date.now() - 20000,
      }));
      await store.log(makeEntry({
        sessionId: 'session-b',
        type: 'api_call',
        model: 'gpt-4',
        promptTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        durationMs: 800,
        success: false,
        error: 'timeout',
        timestamp: Date.now() - 10000,
      }));
    });

    it('应该获取时间范围内的统计', async () => {
      const stats = await store.getStats(0, Date.now());
      expect(stats.totalApiCalls).toBe(2);
      expect(stats.totalToolCalls).toBe(1);
      expect(stats.totalQueries).toBe(0);
    });

    it('应该正确计算平均耗时', async () => {
      const stats = await store.getStats(0, Date.now());
      // (500 + 800) / 2 = 650
      expect(stats.avgApiDurationMs).toBe(650);
    });

    it('应该正确计算成功率', async () => {
      const stats = await store.getStats(0, Date.now());
      // 1 success out of 2 API calls = 0.5
      expect(stats.apiSuccessRate).toBe(0.5);
    });

    it('应该正确计算 Token 总数', async () => {
      const stats = await store.getStats(0, Date.now());
      expect(stats.totalTokens).toBe(450);
    });

    it('空数据库应返回零值统计', async () => {
      // 清空数据库并重新统计
      await store.prune(Date.now() + 86400000);
      const stats = await store.getStats(0, Date.now());
      expect(stats.totalApiCalls).toBe(0);
      expect(stats.totalToolCalls).toBe(0);
      expect(stats.totalQueries).toBe(0);
      expect(stats.avgApiDurationMs).toBe(0);
      expect(stats.apiSuccessRate).toBe(1);
      expect(stats.toolSuccessRate).toBe(1);
    });
  });

  describe('清理', () => {
    it('应该清理指定时间之前的日志', async () => {
      const past = Date.now() - 60000;
      await store.log(makeEntry({ timestamp: past }));
      await store.log(makeEntry({ timestamp: past }));
      await store.log(makeEntry({ timestamp: Date.now() }));

      const deleted = await store.prune(past + 1000);
      expect(deleted).toBe(2);

      const remaining = await store.query();
      expect(remaining.length).toBe(1);
    });

    it('没有可清理的日志时返回 0', async () => {
      await store.log(makeEntry({ timestamp: Date.now() }));
      const deleted = await store.prune(Date.now() - 86400000);
      expect(deleted).toBe(0);
    });
  });
});
