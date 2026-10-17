// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * T3-7（2026-10-17，用户裁定「改为事务预检」）：
 * `waive-once` 放行前用价表估算金额并预占 pending debt；实际落账时替换估计值。
 */
import { describe, it, expect } from 'bun:test';
import { DailyBudgetManager } from '../../src/query/DailyBudgetManager.js';

describe('DailyBudgetManager.preAuthorizeWaiverUsd', () => {
  it('已配置 USD 上限 ⇒ 预占 debtUsd', () => {
    const m = new DailyBudgetManager({ limitUsd: 1 });
    const r = m.preAuthorizeWaiverUsd('s1', 0.25);
    expect(r.ok).toBe(true);
    expect(r.reservedUsd).toBe(0.25);
    expect(m.getUsdState().debtUsd).toBeCloseTo(0.25, 6);
  });

  it('未配置 USD 上限 ⇒ 不预占', () => {
    const m = new DailyBudgetManager();
    const r = m.preAuthorizeWaiverUsd('s1', 0.25);
    expect(r.reservedUsd).toBe(0);
    expect(m.getUsdState().debtUsd).toBe(0);
  });

  it('估算为 0（免费/本地模型）⇒ 不预占', () => {
    const m = new DailyBudgetManager({ limitUsd: 1 });
    expect(m.preAuthorizeWaiverUsd('s1', 0).reservedUsd).toBe(0);
    expect(m.getUsdState().debtUsd).toBe(0);
  });

  it('实际落账 ⇒ 用实际金额替换估计（不做双记）', () => {
    const m = new DailyBudgetManager({ limitUsd: 1 });
    m.preAuthorizeWaiverUsd('s1', 0.25);
    m.recordUsdUsage(0.4, 's1');
    expect(m.getUsdState().debtUsd).toBeCloseTo(0.4, 6);
    expect(m.getUsdState().usedUsd).toBeCloseTo(0.4, 6);
  });

  it('同会话重复预检 ⇒ 替换而非累加', () => {
    const m = new DailyBudgetManager({ limitUsd: 1 });
    m.preAuthorizeWaiverUsd('s1', 0.25);
    m.preAuthorizeWaiverUsd('s1', 0.3);
    expect(m.getUsdState().debtUsd).toBeCloseTo(0.3, 6);
  });
});
