// MIT License
// Copyright (c) 2026 190615273@qq.com

// isEmptyAssistantWithoutToolCalls — 空正文 assistant 消息过滤（避免污染 API 上下文）
import { describe, it, expect } from 'bun:test';
import { isEmptyAssistantWithoutToolCalls } from '../../src/chat/services/ChatHelper';
import type { Message } from '../../src/chat/types/message.js';

function asst(partial: Partial<Message>): Message {
  return { role: 'assistant', content: '', ...partial } as Message;
}

describe('isEmptyAssistantWithoutToolCalls', () => {
  it('跳过空正文且无 tool_calls 的 assistant 消息', () => {
    expect(isEmptyAssistantWithoutToolCalls(asst({ content: '' }))).toBe(true);
    expect(
      isEmptyAssistantWithoutToolCalls(asst({ content: '   ' }))
    ).toBe(true);
  });

  it('保留有正文的 assistant 消息', () => {
    expect(
      isEmptyAssistantWithoutToolCalls(asst({ content: '你好' }))
    ).toBe(false);
  });

  it('保留空正文但有 metadata.tool_calls 的 assistant 消息（工具轮次）', () => {
    expect(
      isEmptyAssistantWithoutToolCalls(
        asst({ metadata: { tool_calls: [{ id: 'tc-1' }] } })
      )
    ).toBe(false);
  });

  it('保留空正文但有消息级 tool_calls 的 assistant 消息', () => {
    expect(
      isEmptyAssistantWithoutToolCalls(asst({ tool_calls: [{ id: 'tc-1' }] }))
    ).toBe(false);
  });

  it('保留空正文但 metadata.tool_calls 为空数组时不保留', () => {
    expect(
      isEmptyAssistantWithoutToolCalls(asst({ metadata: { tool_calls: [] } }))
    ).toBe(true);
  });

  it('非 assistant 角色一律不判为空', () => {
    expect(
      isEmptyAssistantWithoutToolCalls({ role: 'user', content: '' } as Message)
    ).toBe(false);
    expect(
      isEmptyAssistantWithoutToolCalls({ role: 'tool', content: '' } as Message)
    ).toBe(false);
    expect(
      isEmptyAssistantWithoutToolCalls({
        role: 'system',
        content: '',
      } as Message)
    ).toBe(false);
  });
});
