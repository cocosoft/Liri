// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 13-P1-1（2026-10-05）：拓扑依赖失败传播 —— `computeTopoSkips` 守卫。
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A3 —— `scheduleTopoBatches` 分批
 * 只看依赖 id 是否已出批、**不看被依赖节点是否执行成功** ⇒ 前驱失败不阻断后继。
 *
 * 本批新增 `block` 传播（`dependsOnMode:'hard'`）+ 阻断原因；缺省 `soft` = 现状（零行为变化）。
 * ⚠️ 第三种传播 `degrade` **未实现**（需产物级语义，见 `topoBatches.ts` 注释）。
 */
import { describe, it, expect } from 'bun:test';
import {
  computeTopoSkips,
  scheduleTopoBatches,
  type TopoBatchTask,
  type TopoTaskStatus,
} from '../../src/tasks/topoBatches.js';

function task(
  id: string,
  dependsOn?: string[],
  dependsOnMode?: 'hard' | 'soft'
): TopoBatchTask {
  return { id, dependsOn, dependsOnMode };
}

describe('computeTopoSkips（13-P1-1 依赖失败传播）', () => {
  it('缺省 soft：前驱失败**不阻断**后继（= 现状零变化）', () => {
    const tasks = [task('a'), task('b', ['a'])];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'failed']])
    );
    expect(skips.size).toBe(0);
  });

  it('hard：前驱失败 ⇒ 后继被阻断，附原因', () => {
    const tasks = [task('a'), task('b', ['a'], 'hard')];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'failed']])
    );
    expect(skips.get('b')).toContain('a');
    expect(skips.get('b')).toContain('失败');
  });

  it('hard：前驱成功（ok）⇒ 不阻断', () => {
    const tasks = [task('a'), task('b', ['a'], 'hard')];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'ok']])
    );
    expect(skips.size).toBe(0);
  });

  it('传递性：A 失败 ⇒ B（hard）跳过 ⇒ C（hard，依赖 B）亦跳过', () => {
    const tasks = [
      task('a'),
      task('b', ['a'], 'hard'),
      task('c', ['b'], 'hard'),
    ];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'failed']])
    );
    expect(skips.has('b')).toBe(true);
    expect(skips.has('c')).toBe(true);
    expect(skips.get('c')).toContain('传递');
  });

  it('前驱已被标 skipped（非 failed）同样阻断', () => {
    const tasks = [task('a'), task('b', ['a'], 'hard')];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'skipped']])
    );
    expect(skips.has('b')).toBe(true);
  });

  it('引用不存在的前驱 ⇒ 视为满足（与 scheduleTopoBatches 自愈口径一致）', () => {
    const tasks = [task('b', ['ghost'], 'hard')];
    const skips = computeTopoSkips(tasks, new Map());
    expect(skips.size).toBe(0);
  });

  it('前驱尚未执行（状态缺失）⇒ 不阻断', () => {
    const tasks = [task('a'), task('b', ['a'], 'hard')];
    const skips = computeTopoSkips(tasks, new Map());
    expect(skips.size).toBe(0);
  });

  it('任务级 soft 覆盖全局 hard ⇒ 不阻断（opt-out）', () => {
    const tasks = [task('a'), task('b', ['a'], 'soft')];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'failed']]),
      { defaultDependencyMode: 'hard' }
    );
    expect(skips.size).toBe(0);
  });

  it('全局 hard ⇒ 未声明 mode 的任务也阻断（开关翻转路径可用）', () => {
    const tasks = [task('a'), task('b', ['a'])];
    const skips = computeTopoSkips(
      tasks,
      new Map<string, TopoTaskStatus>([['a', 'failed']]),
      { defaultDependencyMode: 'hard' }
    );
    expect(skips.has('b')).toBe(true);
  });

  it('与 scheduleTopoBatches 分批口径兼容：（a→b→c 链）批次为 [a],[b],[c]', () => {
    const tasks = [
      task('a'),
      task('b', ['a'], 'hard'),
      task('c', ['b'], 'hard'),
    ];
    const batches = scheduleTopoBatches(tasks).map((b) => b.map((t) => t.id));
    expect(batches).toEqual([['a'], ['b'], ['c']]);
  });
});
