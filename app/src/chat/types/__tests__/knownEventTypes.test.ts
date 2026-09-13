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
 * D2（2026-08-24）：格式版本化 + ignorable —— knownEventTypes 单测
 *
 * 覆盖：
 *  - 注册表完备性：KNOWN_SESSION_EVENT_TYPES 覆盖 LiriEventType 全成员
 *  - assertEventReadable：已知/未知/未知+ignorable/版本超前/版本缺省
 *  - assertEventWritable：未知非 ignorable 拒绝
 */
import { describe, it, expect } from 'bun:test';
import type { LiriEventType } from '../events';
import {
  KNOWN_SESSION_EVENT_TYPES,
  LIRI_EVENT_FORMAT_VERSION,
  assertEventReadable,
  assertEventWritable,
  eventFormatVersionRefusal,
} from '../knownEventTypes';

/** 事件 type 联合全成员（用于注册表完备性断言） */
const ALL_EVENT_TYPES: LiriEventType[] = [
  'turn/start',
  'turn/end',
  'user/message',
  'assistant/thinking',
  'assistant/text',
  'assistant/tool_call',
  'tool/result',
  'tool/canceled',
  'assistant/status',
  'assistant/progress',
  'assistant/question',
  'assistant/todo',
  'assistant/doc_workflow',
  'assistant/truncation',
  'assistant/deliverable',
  'assistant/diff',
  'context/compaction',
  'context/summary',
  'system/error',
  'system/warning',
  'system/info',
  'metric/timing',
  'channel/connect',
  'channel/disconnect',
  'channel/message',
  'session/start',
  'session/end',
  'session/title',
];

describe('KNOWN_SESSION_EVENT_TYPES 完备性', () => {
  it('注册表覆盖 LiriEventType 全成员', () => {
    for (const type of ALL_EVENT_TYPES) {
      expect(KNOWN_SESSION_EVENT_TYPES.has(type), type).toBe(true);
    }
  });
});

describe('eventFormatVersionRefusal', () => {
  it('缺省版本（存量）→ 可读', () => {
    expect(eventFormatVersionRefusal(undefined)).toBeNull();
  });
  it('当前版本 → 可读', () => {
    expect(eventFormatVersionRefusal(LIRI_EVENT_FORMAT_VERSION)).toBeNull();
  });
  it('超前版本 → 拒绝（提示升级）', () => {
    const refusal = eventFormatVersionRefusal(LIRI_EVENT_FORMAT_VERSION + 1);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('升级');
  });
});

describe('assertEventReadable', () => {
  it('已知类型 → 可读', () => {
    expect(assertEventReadable({ type: 'user/message' })).toEqual({ ok: true });
  });
  it('未知类型非 ignorable → 拒绝', () => {
    const result = assertEventReadable({ type: 'future/event' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('future/event');
  });
  it('未知类型 + ignorable → 可读（合法向前兼容通道）', () => {
    expect(
      assertEventReadable({ type: 'future/event', ignorable: true })
    ).toEqual({
      ok: true,
    });
  });
  it('版本超前 → 拒绝', () => {
    const result = assertEventReadable({
      type: 'user/message',
      schemaVersion: LIRI_EVENT_FORMAT_VERSION + 1,
    });
    expect(result.ok).toBe(false);
  });
  it('已知类型 + 版本缺省 → 可读', () => {
    expect(assertEventReadable({ type: 'tool/canceled' })).toEqual({
      ok: true,
    });
  });
});

describe('assertEventWritable', () => {
  it('已知类型 → 可写', () => {
    expect(assertEventWritable({ type: 'assistant/text' })).toEqual({
      ok: true,
    });
  });
  it('未知类型非 ignorable → 拒绝', () => {
    const result = assertEventWritable({ type: 'ghost/event' });
    expect(result.ok).toBe(false);
  });
  it('未知类型 + ignorable → 可写', () => {
    expect(
      assertEventWritable({ type: 'ghost/event', ignorable: true })
    ).toEqual({
      ok: true,
    });
  });
});
