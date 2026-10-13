/**
 * 债四 S5（T3-5/6/7，2026-10-13）：**USD 口径底座**——**无默认上限值**
 *
 * 覆盖：
 * ① `recordUsdUsage` 累加；非正/非有限值 ⇒ **幂等 no-op**（不落盘不动状态）；
 * ② **USD 不参与闸门判定**：记金额后 Token 口径 `getMode().todayUsed` 仍为 0（USD 闸门未启用）；
 * ③ 跨日**扣回**：`restore` 一份「昨日 + `debtUsd`」⇒ 新的一天 `usedUsd = debtUsd`、`debtUsd = 0`；
 * ④ `reset()` 清 `usedUsd` 但**不清** `debtUsd`（与 `debtTokens` 同约定，防反复 reset 洗透支）；
 * ⑤ **`limitUsd` 无默认值**：未配置 ⇒ `undefined`（**不臆造**，`§12 Q-U3` 未裁定）；显式配置才生效。
 */
import { describe, it, expect } from 'bun:test';
import { DailyBudgetManager } from '../../src/query/DailyBudgetManager.js';

/** 本地自然日字符串（与 `_getToday()` 同口径） */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('债四 S5 USD 口径底座（无默认上限值）', () => {
  it('① 累加：正数生效；0 / 负数 / NaN ⇒ 幂等 no-op', () => {
    const m = new DailyBudgetManager();
    m.recordUsdUsage(0.25);
    m.recordUsdUsage(0.75);
    expect(m.getUsdState().usedUsd).toBeCloseTo(1.0, 10);

    m.recordUsdUsage(0);
    m.recordUsdUsage(-3);
    m.recordUsdUsage(Number.NaN);
    expect(m.getUsdState().usedUsd).toBeCloseTo(1.0, 10);
  });

  it('② USD 不参与闸门判定（Token 口径不受影响）', () => {
    const m = new DailyBudgetManager();
    m.recordUsdUsage(999);
    expect(m.getUsdState().usedUsd).toBe(999);
    // Token 口径仍为 0 ⇒ 未启用 USD 闸门时判定与现状完全一致
    expect(m.getMode().todayUsed).toBe(0);
  });

  it('③ 跨日扣回：昨日欠账计入新的一天用量', () => {
    const m = new DailyBudgetManager();
    m.restore({
      todayUsed: 123,
      date: localDate(-1),
      debt: 7,
      usedUsd: 5.5,
      debtUsd: 2.5,
    });
    const usd = m.getUsdState();
    expect(usd.usedUsd).toBeCloseTo(2.5, 10); // 昨日已用归零、欠账扣回
    expect(usd.debtUsd).toBe(0);
    // token 口径同法（对照，证明两本账对称）
    expect(m.getMode().todayUsed).toBe(7);
  });

  it('④ reset() 清 usedUsd，但不清欠账', () => {
    const m = new DailyBudgetManager();
    m.restore({ todayUsed: 0, date: localDate(), usedUsd: 3, debtUsd: 4 });
    expect(m.getUsdState().usedUsd).toBe(3);
    m.reset();
    const usd = m.getUsdState();
    expect(usd.usedUsd).toBe(0);
    expect(usd.debtUsd).toBe(4);
  });

  it('⑤ limitUsd 无默认值：未配置 ⇒ undefined；显式配置才生效', () => {
    expect(new DailyBudgetManager().getUsdState().limitUsd).toBeUndefined();
    expect(
      new DailyBudgetManager({ limitUsd: 12.5 }).getUsdState().limitUsd
    ).toBe(12.5);
  });
});
