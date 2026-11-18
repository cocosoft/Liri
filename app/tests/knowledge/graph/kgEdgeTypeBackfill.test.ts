/**
 * kg_edges.edge_type 回填脚本的**纯函数**单测（D8，2026-11-18）
 *
 * 只测计划折算（不连库）：别名收敛 / 幂等（规范名不进计划）/ 空值兜底 / 按行数降序。
 */
import { describe, expect, it } from 'bun:test';

import { planEdgeTypeBackfill } from '../../../scripts/backfill-kg-edge-types';

describe('planEdgeTypeBackfill', () => {
  it('别名/大小写/分隔符 ⇒ 规范名（复用 normalizeRelationType）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'works_at', count: 3 },
      { edge_type: 'Works-At', count: 1 },
      { edge_type: 'is_a', count: 2 },
      { edge_type: 'mentions_entity', count: 4 },
    ]);
    expect(plan).toEqual(
      expect.arrayContaining([
        { from: 'works_at', to: 'works_for', count: 3 },
        { from: 'Works-At', to: 'works_for', count: 1 },
        { from: 'is_a', to: 'subtype_of', count: 2 },
        { from: 'mentions_entity', to: 'mentions', count: 4 },
      ])
    );
  });

  it('已是规范名 ⇒ 不进计划（幂等：再跑一遍为空）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'works_for', count: 9 },
      { edge_type: 'related_to', count: 5 },
    ]);
    expect(plan).toEqual([]);
  });

  it('空串 ⇒ related_to（与本体「空值兜底」同口径）', () => {
    expect(planEdgeTypeBackfill([{ edge_type: '', count: 1 }])).toEqual([
      { from: '', to: 'related_to', count: 1 },
    ]);
  });

  it('按行数降序（先看大头）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'is_a', count: 2 },
      { edge_type: 'works_at', count: 50 },
    ]);
    expect(plan.map((r) => r.from)).toEqual(['works_at', 'is_a']);
  });
});
