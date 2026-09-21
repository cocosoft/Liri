/**
 * 会话血缘链（O10b / Tier1）—— 祖先判定单测
 *
 * 锁定：① 一跳/多跳祖先命中；② 自身相等即命中（Tier2 之外的语义兼容）；
 * ③ **超过 `max_hops`（默认 8）不认**；④ 环保护（不死循环、不误判）；
 * ⑤ 链上无此会话 ⇒ 判否（fail-closed）。
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  MAX_LINEAGE_HOPS,
  isAncestorSession,
  getSessionParent,
  registerSessionLineage,
  resetSessionLineage,
} from '../../src/session/lineage/sessionLineage';

describe('会话血缘链 isAncestorSession（O10b / Tier1）', () => {
  beforeEach(() => {
    resetSessionLineage();
  });

  test('直接父会话 ⇒ 命中；子自身 ⇒ 命中（等价）', () => {
    registerSessionLineage('child', 'parent');

    expect(isAncestorSession('parent', 'child')).toBe(true);
    expect(isAncestorSession('child', 'child')).toBe(true);
    expect(getSessionParent('child')).toBe('parent');
  });

  test('多跳祖先（曾祖 → 孙）⇒ 命中', () => {
    registerSessionLineage('c', 'b');
    registerSessionLineage('b', 'a');

    expect(isAncestorSession('a', 'c')).toBe(true); // 两跳
    expect(isAncestorSession('b', 'c')).toBe(true); // 一跳
  });

  test('不在血缘链上的会话 ⇒ 判否（fail-closed，不误放行）', () => {
    registerSessionLineage('c', 'b');

    expect(isAncestorSession('unrelated', 'c')).toBe(false);
    expect(isAncestorSession('', 'c')).toBe(false);
    expect(isAncestorSession('b', '')).toBe(false);
  });

  test('超过 max_hops（默认 8）⇒ 不认', () => {
    // 构造 10 跳链：s9 → s8 → … → s0
    for (let i = 1; i <= 9; i++) {
      registerSessionLineage(`s${i}`, `s${i - 1}`);
    }

    expect(MAX_LINEAGE_HOPS).toBe(8);
    expect(isAncestorSession('s7', 's9')).toBe(true); // 两跳内
    expect(isAncestorSession('s0', 's9')).toBe(false); // 九跳 ⇒ 超出上限
    // 显式放宽上限后应命中（证明是"跳数"而非"链断裂"导致）
    expect(isAncestorSession('s0', 's9', 12)).toBe(true);
  });

  test('环保护：自环 / 互环均不死循环且判否', () => {
    registerSessionLineage('x', 'x'); // 自环（登记时即被忽略）
    expect(getSessionParent('x')).toBeNull();

    registerSessionLineage('p', 'q');
    registerSessionLineage('q', 'p');
    expect(isAncestorSession('r', 'p')).toBe(false);
  });
});
