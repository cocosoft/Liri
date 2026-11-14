// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D7 三期：副作用流水聚合（读侧）。
 *
 * 锁定语义：
 * - 按 `toolName` 分组（升序），组内路径升序；无 `toolName` ⇒ `unattributed`（不硬塞）；
 * - `totals` 固定五类顺序；`paths` 去重升序；
 * - 渲染确定性；空流水如实给"本轮没有记录到文件变更"。
 */

import { describe, expect, it } from 'bun:test';
import {
  buildSideEffectLog,
  collectPlanSideEffects,
  renderSideEffectLog,
  type RecordedFileOp,
  type SnapshotLike,
} from '../../../src/tasks/plan/sideEffectLog';

const OPS: RecordedFileOp[] = [
  { path: 'b.md', type: 'modified', toolName: 'file_write' },
  { path: 'a.md', type: 'created', toolName: 'file_write' },
  { path: 'c.md', type: 'deleted', toolName: 'bash' },
  { path: 'd.md', type: 'modified' },
];

describe('buildSideEffectLog', () => {
  it('按工具分组（升序）+ 组内路径升序 + 未归属单列', () => {
    const log = buildSideEffectLog(OPS);
    expect(log.groups.map((g) => g.toolName)).toEqual(['bash', 'file_write']);
    expect(log.groups[1].entries.map((e) => e.path)).toEqual(['a.md', 'b.md']);
    expect(log.groups[1].counts).toEqual({ created: 1, modified: 1 });
    expect(log.unattributed).toEqual([{ path: 'd.md', type: 'modified' }]);
  });

  it('totals 覆盖五类且 paths 去重升序', () => {
    const log = buildSideEffectLog([
      ...OPS,
      { path: 'a.md', type: 'modified', toolName: 'bash' },
    ]);
    expect(log.totals).toEqual({
      created: 1,
      deleted: 1,
      modified: 3,
      renamed: 0,
      moved: 0,
    });
    expect(log.paths).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
  });

  it('确定性：同输入两次逐字相同', () => {
    expect(renderSideEffectLog(buildSideEffectLog(OPS))).toBe(
      renderSideEffectLog(buildSideEffectLog(OPS))
    );
  });

  it('空流水 ⇒ 如实提示（不伪造条目）', () => {
    const log = buildSideEffectLog([]);
    expect(log.groups).toEqual([]);
    expect(renderSideEffectLog(log)).toContain('本轮没有记录到文件变更');
  });
});

describe('collectPlanSideEffects', () => {
  const SNAPSHOTS: SnapshotLike[] = [
    {
      changedFiles: [
        { path: 'b.md', type: 'modified', toolName: 'file_edit', planId: 'p1' },
        { path: 'a.md', type: 'created', toolName: 'file_write', planId: 'p1' },
      ],
    },
    {
      changedFiles: [
        { path: 'c.md', type: 'modified', toolName: 'file_edit', planId: 'p2' },
        // 旧数据 / 未归属计划的变更 ⇒ 不计入任何计划（不猜归属）
        { path: 'd.md', type: 'modified', toolName: 'file_edit' },
      ],
    },
  ];

  it('只认 planId 精确相等（其他计划与未归属条目不混入）', () => {
    const ops = collectPlanSideEffects(SNAPSHOTS, 'p1');
    expect(ops.map((op) => op.path)).toEqual(['a.md', 'b.md']);
    expect(ops.some((op) => op.path === 'c.md' || op.path === 'd.md')).toBe(
      false
    );
  });

  it('保留 toolName（供按工具分组）', () => {
    const ops = collectPlanSideEffects(SNAPSHOTS, 'p1');
    expect(ops.map((op) => op.toolName)).toEqual(['file_write', 'file_edit']);
  });

  it('按 path → type 升序（确定性）', () => {
    const ops = collectPlanSideEffects(
      [
        {
          changedFiles: [
            { path: 'x.md', type: 'modified', planId: 'p1' },
            { path: 'x.md', type: 'created', planId: 'p1' },
            { path: 'a.md', type: 'deleted', planId: 'p1' },
          ],
        },
      ],
      'p1'
    );
    expect(ops.map((op) => `${op.path}:${op.type}`)).toEqual([
      'a.md:deleted',
      'x.md:created',
      'x.md:modified',
    ]);
  });

  it('无匹配 ⇒ 空数组（不伪造）', () => {
    expect(collectPlanSideEffects(SNAPSHOTS, 'missing')).toEqual([]);
    expect(collectPlanSideEffects([], 'p1')).toEqual([]);
  });
});
