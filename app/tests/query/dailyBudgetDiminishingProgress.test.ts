// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-10（2026-10-17）：收益递减判据纳入“新工具结果/新产物”维度。
 */
import { describe, it, expect } from 'bun:test';
import { DailyBudgetManager } from '../../src/query/DailyBudgetManager.js';

function make(): DailyBudgetManager {
  const m = new DailyBudgetManager({
    minTokenDelta: 100,
    diminishingTurnsThreshold: 2,
  });
  m.resetDiminishingReturns(0);
  return m;
}

describe('DailyBudgetManager.checkDiminishingReturns 进展维度', () => {
  it('无进展 + 低 Token 增量 ⇒ 连续两轮触发', () => {
    const m = make();
    expect(m.checkDiminishingReturns(10).diminishing).toBe(false);
    expect(m.checkDiminishingReturns(20).diminishing).toBe(true);
  });

  it('有新工具结果 ⇒ 不计数且重置', () => {
    const m = make();
    expect(m.checkDiminishingReturns(10).diminishing).toBe(false);
    expect(
      m.checkDiminishingReturns(20, undefined, { newToolResults: 1 })
        .diminishing
    ).toBe(false);
    // 上轮已重置 ⇒ 本轮仅第 1 次
    expect(m.checkDiminishingReturns(30).diminishing).toBe(false);
  });

  it('有新产物 ⇒ 不计数', () => {
    const m = make();
    expect(m.checkDiminishingReturns(10).diminishing).toBe(false);
    expect(
      m.checkDiminishingReturns(20, undefined, { newArtifacts: 1 }).diminishing
    ).toBe(false);
  });
});
