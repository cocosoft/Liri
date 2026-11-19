// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 跨轮工具交换「声明+结果」成对清理（2026-11-20）
 *
 * 真机：`buildApiMessagesForStream` 只删旧轮次 `assistant.tool_calls` 声明，却留下对应
 * `tool` 结果 ⇒ 结果成孤儿，被 `ChatCompletionsTransport` 再剥离（`count=8/totalMessages=17`）。
 * 本用例锁住"成对清理 + 当前轮不动 + 计数正确"。
 */

import { describe, expect, it } from 'bun:test';
import { pruneCrossRoundToolExchanges } from '../../src/chat/pipeline/crossRoundToolCleanup.js';

type Msg = Record<string, unknown>;

const assistantCall = (ids: string[]): Msg => ({
  role: 'assistant',
  content: '',
  tool_calls: ids.map((id) => ({
    id,
    type: 'function',
    function: { name: 'bash', arguments: '{}' },
  })),
});
const toolResult = (id: string): Msg => ({
  role: 'tool',
  content: 'ok',
  tool_call_id: id,
});
const user = (text: string): Msg => ({ role: 'user', content: text });

describe('pruneCrossRoundToolExchanges', () => {
  it('旧轮次：删声明的同批移除对应 tool 结果（不再留孤儿）', () => {
    const messages: Msg[] = [
      user('第一轮'),
      assistantCall(['a1', 'a2']),
      toolResult('a1'),
      toolResult('a2'),
      user('第二轮'),
    ];
    const r = pruneCrossRoundToolExchanges(messages, messages.length - 1);

    expect(r).toEqual({
      clearedAssistantDeclarations: 1,
      removedPairedToolResults: 2,
    });
    // 旧轮次的声明被移除、其 tool 结果被移除；assistant 本体保留（正文空，交由投影层跳过）
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const keptAssistant = messages.find((m) => m.role === 'assistant') as Msg;
    expect(keptAssistant.tool_calls).toBeUndefined();
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('当前轮（最后一条 user 之后）一律不动', () => {
    const messages: Msg[] = [
      user('第一轮'),
      assistantCall(['old']),
      toolResult('old'),
      user('第二轮'),
      assistantCall(['cur']),
      toolResult('cur'),
    ];
    const r = pruneCrossRoundToolExchanges(messages, 3); // 最后一条 user 在下标 3

    expect(r.removedPairedToolResults).toBe(1); // 只清旧轮次的 old
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'tool']);
    const assistants = messages.filter((m) => m.role === 'assistant') as Msg[];
    // 旧轮次那条已无声明；当前轮那条保留 cur
    expect(assistants[0]!.tool_calls).toBeUndefined();
    expect((assistants[1]!.tool_calls as Array<{ id: string }>)[0]!.id).toBe(
      'cur'
    );
    expect((messages[messages.length - 1] as Msg).tool_call_id).toBe('cur');
  });

  it('本来就没有声明的 tool 结果（既有孤儿）不归本函数处理', () => {
    const messages: Msg[] = [
      user('第一轮'),
      toolResult('mystery'),
      user('第二轮'),
    ];
    const r = pruneCrossRoundToolExchanges(messages, 2);
    expect(r.removedPairedToolResults).toBe(0);
    expect(messages.some((m) => m.tool_call_id === 'mystery')).toBe(true);
  });

  it('无 user（lastUserMsgIdx=-1）⇒ 全部按旧轮次处理', () => {
    const messages: Msg[] = [assistantCall(['x']), toolResult('x')];
    const r = pruneCrossRoundToolExchanges(messages, -1);
    expect(r).toEqual({
      clearedAssistantDeclarations: 1,
      removedPairedToolResults: 1,
    });
    // assistant 本体保留（声明已被清空），其 tool 结果被移除
    expect(messages).toHaveLength(1);
    expect((messages[0] as Msg).role).toBe('assistant');
    expect((messages[0] as Msg).tool_calls).toBeUndefined();
  });
});
