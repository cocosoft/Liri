/**
 * TraceStore 单元测试
 *
 * 覆盖 v5 方案 3.5：
 * - IndexEntry 携带 phase
 * - pending 先入索引、completed 同 id 覆盖 → queryRecent 只留最终态
 */
import { describe, test, expect } from 'bun:test';
import { TraceStore } from '../TraceStore';
import type { TraceRecord } from '../../types';

function makeRecord(
  id: string,
  phase?: 'pending' | 'completed',
  timestamp = '2026-08-15T00:00:00.000Z'
): TraceRecord {
  return {
    id,
    timestamp,
    turn: 1,
    durationMs: phase === 'pending' ? 0 : 100,
    upstreamBaseUrl: 'https://api.example.com',
    phase,
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: { model: 'test-model' },
    },
    response: {
      status: phase === 'pending' ? 0 : 200,
      headers: {},
      body: null,
    },
  };
}

describe('TraceStore phase 索引（v5 方案 3.5）', () => {
  test('pending 记录索引带 phase=pending', () => {
    const store = new TraceStore();
    store.indexRecord(makeRecord('req_a', 'pending'));
    const recent = store.queryRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].phase).toBe('pending');
    expect(recent[0].durationMs).toBe(0);
  });

  test('pending → completed 同 id 覆盖，queryRecent 只留 completed', () => {
    const store = new TraceStore();
    store.indexRecord(makeRecord('req_a', 'pending'));
    store.indexRecord(makeRecord('req_a', 'completed'));
    const recent = store.queryRecent(10);
    expect(recent).toHaveLength(1);
    expect(recent[0].phase).toBe('completed');
    expect(recent[0].status).toBe(200);
    expect(recent[0].durationMs).toBe(100);
  });

  test('索引大小不随 pending+completed 翻倍（同 id 覆盖）', () => {
    const store = new TraceStore();
    for (let i = 0; i < 100; i++) {
      store.indexRecord(makeRecord(`req_${i}`, 'pending'));
      store.indexRecord(makeRecord(`req_${i}`, 'completed'));
    }
    expect(store.size).toBe(100);
  });

  test('queryByDate 按 timestamp 日期过滤且带 phase', () => {
    const store = new TraceStore();
    store.indexRecord(
      makeRecord('req_a', 'completed', '2026-08-15T00:00:00.000Z')
    );
    store.indexRecord(
      makeRecord('req_b', 'pending', '2026-08-16T00:00:00.000Z')
    );
    const day15 = store.queryByDate('2026-08-15');
    expect(day15).toHaveLength(1);
    expect(day15[0].id).toBe('req_a');
    expect(day15[0].phase).toBe('completed');
  });

  test('无 phase 旧记录索引 phase 为 undefined（回归兼容）', () => {
    const store = new TraceStore();
    store.indexRecord(makeRecord('req_old'));
    const recent = store.queryRecent(10);
    expect(recent[0].phase).toBeUndefined();
    expect(recent[0].status).toBe(200);
  });
});
