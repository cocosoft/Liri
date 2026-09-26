/**
 * P3-1（2026-09-26，裁定 A）：**启动期从盘重建血缘** —— `rebuildSessionLineage` 单测。
 *
 * 锁定六件事：
 *  ① 基本重建 ⇒ 祖先判定恢复（含多跳）；
 *  ② **顺序无关**（子先父后 / 父先子后结果一致）；
 *  ③ **净化**：自环 / 环 / 超深分别被丢弃且**原因可辨**（丢弃 = fail-closed 方向）；
 *  ④ **parent-unknown ⇒ 视为链头保留**（2026-09-26 裁定；保住链形状与深度计数）；
 *  ⑤ **幂等**（重复重建结果一致）；
 *  ⑥ **重建后 fork 守卫恢复** —— 与"重启前同一进程内"的 `getLineageDepth` /
 *     `wouldCreateLineageCycle` 判定一致（这正是修复前的第二类后果）。
 */
import { describe, test, expect, beforeEach } from 'bun:test';
import {
  MAX_LINEAGE_HOPS,
  getLineageDepth,
  getSessionParent,
  isAncestorSession,
  rebuildSessionLineage,
  resetSessionLineage,
  wouldCreateLineageCycle,
  type LineageRebuildEntry,
} from '../../src/session/lineage/sessionLineage';

/** 造 `n` 跳链：`s1→s0`、`s2→s1` … `sn→s(n-1)`（`s0` 不在入参 ⇒ 链头） */
function chainEntries(n: number): LineageRebuildEntry[] {
  const entries: LineageRebuildEntry[] = [];
  for (let i = 1; i <= n; i++) {
    entries.push({ id: `s${i}`, parentSessionId: `s${i - 1}` });
  }
  return entries;
}

beforeEach(() => {
  resetSessionLineage();
});

describe('rebuildSessionLineage：基本重建与顺序无关', () => {
  test('c→b→a ⇒ 祖先判定恢复（多跳命中、反向不命中）', () => {
    const stats = rebuildSessionLineage([
      { id: 'c', parentSessionId: 'b' },
      { id: 'b', parentSessionId: 'a' },
    ]);

    expect(stats.registered).toBe(2);
    expect(stats.dropped).toEqual([]);
    expect(stats.size).toBe(2);
    expect(getSessionParent('c')).toBe('b');
    expect(isAncestorSession('a', 'c')).toBe(true);
    expect(isAncestorSession('b', 'c')).toBe(true);
    expect(isAncestorSession('c', 'a')).toBe(false);
  });

  test('**顺序无关**：子先父后 与 父先子后 结果一致', () => {
    const childFirst = rebuildSessionLineage([
      { id: 'c', parentSessionId: 'b' },
      { id: 'b', parentSessionId: 'a' },
    ]);
    const parentFirst = rebuildSessionLineage([
      { id: 'b', parentSessionId: 'a' },
      { id: 'c', parentSessionId: 'b' },
    ]);

    expect(childFirst).toEqual(parentFirst);
    expect(isAncestorSession('a', 'c')).toBe(true);
  });

  test('空入参 / 空字段 ⇒ 不登记、不报错', () => {
    const stats = rebuildSessionLineage([
      { id: '', parentSessionId: 'a' },
      { id: 'x', parentSessionId: null },
      { id: 'y' },
    ]);

    expect(stats.registered).toBe(0);
    expect(stats.size).toBe(0);
    expect(stats.dropped).toEqual([]);
  });
});

describe('rebuildSessionLineage：净化（丢边 = fail-closed 方向）', () => {
  test('自环 ⇒ 丢弃并记 reason=self（不计入登记）', () => {
    const stats = rebuildSessionLineage([
      { id: 'x', parentSessionId: 'x' },
      { id: 'y', parentSessionId: 'root' },
    ]);

    expect(stats.registered).toBe(1);
    expect(stats.dropped).toEqual([
      { childId: 'x', parentId: 'x', reason: 'self' },
    ]);
  });

  test('互为祖先的环（x→y 且 y→x）⇒ 只登记一条、另一条记 reason=cycle（且不死循环）', () => {
    const stats = rebuildSessionLineage([
      { id: 'x', parentSessionId: 'y' },
      { id: 'y', parentSessionId: 'x' },
    ]);

    expect(stats.registered).toBe(1);
    expect(stats.dropped).toHaveLength(1);
    expect(stats.dropped[0].reason).toBe('cycle');
    // 仍不互相授予控制权（两条都命中才算成环 ⇒ 现在至少一条方向判否）
    expect(isAncestorSession('x', 'y') && isAncestorSession('y', 'x')).toBe(
      false
    );
  });

  test(`超深链（${MAX_LINEAGE_HOPS}+1 跳）⇒ 超限边记 reason=too-deep`, () => {
    const stats = rebuildSessionLineage(chainEntries(MAX_LINEAGE_HOPS + 1));

    expect(stats.registered).toBe(MAX_LINEAGE_HOPS);
    expect(stats.dropped).toEqual([
      {
        childId: `s${MAX_LINEAGE_HOPS + 1}`,
        parentId: `s${MAX_LINEAGE_HOPS}`,
        reason: 'too-deep',
      },
    ]);
    expect(getLineageDepth(`s${MAX_LINEAGE_HOPS}`)).toBe(MAX_LINEAGE_HOPS);
  });
});

describe('rebuildSessionLineage：parent-unknown 与幂等', () => {
  test('父会话已不在盘上 ⇒ **仍登记该边、视为链头**（2026-09-26 裁定）', () => {
    const stats = rebuildSessionLineage([
      { id: 'c', parentSessionId: 'ghost' },
    ]);

    expect(stats.registered).toBe(1);
    expect(stats.dropped).toEqual([]);
    expect(getSessionParent('c')).toBe('ghost');
    // 上溯到链头即停（fail-closed：不臆造更上面的祖先）
    expect(isAncestorSession('ghost', 'c')).toBe(true);
    expect(isAncestorSession('unknown', 'c')).toBe(false);
  });

  test('幂等：连续两次重建结果一致', () => {
    const entries = [
      { id: 'c', parentSessionId: 'b' },
      { id: 'b', parentSessionId: 'a' },
    ];

    const first = rebuildSessionLineage(entries);
    const second = rebuildSessionLineage(entries);

    expect(second).toEqual(first);
    expect(getSessionParent('c')).toBe('b');
  });
});

describe('rebuildSessionLineage：重建后 **fork 守卫恢复**（P3-1 第二类后果）', () => {
  test('不重建时守卫被弱化（这就是修复前的状态）', () => {
    resetSessionLineage();

    // 链空 ⇒ 深度恒 0、环判定看不见任何关系
    expect(getLineageDepth('c')).toBe(0);
    expect(wouldCreateLineageCycle('a', 'c')).toBe(false);
  });

  test('重建后与"重启前同一进程内"一致：深度正确、环判定能拦住倒挂 fork', () => {
    rebuildSessionLineage([
      { id: 'c', parentSessionId: 'b' },
      { id: 'b', parentSessionId: 'a' },
    ]);

    // 深度恢复 ⇒ `MAX_LINEAGE_HOPS` 不会被跨重启绕过
    expect(getLineageDepth('c')).toBe(2);
    // 倒挂 fork（把祖先 a 挂到后代 c 之下）⇒ 判为成环
    expect(wouldCreateLineageCycle('a', 'c')).toBe(true);
    // 正常 fork（新子会话挂到 c 之下）⇒ 不成环
    expect(wouldCreateLineageCycle('c-new', 'c')).toBe(false);
  });
});
