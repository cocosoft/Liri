/**
 * StatsEngine 单元测试
 *
 * 覆盖 v5 方案 3.4：
 * - pending 记录不计入 totalCalls / 延迟分位数 / token
 * - completed 记录正常统计
 */
import { describe, test, expect } from 'bun:test';
import { StatsEngine } from '../StatsEngine';
import type { TraceRecord } from '../../types';

function makeRecord(
  id: string,
  phase?: 'pending' | 'completed',
  durationMs = 100,
  status = 200
): TraceRecord {
  return {
    id,
    timestamp: '2026-08-15T00:00:00.000Z',
    turn: 1,
    durationMs,
    upstreamBaseUrl: 'https://api.example.com',
    phase,
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: { model: 'test-model' },
    },
    response: {
      status,
      headers: {},
      body: {
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    },
  };
}

describe('StatsEngine 跳过 pending（v5 方案 3.4）', () => {
  test('仅 pending → totalCalls 为 0', () => {
    const stats = new StatsEngine();
    stats.record(makeRecord('req_a', 'pending'));
    const snap = stats.getSnapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.latencyP50).toBe(0);
    expect(snap.totalInputTokens).toBe(0);
  });

  test('pending + completed → 只计 completed 一次', () => {
    const stats = new StatsEngine();
    stats.record(makeRecord('req_a', 'pending'));
    stats.record(makeRecord('req_a', 'completed'));
    const snap = stats.getSnapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.callsByModel['test-model']).toBe(1);
    expect(snap.totalInputTokens).toBe(10);
    expect(snap.totalOutputTokens).toBe(20);
  });

  test('pending 的 durationMs=0 不污染延迟分位数', () => {
    const stats = new StatsEngine();
    // pending durationMs=0（真实场景），completed durationMs=100
    stats.record(makeRecord('req_a', 'pending', 0));
    stats.record(makeRecord('req_b', 'completed', 100));
    const snap = stats.getSnapshot();
    expect(snap.totalCalls).toBe(1);
    // 若 pending 被误计入，durations=[0,100]，P50=0；正确应为 durations=[100]，P50=100
    expect(snap.latencyP50).toBe(100);
    expect(snap.latencyP99).toBe(100);
  });

  test('无 phase 的旧记录按 completed 统计（回归）', () => {
    const stats = new StatsEngine();
    stats.record(makeRecord('req_old'));
    const snap = stats.getSnapshot();
    expect(snap.totalCalls).toBe(1);
  });

  test('pending 错误记录不计入错误数', () => {
    const stats = new StatsEngine();
    stats.record({ ...makeRecord('req_err', 'pending'), error: 'boom' });
    const snap = stats.getSnapshot();
    expect(snap.totalErrors).toBe(0);
  });
});
