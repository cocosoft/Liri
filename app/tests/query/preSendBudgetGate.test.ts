/**
 * 预发送体积闸（2026-10-31，用户裁定）
 *
 * 现状：只有**事后**恢复 —— 请求先被 provider 以 400 拒绝（单日 155 次、最大 1.79M tokens，
 * 窗口 1.05M），再 `compact_and_retry`。本闸在**发送前**按 messages 估算判定，
 * 达窗口 70% 先 `compactIfNeeded` 再发。
 */
import { describe, expect, it } from 'bun:test';
import {
  PRE_SEND_COMPACT_RATIO,
  ensureContextWithinBudget,
  truncateMessagesHead,
} from '../../src/query/taor/helpers';

const msg = (content: string) => ({ role: 'user', content }) as never;

describe('预发送体积闸 ensureContextWithinBudget', () => {
  it('达到阈值 ⇒ 调 compact 并回报 compacted', async () => {
    const calls: string[] = [];
    const r = await ensureContextWithinBudget({
      messages: [msg('x'.repeat(1000))],
      model: 'deepseek-v4-flash',
      sessionId: 'session_a',
      ratio: 1e-9, // 任意非空 messages 都会越线
      compact: async (sid) => {
        calls.push(sid);
      },
    });

    expect(r.compacted).toBe(true);
    expect(calls).toEqual(['session_a']);
    expect(r.window).toBeGreaterThan(0);
  });

  it('未达阈值 ⇒ 不压缩（短消息常规路径）', async () => {
    const calls: string[] = [];
    const r = await ensureContextWithinBudget({
      messages: [msg('hello')],
      model: 'deepseek-v4-flash',
      sessionId: 'session_b',
      compact: async (sid) => {
        calls.push(sid);
      },
    });

    expect(r.compacted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('无 sessionId ⇒ 直接跳过（不压缩、不报错）', async () => {
    const calls: string[] = [];
    const r = await ensureContextWithinBudget({
      messages: [msg('x'.repeat(10_000))],
      model: 'deepseek-v4-flash',
      sessionId: undefined,
      ratio: 1e-9,
      compact: async (sid) => {
        calls.push(sid);
      },
    });

    expect(r.compacted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('生产阈值常量保持 70%', () => {
    expect(PRE_SEND_COMPACT_RATIO).toBe(0.7);
  });
});

describe('truncateMessagesHead（C1 截头重试外迁后行为不变）', () => {
  it('消息数量足够时保留尾部并缩短', () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg(`m${i}`));
    const out = truncateMessagesHead(messages, 0.5);
    expect(out.length).toBeLessThan(messages.length);
  });

  it('消息过少时不截断（原样返回）', () => {
    const messages = [msg('a'), msg('b')];
    expect(truncateMessagesHead(messages, 0.6)).toBe(messages);
  });
});
