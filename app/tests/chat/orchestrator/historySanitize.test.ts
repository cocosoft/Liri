/**
 * P2-1g —— S1 请求准备「发送前历史污染清洗」契约测试（2026-10-10）。
 *
 * 依据：`.trae/specs/stream-message-flow-split.md` §5-P2-1g；实现见
 * `src/chat/orchestrator/streamMessageHelpers.ts`。
 *
 * 锁定（对应 2026-08-20「QQ 空响应」事故防御）：
 * 1. 规则 a：空 assistant（`content` 空/`null` 且无 `tool_calls`）丢弃并计数；
 * 2. 规则 b：连续纯文本 assistant 合并（换行拼接）；带 `tool_calls` 的**不**合并（护调用序列）；
 * 3. 纯度：输入数组与其中消息对象**均不被改写**；保留条目为浅拷贝；
 * 4. 无污染 ⇒ 计数为 0（调用方据此跳过写回，保持数组同一性）。
 */
import { describe, expect, it } from 'bun:test';

import { sanitizeHistoryPollution } from '../../../src/chat/orchestrator/streamMessageHelpers.js';

type Msg = Record<string, unknown>;

const user = (content: string): Msg => ({ role: 'user', content });
const assistant = (content: unknown): Msg => ({ role: 'assistant', content });
const assistantWithTools = (content: unknown): Msg => ({
  role: 'assistant',
  content,
  tool_calls: [{ id: 'call-1' }],
});

describe('P2-1g S1 请求准备 · 发送前历史污染清洗', () => {
  it('规则 a：空 assistant（null / undefined / 空白串）丢弃并计数', () => {
    const input: Msg[] = [
      user('你好'),
      assistant(null),
      assistant(undefined),
      assistant('   '),
      assistant('有效回复'),
    ];
    const r = sanitizeHistoryPollution(input);
    expect(r.droppedEmpty).toBe(3);
    expect(r.mergedRuns).toBe(0);
    expect(r.messages).toHaveLength(2);
    expect(r.messages.map((m) => m.content)).toEqual(['你好', '有效回复']);
  });

  it('带 `tool_calls` 的空 assistant **不**丢弃（其后紧跟 tool 结果）', () => {
    const input: Msg[] = [user('跑一下'), assistantWithTools(null)];
    const r = sanitizeHistoryPollution(input);
    expect(r.droppedEmpty).toBe(0);
    expect(r.messages).toHaveLength(2);
  });

  it('规则 b：连续纯文本 assistant 合并（换行拼接）并计数', () => {
    const input: Msg[] = [
      user('q'),
      assistant('第一段'),
      assistant('第二段'),
      assistant('第三段'),
    ];
    const r = sanitizeHistoryPollution(input);
    expect(r.mergedRuns).toBe(2);
    expect(r.droppedEmpty).toBe(0);
    expect(r.messages).toHaveLength(2);
    expect(r.messages[1].content).toBe('第一段\n第二段\n第三段');
  });

  it('带 `tool_calls` 的 assistant 后接文本 assistant ⇒ **不**合并（护调用序列）', () => {
    const input: Msg[] = [
      assistantWithTools(null),
      assistant('工具结果后的文本'),
    ];
    const r = sanitizeHistoryPollution(input);
    expect(r.mergedRuns).toBe(0);
    expect(r.messages).toHaveLength(2);
  });

  it('纯度：输入数组与输入消息对象**均不被改写**；保留条目为浅拷贝', () => {
    const m1 = assistant('第一段');
    const m2 = assistant('第二段');
    const input: Msg[] = [user('q'), m1, m2];
    const r = sanitizeHistoryPollution(input);
    // 输入未被改动（合并只发生在输出拷贝上）
    expect(input).toHaveLength(3);
    expect(m1.content).toBe('第一段');
    expect(m2.content).toBe('第二段');
    // 保留条目为浅拷贝（引用不同）
    expect(r.messages[1]).not.toBe(m1);
  });

  it('无污染 ⇒ 计数为 0（调用方据此跳过写回）', () => {
    const input: Msg[] = [user('q'), assistant('a')];
    const r = sanitizeHistoryPollution(input);
    expect(r.droppedEmpty).toBe(0);
    expect(r.mergedRuns).toBe(0);
    expect(r.messages).toHaveLength(2);
  });
});
