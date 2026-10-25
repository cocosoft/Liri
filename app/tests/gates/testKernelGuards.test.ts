// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// `test:kernel` 的两道守卫自证（复审 1-B3）：
//   ① 每组文件数下限（棘轮）—— 防"路径失效/用例被摘"后集合缩水却仍然绿；
//   ② 回路耗时上限 —— 防集合混入重依赖用例后从 20s 静默涨到 60s/120s。
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  KERNEL_LOOP_BUDGET_S,
  KERNEL_SET_MIN_FILES,
  checkSetFloors,
  collectKernelTestFiles,
  isOverBudget,
} from '../../scripts/test-kernel';

describe('test:kernel 守卫 · 每组文件数下限', () => {
  it('低于下限 ⇒ 报出该组；等于/高于下限 ⇒ 通过', () => {
    expect(checkSetFloors([{ dir: 'tests/core', count: 5 }])).toEqual([
      'tests/core: 5 < 下限 32',
    ]);
    expect(checkSetFloors([{ dir: 'tests/core', count: 32 }])).toEqual([]);
    expect(checkSetFloors([{ dir: 'tests/core', count: 99 }])).toEqual([]);
  });

  it('未登记下限的组不判（只约束 KERNEL_TEST_SETS 里的组）', () => {
    expect(checkSetFloors([{ dir: 'tests/unknown', count: 0 }])).toEqual([]);
  });

  it('真实仓库：每组实际命中数 ≥ 登记下限（下限不得高于现实）', () => {
    const { perSet, files } = collectKernelTestFiles(
      join(import.meta.dir, '..', '..')
    );
    expect(checkSetFloors(perSet)).toEqual([]);
    for (const { dir, count } of perSet) {
      expect(count).toBeGreaterThan(0);
      expect(KERNEL_SET_MIN_FILES[dir]).toBeDefined();
    }
    expect(files.length).toBeGreaterThanOrEqual(
      Object.values(KERNEL_SET_MIN_FILES).reduce((a, b) => a + b, 0)
    );
  });
});

describe('test:kernel 守卫 · 耗时预算', () => {
  it('等于预算不算超；超过才判红', () => {
    expect(isOverBudget(60, 60)).toBe(false);
    expect(isOverBudget(60.1, 60)).toBe(true);
    expect(isOverBudget(5, 60)).toBe(false);
  });

  it('预算为正数，且高于 2026-10-25 实测（20.3s）留出余量', () => {
    expect(KERNEL_LOOP_BUDGET_S).toBeGreaterThan(20);
  });
});
