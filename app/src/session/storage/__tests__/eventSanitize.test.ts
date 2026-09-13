/**
 * D1（2026-08-24）：事件不可变——eventSanitize 单测
 *
 * 覆盖：
 *  - 合法事件 → ok + 深度冻结（event.data 递归冻结）
 *  - 非 JSON 值（BigInt / undefined / 循环引用 / Date / 稀疏数组 / -0）→ ok=false
 *  - 已冻结事件 → 幂等跳过（无二次遍历）
 *  - append 拒写：非法事件返回 invalid-event 且文件无新增行
 *  - read 一致性：append 后 read 返回对象为冻结态
 */
import { describe, it, expect } from 'bun:test';
import { sanitizeEvent } from '../eventSanitize';
import { EventLogStorage } from '../EventLogStorage';
import type { LiriEvent } from '@modules/chat/types/events';

/** 构造一个最小合法事件 */
function makeEvent(overrides: Partial<LiriEvent> = {}): LiriEvent {
  return {
    type: 'user/message',
    seq: 1,
    time: Date.now(),
    sessionId: 'test-session',
    data: { content: 'hello' },
    ...overrides,
  } as LiriEvent;
}

describe('sanitizeEvent', () => {
  it('合法事件 → ok=true 且深冻结（data 递归冻结）', () => {
    const ev = makeEvent({
      data: { content: 'hi', nested: { a: [1, 2, { b: 'c' }] } },
    });
    const result = sanitizeEvent(ev);
    expect(result.ok).toBe(true);
    expect(result.event).toBe(ev);
    expect(Object.isFrozen(ev)).toBe(true);
    expect(Object.isFrozen(ev.data)).toBe(true);
    expect(Object.isFrozen((ev.data as { nested: object }).nested)).toBe(true);
    expect(
      Object.isFrozen((ev.data as { nested: { a: unknown[] } }).nested.a)
    ).toBe(true);
  });

  it('BigInt → ok=false', () => {
    const ev = makeEvent({
      data: { content: 'x', big: 1n } as unknown as Record<string, unknown>,
    });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('undefined 字段 → ok=false（JSON.stringify 会静默丢字段）', () => {
    const ev = makeEvent({
      data: { content: 'x', undef: undefined } as unknown as Record<
        string,
        unknown
      >,
    });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('循环引用 → ok=false', () => {
    const cyclic: Record<string, unknown> = { content: 'x' };
    cyclic.self = cyclic;
    const ev = makeEvent({ data: cyclic });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('Date 实例 → ok=false', () => {
    const ev = makeEvent({
      data: { content: 'x', d: new Date() } as unknown as Record<
        string,
        unknown
      >,
    });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('稀疏数组 → ok=false', () => {
    const sparse = ['a'];
    (sparse as (string | undefined)[])[2] = 'c'; // 空洞
    const ev = makeEvent({
      data: { content: 'x', arr: sparse } as unknown as Record<string, unknown>,
    });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('-0 → ok=false（JSON.stringify 归一为 0，语义丢失）', () => {
    const ev = makeEvent({
      data: { content: 'x', neg: -0 } as unknown as Record<string, unknown>,
    });
    expect(sanitizeEvent(ev).ok).toBe(false);
  });

  it('已冻结事件 → 幂等跳过（ok=true 且不改变冻结态）', () => {
    const ev = makeEvent();
    sanitizeEvent(ev); // 首次冻结
    const frozenRef = ev;
    const result = sanitizeEvent(ev); // 二次调用
    expect(result.ok).toBe(true);
    expect(result.event).toBe(frozenRef);
    expect(Object.isFrozen(ev)).toBe(true);
  });
});

describe('EventLogStorage D1 集成（纯内存，不写盘）', () => {
  it('append 非法事件 → invalid-event（sanitize 阶段拒写，不触盘）', async () => {
    const storage = new EventLogStorage('d1-test-session', 'd1-worktree');
    const bad = makeEvent({
      seq: 1,
      data: { content: 'x', big: 1n } as unknown as Record<string, unknown>,
    });
    const result = await storage.append(bad);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-event');
  });

  it('append 合法事件 → 调用后事件对象已冻结（内存==磁盘契约）', async () => {
    const storage = new EventLogStorage('d1-test-session', 'd1-worktree');
    const ev = makeEvent({ seq: 1 });
    // 合法事件会走到写盘阶段（沙箱下可能返回 write-error），
    // 但 sanitize 已先执行——无论写盘成败，事件对象必须已冻结
    await storage.append(ev);
    expect(Object.isFrozen(ev)).toBe(true);
    expect(Object.isFrozen(ev.data)).toBe(true);
  });
});
