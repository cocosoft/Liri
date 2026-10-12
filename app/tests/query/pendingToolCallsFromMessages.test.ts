// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// F1（债二-预算挂起续跑 §Task 1）：从 `ChatMessage[]` 尾部重建「未完成工具」的纯函数单测。
// 语义对齐事件版 `chat/utils/pendingToolCalls.ts`：
//   ① 已有 tool 消息应答（role === 'tool'，带 tool_call_id）的 tool_calls 不收；
//   ② 未应答的 tool_calls 收集（toolName / args 透传）；
//   ③ 从尾部向前扫，遇 role === 'user' 即停（user 之前的未答不算）；
//   ④ 无 tool_calls / 空数组 ⇒ 返回 []。

import { describe, it, expect } from 'bun:test';
import { extractPendingToolCallsFromMessages } from '../../src/query/taor/pendingToolCalls.js';
import type { ChatMessage } from '@modules/ai/models/types.js';

const assistant = (
  toolCalls: NonNullable<ChatMessage['tool_calls']>
): ChatMessage => ({ role: 'assistant', content: '', tool_calls: toolCalls });

const toolReply = (toolCallId: string): ChatMessage => ({
  role: 'tool',
  content: 'ok',
  tool_call_id: toolCallId,
});

describe('extractPendingToolCallsFromMessages（F1）', () => {
  it('① 未应答的 tool_calls 被收集，已应答的不收', () => {
    const messages: ChatMessage[] = [
      assistant([
        {
          id: 'tc-answered',
          type: 'function',
          function: { name: 'bash', arguments: '{"command":"ls"}' },
        },
        {
          id: 'tc-pending',
          type: 'function',
          function: { name: 'grep', arguments: '{"pattern":"a"}' },
        },
      ]),
      toolReply('tc-answered'),
    ];

    const pending = extractPendingToolCallsFromMessages(messages);

    expect(pending).toHaveLength(1);
    expect(pending.map((p) => p.toolCallId)).toEqual(['tc-pending']);
  });

  it('② 未应答的 tool_calls 收集，toolName / args 透传（含非 JSON 原串）', () => {
    const messages: ChatMessage[] = [
      assistant([
        {
          id: 'tc-2',
          type: 'function',
          function: { name: 'glob', arguments: '{"pattern":"**/*.ts"}' },
        },
        {
          id: 'tc-3',
          type: 'function',
          function: { name: 'read', arguments: 'not-json' },
        },
      ]),
    ];

    const pending = extractPendingToolCallsFromMessages(messages);
    const ids = pending.map((p) => p.toolCallId);
    expect(ids).toContain('tc-2');
    expect(ids).toContain('tc-3');

    const glob = pending.find((p) => p.toolCallId === 'tc-2');
    expect(glob?.toolName).toBe('glob');
    expect(glob?.args).toEqual({ pattern: '**/*.ts' });

    const read = pending.find((p) => p.toolCallId === 'tc-3');
    expect(read?.toolName).toBe('read');
    // 解析失败 ⇒ 原串保留（不抛错）
    expect(read?.args).toBe('not-json');
  });

  it("③ user 边界：遇 role === 'user' 停，user 之前的未答不算", () => {
    const messages: ChatMessage[] = [
      assistant([
        {
          id: 'tc-old',
          type: 'function',
          function: { name: 'bash', arguments: '{}' },
        },
      ]),
      { role: 'user', content: '新对话' },
      { role: 'assistant', content: '你好' },
    ];

    const pending = extractPendingToolCallsFromMessages(messages);
    expect(pending).toEqual([]);
  });

  it('④ 无 tool_calls / 空数组 ⇒ 返回 []', () => {
    expect(extractPendingToolCallsFromMessages([])).toEqual([]);
    expect(
      extractPendingToolCallsFromMessages([
        { role: 'assistant', content: 'hi' },
      ])
    ).toEqual([]);
    expect(extractPendingToolCallsFromMessages([assistant([])])).toEqual([]);
  });
});
