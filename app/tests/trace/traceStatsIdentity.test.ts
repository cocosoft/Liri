/**
 * 多租户 P3：Trace 统计与录制归属**按身份分桶**
 *
 * 背景：`GET /v1/trace/stats` 读 `TraceEngine` 的进程级内存统计 ⇒ 任一已登录身份
 * 都能看到全进程（含其他租户）的 token 消耗。现口径：
 * - 录制侧：`FetchInterceptor` 在录制时打 `ownerKey`（本地身份 ⇒ 不写字段，落盘与改造前一致）；
 * - 统计侧：`StatsEngine` 按 `ownerKey` 分桶（本地 / 无归属 ⇒ `''` 桶）；
 * - 读侧：`/v1/trace/stats` 只回**当前身份**的桶；`LiveViewServer` 走
 *   `getAggregateStatsSnapshot()`（宿主诊断，跨身份合计）。
 *
 * 三个用例分别锁住：纯分桶、引擎接线（record → 桶 → 读）、拦截器打标（ALS 能否到达录制点）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { StatsEngine } from '../../src/trace-recording/engine/StatsEngine.js';
import { TraceEngine } from '../../src/trace-recording/engine/TraceEngine.js';
import { FetchInterceptor } from '../../src/trace-recording/interceptor/FetchInterceptor.js';
import type { TraceRecord } from '../../src/trace-recording/types.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import type { Principal } from '@openliri/kernel/identity/principal.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const ALICE_KEY = 'acme:alice';

const tempDirs: string[] = [];

function makeTraceDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liri-trace-scope-'));
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

describe('StatsEngine：统计按身份分桶', () => {
  it('远端记录只进自己的桶，本地读数不含别人的 token', () => {
    const stats = new StatsEngine();

    stats.record(makeRecord({ ownerKey: ALICE_KEY }));
    stats.record(makeRecord({ ownerKey: ALICE_KEY }));
    stats.record(makeRecord()); // 本地 / 无归属

    const local = stats.getSnapshot();
    expect(local.totalCalls).toBe(1);
    expect(local.totalInputTokens).toBe(10);

    const alice = stats.getSnapshot(ALICE_KEY);
    expect(alice.totalCalls).toBe(2);
    expect(alice.totalOutputTokens).toBe(10);
    expect(alice.callsByModel['gpt-4o']).toBe(2);

    // 聚合读口是宿主诊断口径：三者合计
    expect(stats.getAggregateSnapshot().totalCalls).toBe(3);
    expect(stats.getAggregateSnapshot().totalInputTokens).toBe(30);
  });

  it('未知身份读不到任何桶（fail-closed，不回落聚合）', () => {
    const stats = new StatsEngine();
    stats.record(makeRecord({ ownerKey: ALICE_KEY }));

    const stranger = stats.getSnapshot('other:bob');
    expect(stranger.totalCalls).toBe(0);
    expect(stranger.callsByModel).toEqual({});
  });
});

describe('TraceEngine：录制到读数的接线', () => {
  it('record() 的归属决定 getStatsSnapshot() 读哪个桶', async () => {
    const engine = new TraceEngine({
      traceDir: makeTraceDir(),
      liveViewPort: 0,
      mode: 'all',
      slowThresholdMs: 30000,
    });

    try {
      await engine.record(makeRecord({ ownerKey: ALICE_KEY }));
      await engine.record(makeRecord());

      expect(engine.getStatsSnapshot(ALICE_KEY).totalCalls).toBe(1);
      expect(engine.getStatsSnapshot().totalCalls).toBe(1);
      // 视图读口是宿主口径（LiveViewServer 用它展示进程内全部流量）
      expect(engine.getAggregateStatsSnapshot().totalCalls).toBe(2);
    } finally {
      await engine.close();
    }
  });
});

describe('FetchInterceptor：录制点打归属', () => {
  it('远端身份作用域内录制的记录带 ownerKey；本地身份不写该字段', async () => {
    const originalFetch = globalThis.fetch;
    const engine = new TraceEngine({
      traceDir: makeTraceDir(),
      liveViewPort: 0,
      mode: 'all',
      slowThresholdMs: 30000,
    });
    const interceptor = new FetchInterceptor();
    const records: TraceRecord[] = [];

    // 用假 fetch 顶替真实网络：install() 绑定的是"安装时刻"的 globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: 'gpt-4o',
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )) as unknown as typeof fetch;

    try {
      interceptor.install(engine, (record) => {
        records.push(record);
      });

      await runWithPrincipal(ALICE, () =>
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4o' }),
        })
      );

      await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o' }),
      });

      expect(records.length).toBe(2);
      expect(records[0].ownerKey).toBe(ALICE_KEY);
      // 本地身份：字段整体缺省（落盘 JSON 与改造前逐字一致）
      expect('ownerKey' in records[1]).toBe(false);
    } finally {
      interceptor.uninstall();
      globalThis.fetch = originalFetch;
      await engine.close();
    }
  });
});
