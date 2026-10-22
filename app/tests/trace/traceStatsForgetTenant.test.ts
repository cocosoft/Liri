/**
 * 多租户 P5：删租户时丢弃**trace 统计桶**
 *
 * 缺口：`StatsEngine` 的桶按 `ownerKey` 分（`getSnapshot(ownerKey)`），但它是**进程内累计**。
 * 删除租户后桶仍留着 ⇒ 同名新租户的 `/v1/trace/stats` 会带上"上一世"的调用数 / 错误数 /
 * token 消耗（读侧只按 ownerKey 过滤，不会漏给别人，但会漏给"同一个标识的下一世"）。
 *
 * 三个用例：① 纯分桶的按租户清除 + 幂等；② `TraceEngine` 接线；③ 插件未启动时
 * 模块级入口返回 0（不造假动作）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { StatsEngine } from '../../src/trace-recording/engine/StatsEngine.js';
import { TraceEngine } from '../../src/trace-recording/engine/TraceEngine.js';
import { forgetTraceStatsForTenant } from '../../src/trace-recording/index.js';
import type { TraceRecord } from '../../src/trace-recording/types.js';

const tempDirs: string[] = [];

function makeTraceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-trace-forget-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRecord(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    id: `rec_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    turn: 1,
    durationMs: 12,
    upstreamBaseUrl: 'https://api.openai.com',
    request: {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: {},
      body: { model: 'gpt-4o' },
    },
    response: {
      status: 200,
      headers: {},
      body: { usage: { prompt_tokens: 10, completion_tokens: 5 } },
    },
    ...overrides,
  };
}

describe('StatsEngine.forgetForTenant', () => {
  it('只清目标租户的桶（本地桶与其他租户不受影响，且幂等）', () => {
    const stats = new StatsEngine();
    stats.record(makeRecord({ ownerKey: 'trace-ten-a:alice' }));
    stats.record(makeRecord({ ownerKey: 'trace-ten-b:alice' }));
    stats.record(makeRecord()); // 本地 / 无归属 ⇒ '' 桶

    expect(stats.forgetForTenant('trace-ten-a')).toBe(1);
    expect(stats.getSnapshot('trace-ten-a:alice').totalCalls).toBe(0);
    expect(stats.getSnapshot('trace-ten-a:alice').totalInputTokens).toBe(0);

    expect(stats.getSnapshot('trace-ten-b:alice').totalCalls).toBe(1);
    expect(stats.getSnapshot().totalCalls).toBe(1);

    // 幂等：已摘过的前缀再摘为 0
    expect(stats.forgetForTenant('trace-ten-a')).toBe(0);
  });
});

describe('TraceEngine / 模块级入口', () => {
  it('引擎转发只清该租户的桶；插件未启动时模块级入口返回 0', async () => {
    const engine = new TraceEngine({
      traceDir: makeTraceDir(),
      liveViewPort: 0,
      mode: 'all',
      slowThresholdMs: 30000,
    });

    try {
      await engine.record(makeRecord({ ownerKey: 'trace-engine:alice' }));
      expect(engine.getStatsSnapshot('trace-engine:alice').totalCalls).toBe(1);

      expect(engine.forgetStatsForTenant('trace-engine')).toBe(1);
      expect(engine.getStatsSnapshot('trace-engine:alice').totalCalls).toBe(0);
      // 本地桶与落盘记录都不受影响（本方法只管进程内统计）
      expect(engine.getAllRecords().length).toBe(1);
    } finally {
      await engine.close();
    }

    // 本文件没有 createAITracePlugin ⇒ 没有全局插件，如实返回 0
    expect(forgetTraceStatsForTenant('trace-engine')).toBe(0);
  });
});
