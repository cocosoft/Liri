/**
 * FIX-8（2026-10-27）：空正文 assistant 消息的持久化判据。
 *
 * 真机证据（app.log 08:12–08:22，4 次 / 3 会话）：
 * `chat:空正文助手消息拒绝持久化 {"blockTypes":[]}`，而同轮 raw response 为
 * `hasToolCalls:true（glob×2）`、`textChunkCount:0`（模型只输出思考 + 工具调用）。
 * 因 `ReActToolLoop` 把 `tool_calls` 写在 `metadata.tool_calls`，而判据只查顶层字段
 * ⇒ 合法工具轮次被丢弃，历史里缺 assistant/tool_call。
 */
import { describe, expect, it } from 'bun:test';

import { shouldRejectEmptyAssistantMessage } from '../../src/chat/manager/messagePersistence';
import type { Message } from '@modules/session/types/message';

function assistant(patch: Partial<Message>): Message {
  return {
    id: 'm-1',
    role: 'assistant',
    content: '',
    sessionId: 's-1',
    createdAt: new Date(),
    ...patch,
  } as Message;
}

describe('空正文 assistant 持久化判据（FIX-8）', () => {
  it('空正文 + metadata.tool_calls ⇒ 放行（工具轮次的真实存放位置）', () => {
    const msg = assistant({
      metadata: {
        tool_calls: [{ id: 'call_1', type: 'function', function: {} }],
      } as Message['metadata'],
    });
    expect(shouldRejectEmptyAssistantMessage(msg)).toBe(false);
  });

  it('空正文 + 顶层 tool_calls ⇒ 放行（既有行为不变）', () => {
    const msg = assistant({
      tool_calls: [{ id: 'call_1' }],
    } as unknown as Partial<Message>);
    expect(shouldRejectEmptyAssistantMessage(msg)).toBe(false);
  });

  it('空正文 + blocks 含 tool_call / text ⇒ 放行', () => {
    expect(
      shouldRejectEmptyAssistantMessage(
        assistant({
          blocks: [{ type: 'tool_call' }],
        } as unknown as Partial<Message>)
      )
    ).toBe(false);
    expect(
      shouldRejectEmptyAssistantMessage(
        assistant({
          blocks: [{ type: 'text' }],
        } as unknown as Partial<Message>)
      )
    ).toBe(false);
  });

  it('空正文 + 无任何工具/块 ⇒ 拒绝（真正的终态真空）', () => {
    expect(shouldRejectEmptyAssistantMessage(assistant({}))).toBe(true);
    expect(
      shouldRejectEmptyAssistantMessage(
        assistant({ metadata: { tool_calls: [] } as Message['metadata'] })
      )
    ).toBe(true);
  });

  it('非空正文 / 非 assistant ⇒ 永不拒绝', () => {
    expect(
      shouldRejectEmptyAssistantMessage(assistant({ content: 'ok' }))
    ).toBe(false);
    expect(
      shouldRejectEmptyAssistantMessage(
        assistant({ role: 'user' } as Partial<Message>)
      )
    ).toBe(false);
  });
});
