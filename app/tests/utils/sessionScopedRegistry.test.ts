/**
 * SessionScopedRegistry —— 会话级缓存统一 dispose 契约（源码排查报告 S1/S2）。
 *
 * 关键不变式：只要通过 `getOrCreate()` / `set()` 写入，`dispose(sessionId)` 就能
 * 精确回收该会话的**全部**键（含 `sessionId::variant` 这类扩容键），且不影响其它会话。
 */
import { describe, expect, it } from 'bun:test';

import { SessionScopedRegistry } from '../../src/utils/SessionScopedRegistry.js';

const SEP = '::turnsX';

describe('SessionScopedRegistry', () => {
  it('getOrCreate：同会话同变体复用，不同变体分键', () => {
    const reg = new SessionScopedRegistry<{ n: number }>(SEP);
    let created = 0;
    const factory = () => ({ n: ++created });

    const base = reg.getOrCreate('s1', factory);
    const baseAgain = reg.getOrCreate('s1', factory);
    const expanded = reg.getOrCreate('s1', factory, '2');

    expect(baseAgain).toBe(base);
    expect(expanded).not.toBe(base);
    expect(created).toBe(2);
    expect(reg.keysOf('s1')).toEqual(['s1', `s1${SEP}2`]);
  });

  it('dispose：回收该会话全部变体，其它会话不受影响', () => {
    const reg = new SessionScopedRegistry<number>(SEP);
    reg.getOrCreate('s1', () => 1);
    reg.getOrCreate('s1', () => 2, '2');
    reg.getOrCreate('s2', () => 3);

    reg.dispose('s1');

    expect(reg.keysOf('s1')).toEqual([]);
    expect(reg.size).toBe(1);
    expect(reg.get('s2')).toBe(3);
    expect(reg.sessions()).toEqual(['s2']);
  });

  it('dispose 幂等（无键时 no-op）', () => {
    const reg = new SessionScopedRegistry<number>();
    reg.dispose('missing');
    expect(reg.size).toBe(0);
    expect(reg.sessions()).toEqual([]);
  });

  it('delete 保持会话索引一致', () => {
    const reg = new SessionScopedRegistry<number>(SEP);
    reg.set('s1', 1);
    reg.set(`s1${SEP}2`, 2);

    expect(reg.delete('s1')).toBe(true);
    expect(reg.keysOf('s1')).toEqual([`s1${SEP}2`]);

    expect(reg.delete(`s1${SEP}2`)).toBe(true);
    expect(reg.keysOf('s1')).toEqual([]);
    expect(reg.sessions()).toEqual([]);
  });

  it('clear / disposeAll：条目与会话索引一起清空', () => {
    const reg = new SessionScopedRegistry<number>();
    reg.set('s1', 1);
    reg.set('s2', 2);

    reg.disposeAll();

    expect(reg.size).toBe(0);
    expect(reg.sessions()).toEqual([]);
    expect(reg.keysOf('s1')).toEqual([]);
  });

  it('firstPerSession：每会话只取首个实例（flush 去重用）', () => {
    const reg = new SessionScopedRegistry<string>(SEP);
    reg.set('s1', 'base');
    reg.set(`s1${SEP}2`, 'expanded');
    reg.set('s2', 'other');

    expect([...reg.firstPerSession().entries()]).toEqual([
      ['s1', 'base'],
      ['s2', 'other'],
    ]);
  });
});
