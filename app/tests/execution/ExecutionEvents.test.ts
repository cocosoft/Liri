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
 * PR5-S3 — Execution 生命周期**会话事件**发射测试（2026-10-09）
 *
 * 覆盖 `.trae/specs/durable-execution.md` §3.6：
 * 状态迁移发射 `execution/status_changed`；未注入 sink ⇒ no-op。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import {
  ExecutionManager,
  setExecutionEventSink,
} from '../../src/execution/index.js';
import type { ExecutionId } from '../../src/execution/types.js';

const eid = (s: string): ExecutionId => s as ExecutionId;

interface Captured {
  sessionId: string;
  type: string;
  data: Record<string, unknown>;
}

function capture(): Captured[] {
  const events: Captured[] = [];
  setExecutionEventSink(async (sessionId, event) => {
    events.push({
      sessionId,
      type: event.type,
      data: event.data as Record<string, unknown>,
    });
    return { ok: true, tailSeq: events.length };
  });
  return events;
}

afterAll(() => {
  setExecutionEventSink(null);
});

describe('PR5-S3 execution 会话事件', () => {
  it('acquire → complete 发射 status_changed（null→RUNNING，RUNNING→COMPLETED）', () => {
    const events = capture();
    try {
      const m = new ExecutionManager();
      const lease = m.acquire('s1', 'm1');
      m.complete(lease.executionId);

      expect(events.length).toBe(2);
      expect(events[0].type).toBe('execution/status_changed');
      expect(events[0].sessionId).toBe('s1');
      expect(events[0].data.from).toBeNull();
      expect(events[0].data.to).toBe('RUNNING');
      expect(events[0].data.messageId).toBe('m1');
      expect(events[1].data.from).toBe('RUNNING');
      expect(events[1].data.to).toBe('COMPLETED');
    } finally {
      setExecutionEventSink(null);
    }
  });

  it('requestCancel → confirmCancel 发射 CANCEL_REQUESTED → CANCELLED', () => {
    const events = capture();
    try {
      const m = new ExecutionManager();
      const lease = m.acquire('s2');
      m.requestCancel(lease.executionId, 'INACTIVITY_TIMEOUT');
      m.confirmCancel(lease.executionId);

      const tos = events.map((e) => e.data.to);
      expect(tos).toEqual(['RUNNING', 'CANCEL_REQUESTED', 'CANCELLED']);
      expect(events[1].data.from).toBe('RUNNING');
      expect(events[2].data.from).toBe('CANCEL_REQUESTED');
    } finally {
      setExecutionEventSink(null);
    }
  });

  it('未注入 sink ⇒ no-op（不抛、不落）', () => {
    setExecutionEventSink(null);
    const m = new ExecutionManager();
    expect(() => {
      const lease = m.acquire('s3');
      m.complete(lease.executionId);
    }).not.toThrow();
  });

  it('recordToolCall 未接入 store ⇒ no-op', () => {
    const m = new ExecutionManager();
    expect(() => m.recordToolCall(eid('x'), 'c1', 'T')).not.toThrow();
  });
});
