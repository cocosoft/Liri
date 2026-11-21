// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 入站监视 G2：消息链路持久化（`.trae/specs/inbound-message-monitoring-gaps.md` §5）
 *
 * 覆盖：
 * - 终态落盘 + **跨实例**可查（模拟重启）；
 * - 维度过滤（channel / status / from / to）与复合游标分页（同毫秒多条不重不漏）；
 * - 保留裁剪（按时间 7 天）；
 * - 缓冲 `finish()` → 单例存储的接线（真实 `messageTraceBuffer`）。
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
import {
  MessageTraceStore,
  TRACE_RETENTION_MS,
} from '@modules/channels/monitoring/MessageTraceStore';
import type { FinishedMessageTrace } from '@modules/channels/monitoring/messageTraceTypes';
import { messageTraceBuffer } from '@modules/channels/monitoring/MessageTraceBuffer';
import { getMessageTraceStore } from '@modules/channels/monitoring/MessageTraceStore';

const dbPath = join(
  tmpdir(),
  `liri-trace-store-${Date.now()}-${Math.floor(performance.now())}.db`
);
const store = new MessageTraceStore(dbPath);

afterAll(() => {
  store.close();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        // @ignore-catch — 测试清理：Windows 下可能仍被占用
      }
    }
  }
});

let seq = 0;
function makeTrace(
  overrides: Partial<FinishedMessageTrace> = {}
): FinishedMessageTrace {
  const startedAtMs = Date.now();
  seq += 1;
  return {
    traceId: `trc-test-${startedAtMs}-${seq}`,
    channelName: 'feishu',
    messageId: `msg-${seq}`,
    contentPreview: 'hello',
    startedAtMs,
    finishedAtMs: startedAtMs + 12,
    totalMs: 12,
    status: 'ok',
    stages: [
      { name: 'frame_check', status: 'ok', atMs: startedAtMs },
      { name: 'llm', status: 'ok', atMs: startedAtMs + 5, durationMs: 5 },
    ],
    ...overrides,
  };
}

describe('G2 消息链路持久化', () => {
  it('终态落盘，重启（新实例）后仍可查', async () => {
    const trace = makeTrace({
      channelName: 'qq',
      status: 'rejected',
      error: 'duplicate',
    });
    await store.upsert(trace);

    const re = new MessageTraceStore(dbPath);
    const page = await re.history({ channel: 'qq', limit: 10 });
    re.close();

    expect(page.total).toBe(1);
    expect(page.traces[0].traceId).toBe(trace.traceId);
    expect(page.traces[0].status).toBe('rejected');
    expect(page.traces[0].error).toBe('duplicate');
    expect(page.traces[0].stages.map((s) => s.name)).toEqual([
      'frame_check',
      'llm',
    ]);
  });

  it('按 channel / status / 时间窗过滤', async () => {
    const base = Date.now() - 60_000;
    await store.upsert(
      makeTrace({ channelName: 'filter-a', status: 'fail', startedAtMs: base })
    );
    await store.upsert(
      makeTrace({
        channelName: 'filter-a',
        status: 'ok',
        startedAtMs: base + 10_000,
      })
    );
    await store.upsert(
      makeTrace({ channelName: 'filter-b', status: 'ok', startedAtMs: base })
    );

    const allA = await store.history({ channel: 'filter-a', limit: 10 });
    expect(allA.total).toBe(2);

    const failed = await store.history({
      channel: 'filter-a',
      status: 'fail',
      limit: 10,
    });
    expect(failed.total).toBe(1);
    expect(failed.traces[0].status).toBe('fail');

    const inWindow = await store.history({
      fromMs: base + 5_000,
      toMs: base + 20_000,
      limit: 10,
    });
    expect(inWindow.total).toBe(1);
    expect(inWindow.traces[0].channelName).toBe('filter-a');
  });

  it('复合游标分页：同毫秒多条不重不漏', async () => {
    const startedAtMs = Date.now() - 120_000;
    const ids = ['cur-a', 'cur-b', 'cur-c', 'cur-d'];
    for (const id of ids) {
      await store.upsert(
        makeTrace({ traceId: id, channelName: 'cursor', startedAtMs })
      );
    }

    const page1 = await store.history({ channel: 'cursor', limit: 2 });
    expect(page1.traces).toHaveLength(2);
    expect(page1.total).toBe(4);
    expect(page1.nextCursor).toBe(
      `${page1.traces[1].startedAtMs}:${page1.traces[1].traceId}`
    );

    const page2 = await store.history({
      channel: 'cursor',
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.traces).toHaveLength(2);
    const seen = new Set([
      ...page1.traces.map((t) => t.traceId),
      ...page2.traces.map((t) => t.traceId),
    ]);
    expect(seen.size).toBe(4);
    expect(page2.nextCursor).toBeNull();
  });

  it('保留裁剪：超过 7 天的行被删除', async () => {
    const old = makeTrace({
      channelName: 'prune',
      startedAtMs: Date.now() - TRACE_RETENTION_MS - 60_000,
    });
    const fresh = makeTrace({ channelName: 'prune' });
    await store.upsert(old);
    await store.upsert(fresh);

    const removed = await store.prune();
    expect(removed).toBeGreaterThanOrEqual(1);

    const page = await store.history({ channel: 'prune', limit: 10 });
    expect(page.total).toBe(1);
    expect(page.traces[0].traceId).toBe(fresh.traceId);
  });

  it('缓冲 finish ⇒ 单例存储落盘（接线自证）', async () => {
    const channelName = `trace-wire-${Date.now()}`;
    const traceId = `${channelName}-1`;
    messageTraceBuffer.begin({
      traceId,
      channelName,
      messageId: 'msg-wire',
      senderId: 'u1',
      contentPreview: 'wired',
    });
    messageTraceBuffer.addStage(traceId, 'frame_check', 'ok');
    messageTraceBuffer.finish(traceId, 'rejected', 'duplicate');

    // 写盘是 best-effort 的异步过程 ⇒ 轮询到落定（最多 ~1s）
    let found = 0;
    for (let i = 0; i < 20; i += 1) {
      const page = await getMessageTraceStore().history({
        channel: channelName,
        limit: 10,
      });
      found = page.total;
      if (found > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(found).toBe(1);
  });
});
