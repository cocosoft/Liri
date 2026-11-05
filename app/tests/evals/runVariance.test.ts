/**
 * P39（2026-11-02）：两次运行可复现性对比（纯函数）。
 *
 * 覆盖：
 * ① 两轮逐题一致 ⇒ `withinTolerance=true`、`stable` 计满；
 * ② 单题差异 ≤ 容差 ⇒ `within_tolerance`（不算 drift）；
 * ③ 单题差异 > 容差 ⇒ 进 `drifted`，但**不单独否决**总体结论（差异需人解释）；
 * ④ 聚合均值相对差 > 容差 ⇒ `withinTolerance=false`；
 * ⑤ 题集不一致 / 空输入 ⇒ 不给"通过"；首轮均值为 0 ⇒ 相对差 `undefined`（不臆造 0%）；
 * ⑥ 噪声次数如实列示（不参与 pass^1，只供解释）。
 */
import { describe, expect, it } from 'bun:test';

import {
  MIN_K_FOR_VARIANCE_GATE,
  checkVarianceSampling,
  compareRunVariance,
  formatRunVariance,
} from '../../src/evals/runVariance';
import type {
  EvalAttempt,
  EvalTask,
  EvalTaskResult,
} from '../../src/evals/types';

/** 用 pass^1 造一条结果（attempts 只为形状完整；噪声数可指定） */
function result(
  taskId: string,
  pass1: number,
  noiseAttempts = 0
): EvalTaskResult {
  const total = 4;
  const passed = Math.round(pass1 * total);
  const attempts: EvalAttempt[] = Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    assertion: { pass: i < passed },
    asExpected: i < passed,
    durationMs: 1,
  }));
  return {
    task: { id: taskId } as unknown as EvalTask,
    attempts,
    assertPassCount: passed,
    pass1,
    passK: pass1 === 1,
    ...(noiseAttempts > 0 ? { environmentNoiseAttempts: noiseAttempts } : {}),
  };
}

describe('P39: compareRunVariance', () => {
  it('两轮逐题一致 ⇒ 通过，全部 stable', () => {
    const report = compareRunVariance(
      [result('t1', 1), result('t2', 0.5)],
      [result('t1', 1), result('t2', 0.5)]
    );
    expect(report.compared).toBe(2);
    expect(report.stable).toBe(2);
    expect(report.drifted).toEqual([]);
    expect(report.relativeDelta).toBe(0);
    expect(report.withinTolerance).toBe(true);
  });

  it('单题差异 ≤ 容差 ⇒ within_tolerance（不算漂移）', () => {
    const report = compareRunVariance(
      [result('t1', 0.5)],
      [result('t1', 0.55)]
    );
    expect(report.tasks[0].taskId).toBe('t1');
    expect(report.tasks[0].status).toBe('within_tolerance');
    expect(report.tasks[0].delta).toBeCloseTo(0.05, 6);
    expect(report.drifted).toEqual([]);
  });

  it('单题差异 > 容差 ⇒ 进 drifted，但总体仍可判"在容差内"', () => {
    const report = compareRunVariance(
      [result('t1', 0.5), result('t2', 0.75), result('t3', 1)],
      [result('t1', 0.5), result('t2', 1), result('t3', 1)]
    );
    expect(report.drifted).toEqual(['t2']);
    // 均值 0.75 → 0.8333…，相对差 11.1% > 10% ⇒ 总体超容差（逐题漂移单列，不单独否决）
    expect(report.withinTolerance).toBe(false);
    expect(report.relativeDelta).toBeGreaterThan(0.1);
  });

  it('聚合相对差 ≤ 容差且无题集差异 ⇒ 通过', () => {
    const report = compareRunVariance(
      [result('t1', 0.75), result('t2', 1)],
      [result('t1', 0.8), result('t2', 1)]
    );
    expect(report.relativeDelta).toBeLessThanOrEqual(0.1);
    expect(report.withinTolerance).toBe(true);
  });

  it('题集不一致 ⇒ 不通过并分列', () => {
    const report = compareRunVariance([result('a', 1)], [result('b', 1)]);
    expect(report.compared).toBe(0);
    expect(report.onlyFirst).toEqual(['a']);
    expect(report.onlySecond).toEqual(['b']);
    expect(report.withinTolerance).toBe(false);
  });

  it('空输入 ⇒ 不判"通过"（无可比对任务）', () => {
    const report = compareRunVariance([], []);
    expect(report.compared).toBe(0);
    expect(report.relativeDelta).toBeUndefined();
    expect(report.withinTolerance).toBe(false);
  });

  it('首轮均值为 0 ⇒ 相对差 undefined（不臆造 0%）', () => {
    const report = compareRunVariance([result('t1', 0)], [result('t1', 0.25)]);
    expect(report.relativeDelta).toBeUndefined();
    expect(report.withinTolerance).toBe(false);
  });

  it('噪声次数如实列示（供解释差异，不参与 pass^1）', () => {
    const report = compareRunVariance(
      [result('t1', 0.5, 2)],
      [result('t1', 0.5, 0)]
    );
    expect(report.tasks[0]).toMatchObject({ firstNoise: 2, secondNoise: 0 });
  });

  it('格式化输出含均值/容差与漂移明细', () => {
    const lines = formatRunVariance(
      compareRunVariance([result('t1', 0.5)], [result('t1', 1)])
    );
    const text = lines.join('\n');
    expect(text).toContain('两次运行');
    expect(text).toContain('t1');
    expect(text).toContain('超出容差');
  });
});

/**
 * P39 采样门槛（2026-11-05）：±10% 门禁要求 k≥8。
 *
 * 依据：同题集 k=4 两轮相对差 15.6%（假失败，单题粒度 25%）、k=8 为 2.2%（达标）。
 * 行为：CLI 在 `--check-variance` 且 k<8 时**拒绝运行**（退出码 2），不再产出噪声结论。
 */
describe('P39 采样门槛：checkVarianceSampling', () => {
  it('k=1 / k=4 不足以支撑门禁，理由里带实测依据与建议值', () => {
    for (const k of [1, 4]) {
      const check = checkVarianceSampling(k);
      expect(check.ok).toBe(false);
      expect(check.reason).toContain('k≥8');
      expect(check.reason).toContain('15.6%');
      expect(check.reason).toContain('--k=8');
    }
  });

  it('k=8 及以上通过（含边界值）', () => {
    expect(checkVarianceSampling(MIN_K_FOR_VARIANCE_GATE).ok).toBe(true);
    expect(checkVarianceSampling(9).ok).toBe(true);
  });

  it('非整数 / 非法值一律拒绝（避免四舍五入后误放行）', () => {
    expect(checkVarianceSampling(7.5).ok).toBe(false);
    expect(checkVarianceSampling(Number.NaN).ok).toBe(false);
  });
});
