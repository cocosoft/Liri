// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：`trace:ai_call*` 日志分级。
 *
 * 实测窗口内该前缀 **60 009 条 / 19.0 MB**（`completed` 稳态），其 token/时长事实另有
 * 三处承载（traces 落盘、`LLM call recorded` 落库、`metric/timing`）。现分级为：
 *   - `pending`（发起占位，无 token/时长）⇒ debug；
 *   - `completed` 且**正常且非慢尾** ⇒ debug；
 *   - `completed` 且**异常**（error / status ≥ 400）或**慢尾**（≥ slowThresholdMs）⇒ INFO。
 * 本文件 pin 住"哪条走哪个级别"，防止稳态行被提回 INFO。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { Logger } from '@openliri/infra/monitoring/logs/Logger';
import { AITracePlugin } from '@openliri/infra/trace-recording/AITracePlugin';
import type { TraceRecord } from '@openliri/infra/trace-recording/types';

function makeRecord(
  phase: 'pending' | 'completed',
  over: { status?: number; durationMs?: number } = {}
): TraceRecord {
  return {
    id: 'r-p21',
    timestamp: new Date(0).toISOString(),
    turn: 1,
    durationMs: over.durationMs ?? 12,
    upstreamBaseUrl: 'https://api.example.com',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: { model: 'm1' },
    },
    response: {
      status: over.status ?? 200,
      headers: {},
      body: { usage: { input_tokens: 3, output_tokens: 5 } },
    },
    phase,
  } as TraceRecord;
}

/** `onRecord` 是私有方法：测试按其真实入口（拦截器回调）调用一次 */
async function runOnRecord(
  plugin: AITracePlugin,
  record: TraceRecord
): Promise<void> {
  const seam = plugin as unknown as {
    onRecord(r: TraceRecord): Promise<void>;
  };
  await seam.onRecord(record);
}

describe('P2-1：trace 日志分级', () => {
  let infoSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    infoSpy?.mockRestore();
    debugSpy?.mockRestore();
  });

  it('pending ⇒ debug（INFO 不再出现 trace:ai_call_pending）', async () => {
    infoSpy = spyOn(Logger.prototype, 'info');
    debugSpy = spyOn(Logger.prototype, 'debug');
    const plugin = new AITracePlugin();

    await runOnRecord(plugin, makeRecord('pending'));

    const infoCalls = infoSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call_pending'
    );
    const debugCalls = debugSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call_pending'
    );
    expect(infoCalls.length).toBe(0);
    expect(debugCalls.length).toBe(1);
  });

  it('completed 且正常且非慢尾 ⇒ debug（稳态行不再进 INFO）', async () => {
    infoSpy = spyOn(Logger.prototype, 'info');
    debugSpy = spyOn(Logger.prototype, 'debug');
    const plugin = new AITracePlugin();

    await runOnRecord(plugin, makeRecord('completed'));

    const infoCalls = infoSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call'
    );
    const debugCalls = debugSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call'
    );
    expect(infoCalls.length).toBe(0);
    expect(debugCalls.length).toBe(1);
    expect(debugCalls[0][1]).toMatchObject({ model: 'm1', phase: 'completed' });
  });

  it('completed 且异常（status ≥ 400）⇒ 仍为 INFO', async () => {
    infoSpy = spyOn(Logger.prototype, 'info');
    debugSpy = spyOn(Logger.prototype, 'debug');
    const plugin = new AITracePlugin();

    await runOnRecord(plugin, makeRecord('completed', { status: 500 }));

    const infoCalls = infoSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call'
    );
    expect(infoCalls.length).toBe(1);
    expect(infoCalls[0][1]).toMatchObject({ isError: true, status: 500 });
  });

  it('completed 且慢尾（≥ slowThresholdMs）⇒ 仍为 INFO', async () => {
    infoSpy = spyOn(Logger.prototype, 'info');
    debugSpy = spyOn(Logger.prototype, 'debug');
    const plugin = new AITracePlugin({ slowThresholdMs: 30_000 });

    await runOnRecord(plugin, makeRecord('completed', { durationMs: 30_000 }));

    const infoCalls = infoSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call'
    );
    expect(infoCalls.length).toBe(1);
    expect(infoCalls[0][1]).toMatchObject({ durationMs: 30_000 });
  });
});
