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
 * D8（2026-08-24）：工具结果语义合成 —— 孤儿 tool_call 检测 + 中断文案
 *
 * 覆盖：
 *  - 孤儿 tool_call（已发起无终态）→ 派生块 status=interrupted + error 语义文案
 *  - 已终态（tool/result）→ 不标记
 *  - 已取消（tool/canceled）→ 不标记（B 方案 canceled 已表达）
 *  - 纯投影消息（无事件 tool_call）→ 不误标
 */
import { describe, it, expect } from 'bun:test';
import type { LiriEvent } from '../../../chat/types/events';
import { deriveMessagesFromEvents } from '../EventMessageDeriver';

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

/** 提取消息中的 tool_call 块 */
function findToolBlocks(msg: { blocks?: Array<Record<string, unknown>> }) {
  return (msg.blocks ?? []).filter((b) => b.type === 'tool_call');
}

describe('孤儿 tool_call 语义合成（D8）', () => {
  it('孤儿 tool_call（无终态）→ status=interrupted + 语义文案', () => {
    const events = [
      makeEvent('user/message', 1, { content: '帮我查文件', messageId: 'u1' }),
      makeEvent('assistant/thinking', 2, { content: '思考', messageId: 'a1' }),
      makeEvent('assistant/text', 3, { content: '好的', messageId: 'a1' }),
      makeEvent('assistant/tool_call', 4, {
        toolCallId: 'tc1',
        name: 'file_read',
        args: { path: '/tmp/a.txt' },
        messageId: 'a1',
      }),
    ];
    const result = deriveMessagesFromEvents(events, []);
    const assistant = result.find((m) => m.id === 'a1');
    expect(assistant).toBeDefined();
    const toolBlocks = findToolBlocks(assistant!);
    expect(toolBlocks.length).toBe(1);
    expect(toolBlocks[0].toolCallId).toBe('tc1');
    expect(toolBlocks[0].status).toBe('interrupted');
    expect(typeof toolBlocks[0].error).toBe('string');
    expect((toolBlocks[0].error as string).length).toBeGreaterThan(10);
  });

  it('已终态 tool_call（有 tool/result）→ 不标记', () => {
    const events = [
      makeEvent('user/message', 1, { content: '帮我查文件', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: '好的', messageId: 'a1' }),
      makeEvent('assistant/tool_call', 3, {
        toolCallId: 'tc1',
        name: 'file_read',
        args: { path: '/tmp/a.txt' },
        messageId: 'a1',
      }),
      makeEvent('tool/result', 4, {
        toolCallId: 'tc1',
        callSeq: 3,
        result: '文件内容',
        messageId: 'a1',
      }),
    ];
    const result = deriveMessagesFromEvents(events, []);
    const assistant = result.find((m) => m.id === 'a1');
    const toolBlocks = findToolBlocks(assistant!);
    expect(toolBlocks.length).toBe(1);
    expect(toolBlocks[0].status).toBeUndefined();
    expect(toolBlocks[0].error).toBeUndefined();
  });

  it('已取消 tool_call（有 tool/canceled）→ 不标记（canceled 已表达）', () => {
    const events = [
      makeEvent('user/message', 1, { content: '帮我查文件', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: '好的', messageId: 'a1' }),
      makeEvent('assistant/tool_call', 3, {
        toolCallId: 'tc1',
        name: 'file_read',
        args: { path: '/tmp/a.txt' },
        messageId: 'a1',
      }),
      makeEvent('tool/canceled', 4, {
        toolCallId: 'tc1',
        callSeq: 3,
        reason: '用户停止',
        messageId: 'a1',
      }),
    ];
    const result = deriveMessagesFromEvents(events, []);
    const assistant = result.find((m) => m.id === 'a1');
    const toolBlocks = findToolBlocks(assistant!);
    expect(toolBlocks.length).toBe(1);
    expect(toolBlocks[0].status).toBeUndefined();
    expect(toolBlocks[0].error).toBeUndefined();
  });

  it('纯投影消息（无事件 tool_call）→ 不误标', () => {
    const events = [
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
      makeEvent('assistant/text', 2, { content: 'hello', messageId: 'a1' }),
    ];
    const projections = [
      {
        id: 'p1',
        role: 'assistant',
        content: '来自投影',
        timestamp: 2000,
        blocks: [
          {
            id: 'blk_p1',
            type: 'tool_call',
            toolCallId: 'tc-p1',
            content: '',
          },
        ],
        lastEventSeq: 99,
      },
    ];
    const result = deriveMessagesFromEvents(events, projections);
    // p1 无事件聚合 → 走 ③ 纯投影兜底分支（直接取投影，不标记）
    // 设计：投影层存量数据终态未知，不标记中断（避免误标已有结果但事件未聚合的块）
    const projected = result.find((m) => m.id === 'p1');
    expect(projected).toBeDefined();
    const toolBlocks = findToolBlocks(projected!);
    expect(toolBlocks.length).toBe(1);
    expect(toolBlocks[0].status).toBeUndefined();
    expect(toolBlocks[0].error).toBeUndefined();
  });

  it('事件派生 tool_call 块含完整 toolCall 对象（D-REPAIR：工具名可显示）', () => {
    const events = [
      makeEvent('user/message', 1, { content: 'hi', messageId: 'u1' }),
      makeEvent('assistant/tool_call', 2, {
        toolCallId: 'tc1',
        name: 'bash',
        args: { command: 'ls' },
        messageId: 'a1',
      }),
      makeEvent('tool/result', 3, {
        toolCallId: 'tc1',
        callSeq: 2,
        result: 'ok',
        messageId: 'a1',
      }),
    ];
    const result = deriveMessagesFromEvents(events, []);
    const assistant = result.find((m) => m.id === 'a1');
    const toolBlocks = findToolBlocks(assistant!);
    expect(toolBlocks.length).toBe(1);
    // 块必须带完整 toolCall（name/arguments）——前端 ToolInlineTags/ToolCallGroup
    // 依赖 block.toolCall.name 显示工具名，缺失会退化为仅显示 "✓ ▼"
    const tc = toolBlocks[0].toolCall as
      | { id?: string; name?: string; arguments?: Record<string, unknown> }
      | undefined;
    expect(tc).toBeDefined();
    expect(tc!.name).toBe('bash');
    expect(tc!.id).toBe('tc1');
    expect(tc!.arguments).toEqual({ command: 'ls' });
    // 兼容扁平字段保留（toolName/args，旧前端/其他消费方）
    expect(toolBlocks[0].toolName).toBe('bash');
    expect(toolBlocks[0].args).toEqual({ command: 'ls' });
  });
});
