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
 * 入站监视 G4：链路增量订阅 + `/v1/channels/inbound/stream`
 * （`.trae/specs/inbound-message-monitoring-gaps.md` §7）
 *
 * 覆盖：
 * - `begin` / `stage` / `finish` 三态事件顺序与内容；
 * - **正文不外发**（事件里 `contentPreview` 恒为空串）；
 * - 取消订阅即停止投递；单个订阅者异常被摘除、不影响其他订阅者；
 * - SSE 处理器：连接即推 snapshot、增量推 trace、断开后退订不再写入。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'node:http';
import { messageTraceBuffer } from '@modules/channels/monitoring/MessageTraceBuffer';
import type { MessageTraceEvent } from '@modules/channels/monitoring/messageTraceTypes';
import { handleChannelInboundStream } from '../../src/infrastructure/http/handlers/channel-handlers';

let seq = 0;
function uniqueChannel(): string {
  seq += 1;
  return `sse-test-${Date.now()}-${seq}`;
}

describe('G4 链路增量订阅', () => {
  it('按 begin → stage → finish 顺序推送，且不含消息正文', () => {
    const channel = uniqueChannel();
    const traceId = `${channel}-t1`;
    const events: MessageTraceEvent[] = [];
    const off = messageTraceBuffer.subscribe((event) => events.push(event));

    try {
      messageTraceBuffer.begin({
        traceId,
        channelName: channel,
        messageId: 'm1',
        senderId: 'u1',
        contentPreview: 'SECRET-CONTENT',
      });
      messageTraceBuffer.addStage(traceId, 'frame_check', 'ok');
      messageTraceBuffer.addStage(traceId, 'dedup', 'skip', 'duplicate');
      messageTraceBuffer.finish(traceId, 'rejected', 'duplicate');
    } finally {
      off();
    }

    expect(events.map((e) => e.kind)).toEqual([
      'begin',
      'stage',
      'stage',
      'finish',
    ]);
    for (const event of events) {
      expect(event.trace.traceId).toBe(traceId);
      expect(event.trace.contentPreview).toBe('');
    }
    expect(events[3].trace.status).toBe('rejected');
    expect(events[3].trace.totalMs).toBeGreaterThanOrEqual(0);
    expect(events[3].trace.stages).toHaveLength(2);
  });

  it('取消订阅后不再投递', () => {
    const channel = uniqueChannel();
    const traceId = `${channel}-t2`;
    const events: MessageTraceEvent[] = [];
    const off = messageTraceBuffer.subscribe((event) => events.push(event));

    messageTraceBuffer.begin({
      traceId,
      channelName: channel,
      messageId: 'm2',
    });
    off();
    messageTraceBuffer.finish(traceId, 'ok');

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('begin');
  });

  it('单个订阅者抛异常 ⇒ 摘除它，其余订阅者照常收到', () => {
    const channel = uniqueChannel();
    const traceId = `${channel}-t3`;
    let badCalls = 0;
    let goodCalls = 0;
    const offBad = messageTraceBuffer.subscribe(() => {
      badCalls += 1;
      throw new Error('boom');
    });
    const offGood = messageTraceBuffer.subscribe(() => {
      goodCalls += 1;
    });

    try {
      messageTraceBuffer.begin({
        traceId,
        channelName: channel,
        messageId: 'm3',
      });
      messageTraceBuffer.addStage(traceId, 'frame_check', 'ok');
    } finally {
      offBad();
      offGood();
    }

    // 首个事件时坏订阅者抛错并被摘除 ⇒ 第二次只投递给好订阅者
    expect(badCalls).toBe(1);
    expect(goodCalls).toBe(2);
  });
});

describe('G4 /v1/channels/inbound/stream SSE', () => {
  it('连接推 snapshot；增量推 trace；断开后退订', async () => {
    const writes: string[] = [];
    const closeHandlers: Array<() => void> = [];
    const res = {
      writeHead: () => res,
      flushHeaders: () => undefined,
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
    };
    const req = {
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeHandlers.push(cb);
      },
    };

    await handleChannelInboundStream(
      req as unknown as http.IncomingMessage,
      res as unknown as http.ServerResponse
    );

    const frames = () => writes.join('');
    expect(frames()).toContain('event: snapshot');
    expect(frames()).not.toContain('event: trace');

    const channel = uniqueChannel();
    const traceId = `${channel}-sse`;
    messageTraceBuffer.begin({
      traceId,
      channelName: channel,
      messageId: 'm-sse',
      contentPreview: 'SECRET-CONTENT',
    });
    messageTraceBuffer.finish(traceId, 'ok');

    const payload = frames();
    expect(payload).toContain('"kind":"begin"');
    expect(payload).toContain('"kind":"finish"');
    expect(payload).toContain(traceId);
    // 隐私边界：正文不外发
    expect(payload).not.toContain('SECRET-CONTENT');

    // 断开 ⇒ 退订：后续事件不再写入
    closeHandlers[0]?.();
    const before = writes.length;
    messageTraceBuffer.begin({
      traceId: `${channel}-after-close`,
      channelName: channel,
      messageId: 'm-after',
    });
    expect(writes.length).toBe(before);
  });
});
