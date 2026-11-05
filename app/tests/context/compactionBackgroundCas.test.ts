// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * C5（2026-11-05）：后台压缩的 CAS 冲突重试。
 *
 * 背景：`compactSessionInBackground` 的两道守卫（消息数量 / 内容指纹）原为"失败即放弃"——
 * 用户在压缩期间发消息时，本轮后台压缩白跑，下一条消息到来又得从头压缩。
 * 现改为**有界重试一次**：按最新快照重跑；仍冲突才放弃并如实告警。
 *
 * 本用例直接桩掉 `compact()`（不跑真实压缩管线），只验证守卫与重试的编排语义。
 */
import { describe, it, expect } from 'bun:test';
import type { ChatMessage } from '@modules/ai';
import { CompactionOrchestrator } from '../../src/context/compaction/CompactionOrchestrator.js';

type CompactFn = (
  messages: ChatMessage[],
  ctx: { sessionId?: string; model: string }
) => Promise<{ messages: ChatMessage[]; applied: boolean }>;

const msg = (role: 'user' | 'assistant', content: string): ChatMessage =>
  ({ role, content }) as ChatMessage;

const makeMessages = (n: number): ChatMessage[] =>
  Array.from({ length: n }, (_, i) =>
    msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)
  );

/** 桩掉私有 `compact()`：本用例只关心守卫触发的重试编排，不跑真实压缩 */
function stubCompact(orch: CompactionOrchestrator, fn: CompactFn): void {
  (orch as unknown as { compact: CompactFn }).compact = fn;
}

const ctx = { sessionId: 'sess-cas', model: 'test-model' };

describe('compactSessionInBackground — CAS 冲突重试', () => {
  it('无并发变化 ⇒ 一次成功写回', async () => {
    const orch = new CompactionOrchestrator();
    const messages = makeMessages(4);
    let calls = 0;
    const written: ChatMessage[][] = [];
    stubCompact(orch, async () => {
      calls += 1;
      return { messages: [msg('assistant', 'compacted')], applied: true };
    });

    const ok = await orch.compactSessionInBackground(
      () => messages,
      (m) => written.push(m),
      ctx
    );

    expect(ok).toBe(true);
    expect(calls).toBe(1);
    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
  });

  it('首次遇到并发新增 ⇒ 按最新快照重跑一次并写回', async () => {
    const orch = new CompactionOrchestrator();
    const messages = makeMessages(4);
    let calls = 0;
    const written: ChatMessage[][] = [];
    stubCompact(orch, async (snapshot) => {
      calls += 1;
      if (calls === 1) {
        // 模拟"压缩期间用户又发了一条"：数量守卫必然失败
        snapshot.push(msg('user', 'concurrent'));
        return { messages: [...snapshot], applied: true };
      }
      return { messages: [msg('assistant', 'compacted')], applied: true };
    });

    const ok = await orch.compactSessionInBackground(
      () => messages,
      (m) => written.push(m),
      ctx
    );

    expect(ok).toBe(true);
    expect(calls).toBe(2);
    expect(written).toHaveLength(1);
  });

  it('内容被并发改写（数量不变）⇒ 同样重跑一次', async () => {
    const orch = new CompactionOrchestrator();
    const messages = makeMessages(3);
    let calls = 0;
    const written: ChatMessage[][] = [];
    stubCompact(orch, async () => {
      calls += 1;
      if (calls === 1) {
        messages[0] = msg('user', 'edited-0');
        return { messages: [...messages], applied: true };
      }
      return { messages: [msg('assistant', 'compacted')], applied: true };
    });

    const ok = await orch.compactSessionInBackground(
      () => messages,
      (m) => written.push(m),
      ctx
    );

    expect(ok).toBe(true);
    expect(calls).toBe(2);
    expect(written).toHaveLength(1);
  });

  it('持续冲突 ⇒ 只重试一次后放弃（不超过上限，不覆盖用户消息）', async () => {
    const orch = new CompactionOrchestrator();
    const messages = makeMessages(2);
    let calls = 0;
    const written: ChatMessage[][] = [];
    stubCompact(orch, async (snapshot) => {
      calls += 1;
      snapshot.push(msg('user', `c${calls}`));
      return { messages: [...snapshot], applied: true };
    });

    const ok = await orch.compactSessionInBackground(
      () => messages,
      (m) => written.push(m),
      ctx
    );

    expect(ok).toBe(false);
    expect(calls).toBe(2);
    expect(written).toHaveLength(0);
  });

  it('压缩未应用（applied:false）⇒ 不触发重试', async () => {
    const orch = new CompactionOrchestrator();
    const messages = makeMessages(2);
    let calls = 0;
    let written = 0;
    stubCompact(orch, async () => {
      calls += 1;
      return { messages: [...messages], applied: false };
    });

    const ok = await orch.compactSessionInBackground(
      () => messages,
      () => {
        written += 1;
      },
      ctx
    );

    expect(ok).toBe(false);
    expect(calls).toBe(1);
    expect(written).toBe(0);
  });
});
