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
 * D7（2026-08-24）：事件投影统计 deriveSessionStats 单测
 *
 * 覆盖：消息数（去重）/工具终态分类（result/canceled/orphan）/轮次/压缩次数
 */
import { describe, it, expect } from 'bun:test';
import type { LiriEvent } from '../../../chat/types/events';
import { deriveSessionStats } from '../EventMessageDeriver';

/** 构造测试事件 */
function makeEvent<T extends LiriEvent['type']>(
  type: T,
  seq: number,
  data: LiriEvent[T]['data'],
  sessionId = 's1'
): LiriEvent<T> {
  return {
    type,
    seq,
    time: 1000 + seq,
    sessionId,
    data,
  } as LiriEvent<T>;
}

describe('事件投影统计（D7）', () => {
  it('消息数按 messageId 去重', () => {
    const events = [
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
      makeEvent('assistant/thinking', 2, { content: '想', messageId: 'a1' }),
      makeEvent('assistant/text', 3, { content: '你好', messageId: 'a1' }),
      makeEvent('assistant/text', 4, { content: '，世界', messageId: 'a1' }),
      makeEvent('assistant/tool_call', 5, {
        toolCallId: 'tc1',
        name: 'file_read',
        args: {},
        messageId: 'a2',
      }),
    ];
    const s = deriveSessionStats(events);
    expect(s.userMessageCount).toBe(1);
    expect(s.assistantMessageCount).toBe(2); // a1 + a2
    expect(s.messageCount).toBe(3);
    expect(s.eventCount).toBe(5);
  });

  it('工具终态分类：result/canceled/orphan', () => {
    const events = [
      makeEvent('assistant/tool_call', 1, {
        toolCallId: 'tc1',
        name: 'a',
        args: {},
        messageId: 'a1',
      }),
      makeEvent('tool/result', 2, {
        toolCallId: 'tc1',
        callSeq: 1,
        result: 'ok',
        messageId: 'a1',
      }),
      makeEvent('assistant/tool_call', 3, {
        toolCallId: 'tc2',
        name: 'b',
        args: {},
        messageId: 'a2',
      }),
      makeEvent('tool/canceled', 4, {
        toolCallId: 'tc2',
        callSeq: 3,
        reason: 'stop',
        messageId: 'a2',
      }),
      makeEvent('assistant/tool_call', 5, {
        toolCallId: 'tc3',
        name: 'c',
        args: {},
        messageId: 'a3',
      }),
    ];
    const s = deriveSessionStats(events);
    expect(s.toolCallCount).toBe(3);
    expect(s.toolResultCount).toBe(1);
    expect(s.toolCanceledCount).toBe(1);
    expect(s.toolOrphanCount).toBe(1); // tc3 无终态
  });

  it('轮次与压缩统计', () => {
    const events = [
      makeEvent('turn/start', 1, { turn: 1 }),
      makeEvent('turn/end', 2, { turn: 1 }),
      makeEvent('context/compaction', 3, {
        phase: 'start',
        message: '开始压缩',
      }),
      makeEvent('context/compaction', 4, {
        phase: 'done',
        compactedRange: { startSeq: 1, endSeq: 2 },
        summary: '摘要',
        sourceEventSeqs: [1, 2],
      }),
    ];
    const s = deriveSessionStats(events);
    expect(s.turnCount).toBe(1);
    expect(s.compactionCount).toBe(1);
    expect(s.compactedSourceEventCount).toBe(2);
  });
});
