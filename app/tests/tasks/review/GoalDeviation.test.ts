/**
 * GoalDeviation 目标偏差判定测试（T-②02，2026-10-03）
 *
 * 判据：turn 预算消耗速率 ratio = actual / expected，阈值复用既有 `UNIFIED_THRESHOLDS`
 * （WARNING = 0.75 / CRITICAL = 0.92，零新增常量）。纯函数，覆盖阈值与边界。
 */
import { describe, test, expect } from 'bun:test';
import { evaluateGoalDeviation } from '../../../src/tasks/review/GoalDeviation';
import { UNIFIED_THRESHOLDS } from '@modules/tokenBudget/BudgetPolicy';

describe('evaluateGoalDeviation（纯函数：turn 预算消耗速率）', () => {
  test('阈值分层来自既有 UNIFIED_THRESHOLDS（防空跑假绿）', () => {
    expect(UNIFIED_THRESHOLDS.WARNING).toBe(0.75);
    expect(UNIFIED_THRESHOLDS.CRITICAL).toBe(0.92);
  });

  test('空样本 ⇒ 无发现', () => {
    expect(evaluateGoalDeviation([])).toEqual([]);
  });

  test('无预算（null / 0 / 负 / 非有限）⇒ 跳过，不臆造分母', () => {
    const findings = evaluateGoalDeviation([
      { stage: 'a', expected: null, actual: 999 },
      { stage: 'b', expected: 0, actual: 999 },
      { stage: 'c', expected: -5, actual: 999 },
      { stage: 'd', expected: Number.NaN, actual: 999 },
      { stage: 'e', expected: Number.POSITIVE_INFINITY, actual: 999 },
    ]);
    expect(findings).toEqual([]);
  });

  test('actual 非有限 ⇒ 跳过（数据异常不臆测）', () => {
    expect(
      evaluateGoalDeviation([{ stage: 'a', expected: 10, actual: Number.NaN }])
    ).toEqual([]);
  });

  test('ratio < WARNING ⇒ 不产出（正常范围不告警）', () => {
    expect(
      evaluateGoalDeviation([{ stage: 'a', expected: 10, actual: 7 }])
    ).toEqual([]);
  });

  test('ratio 恰达 WARNING(0.75) ⇒ warning（边界含等号）', () => {
    expect(
      evaluateGoalDeviation([{ stage: 'a', expected: 100, actual: 75 }])
    ).toEqual([
      {
        stage: 'a',
        expected: 100,
        actual: 75,
        ratio: 0.75,
        severity: 'warning',
      },
    ]);
  });

  test('ratio ∈ [WARNING, CRITICAL) ⇒ warning', () => {
    const findings = evaluateGoalDeviation([
      { stage: 'a', expected: 100, actual: 91 },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].ratio).toBeCloseTo(0.91, 6);
  });

  test('ratio 恰达 CRITICAL(0.92) ⇒ critical（边界含等号）', () => {
    const findings = evaluateGoalDeviation([
      { stage: 'a', expected: 100, actual: 92 },
    ]);
    expect(findings[0].severity).toBe('critical');
  });

  test('ratio > 1（超预算）⇒ critical', () => {
    const findings = evaluateGoalDeviation([
      { stage: 'a', expected: 10, actual: 30 },
    ]);
    expect(findings[0]).toMatchObject({
      expected: 10,
      actual: 30,
      severity: 'critical',
    });
    expect(findings[0].ratio).toBe(3);
  });

  test('多阶段混合 ⇒ 只产出越阈值项，且保持输入顺序', () => {
    const findings = evaluateGoalDeviation([
      { stage: 'ok', expected: 100, actual: 10 },
      { stage: 'warn', expected: 100, actual: 80 },
      { stage: 'no-budget', expected: null, actual: 500 },
      { stage: 'crit', expected: 100, actual: 95 },
    ]);
    expect(findings.map((f) => f.stage)).toEqual(['warn', 'crit']);
    expect(findings.map((f) => f.severity)).toEqual(['warning', 'critical']);
  });
});
