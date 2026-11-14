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
  renderSideEffectLog,
  type RecordedFileOp,
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
