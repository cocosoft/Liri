// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04，《运行态问题排查与修复方案》）：`trace:ai_call*` 日志分级。
 *
 * 实测窗口内该前缀 **1 185 条**，其中 `pending`（"发起过"占位，无 token/时长）与随后的
 * `completed` 是**同一次调用**的重复。现把 pending 降为 debug，完成/失败记录仍为 INFO
 * —— 本文件 pin 住"哪条走哪个级别"，防止有人把 pending 又提回 INFO。
 */
import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { Logger } from '@openliri/infra/monitoring/logs/Logger';
import { AITracePlugin } from '@openliri/infra/trace-recording/AITracePlugin';
import type { TraceRecord } from '@openliri/infra/trace-recording/types';

function makeRecord(phase: 'pending' | 'completed'): TraceRecord {
  return {
    id: 'r-p21',
    timestamp: new Date(0).toISOString(),
    turn: 1,
    durationMs: 12,
    upstreamBaseUrl: 'https://api.example.com',
    request: {
      method: 'POST',
      path: '/v1/messages',
      headers: {},
      body: { model: 'm1' },
    },
    response: {
      status: 200,
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

  it('completed ⇒ 仍为 INFO（可复盘的调用事实不降级）', async () => {
    infoSpy = spyOn(Logger.prototype, 'info');
    debugSpy = spyOn(Logger.prototype, 'debug');
    const plugin = new AITracePlugin();

    await runOnRecord(plugin, makeRecord('completed'));

    const infoCalls = infoSpy.mock.calls.filter(
      (c) => c[0] === 'trace:ai_call'
    );
    expect(infoCalls.length).toBe(1);
    expect(infoCalls[0][1]).toMatchObject({ model: 'm1', phase: 'completed' });
  });
});
