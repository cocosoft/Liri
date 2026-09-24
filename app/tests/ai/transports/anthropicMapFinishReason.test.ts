/**
 * 一期 O1-4（2026-09-24「会话暴露问题分析与优化方案」§五）：传输层 `mapFinishReason`
 * 不得用 `hasToolCalls` 覆盖 provider 的真实结束原因。
 *
 * 与主循环 E1 同族（"被 max_tokens 截断且只吐出半个 tool_calls"是最常见的截断形态）；
 * 主循环已在 `ReActToolLoop.reason()` 修好，此处是该缺陷在**传输层**的残留。
 *
 * 「修复前必失败」：原实现首行 `if (hasToolCalls) return 'tool_calls'` ⇒ 截断信号被吃掉。
 */

import { describe, it, expect } from 'bun:test';
import { MessagesApiTransport } from '../../../src/ai/transports/AnthropicMessagesTransport.js';

const t = new MessagesApiTransport();

describe('Anthropic/Messages API mapFinishReason 截断优先（一期 O1-4）', () => {
  it('max_tokens 即使伴随 tool_calls 也必须报 length（修复前报 tool_calls）', () => {
    expect(t.mapFinishReason('max_tokens', true)).toBe('length');
  });

  it('max_tokens 无 tool_calls ⇒ length', () => {
    expect(t.mapFinishReason('max_tokens', false)).toBe('length');
  });

  it('真实 tool_use 仍报 tool_calls（无截断信号时不改变既有语义）', () => {
    expect(t.mapFinishReason('tool_use', true)).toBe('tool_calls');
    expect(t.mapFinishReason('end_turn', true)).toBe('tool_calls');
  });

  it('end_turn 无工具调用 ⇒ stop', () => {
    expect(t.mapFinishReason('end_turn', false)).toBe('stop');
  });
});
