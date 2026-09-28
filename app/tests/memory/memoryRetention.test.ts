/**
 * D5-B 保留上限：`selectEvictions` 纯函数单测
 * 规格：`.trae/specs/memory-dedup-blocking-rootfix.md` §D5
 */
import { describe, expect, it } from 'bun:test';
import { selectEvictions, type EvictionCandidate } from '@modules/memory';

const DAY = 86_400_000;
const NOW = Date.now();

function cand(
  id: string,
  over: Partial<EvictionCandidate> = {}
): EvictionCandidate {
  return {
    id,
    type: 'conversation',
    importance: 0.5,
    isPinned: false,
    updatedAt: new Date(NOW),
    ...over,
  };
}

describe('D5-B 保留上限 selectEvictions（纯函数）', () => {
  it('未超限 ⇒ 返回空', () => {
    expect(selectEvictions([cand('a'), cand('b')], 2)).toEqual([]);
    expect(selectEvictions([cand('a')], 10)).toEqual([]);
  });

  it('超限 ⇒ 只取溢出量，低 importance 先出', () => {
    const ms = [
      cand('high', { importance: 0.6 }),
      cand('mid', { importance: 0.5 }),
      cand('low', { importance: 0.1 }),
    ];
    expect(selectEvictions(ms, 1)).toEqual(['low', 'mid']);
  });

  it('同 importance ⇒ 最旧（updatedAt 最小）先出', () => {
    const ms = [
      cand('newer', { updatedAt: new Date(NOW - DAY) }),
      cand('older', { updatedAt: new Date(NOW - 10 * DAY) }),
      cand('newest', { updatedAt: new Date(NOW) }),
    ];
    expect(selectEvictions(ms, 1)).toEqual(['older', 'newer']);
  });

  it('保护项永不入选：user_fact / session_summary / pinned / importance>=0.7', () => {
    const ms = [
      cand('fact', { type: 'user_fact', importance: 0.1 }),
      cand('summary', { type: 'session_summary', importance: 0.1 }),
      cand('pinned', { isPinned: true, importance: 0.1 }),
      cand('important', { importance: 0.9 }),
      cand('plain', { importance: 0.2 }),
    ];
    expect(selectEvictions(ms, 1)).toEqual(['plain']);
  });

  it('全部受保护 ⇒ 少于溢出量（宁可不减，也不误伤）', () => {
    const ms = [
      cand('fact', { type: 'user_fact' }),
      cand('pinned', { isPinned: true }),
      cand('important', { importance: 0.8 }),
    ];
    expect(selectEvictions(ms, 1)).toEqual([]);
  });

  it('不改动入参顺序（纯函数）', () => {
    const ms = [
      cand('a', { importance: 0.9 }),
      cand('b', { importance: 0.1 }),
      cand('c', { importance: 0.5 }),
    ];
    const before = ms.map((m) => m.id);
    selectEvictions(ms, 1);
    expect(ms.map((m) => m.id)).toEqual(before);
  });
});
