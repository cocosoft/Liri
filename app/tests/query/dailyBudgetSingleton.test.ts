// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
  recordDailyBudgetFromUsage,
  DEFAULT_DAILY_BUDGET_TOKENS,
} from '../../src/query/DailyBudgetManager';

/**
 * R16（台账 L-14 / Spec `daily-budget-unification.md`）：每日 Token 预算为**进程共享单例**。
 * 锁定：跨调用/跨模块**同一实例** · env 上限覆盖 · 默认常量 · `recordUsage` 累积可见。
 */
describe('getDailyBudget（R16 进程共享单例）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('跨调用为同一实例（闸门与预检共享）', () => {
    expect(getDailyBudget()).toBe(getDailyBudget());
  });

  it('默认上限 = 常量 500_000', () => {
    expect(DEFAULT_DAILY_BUDGET_TOKENS).toBe(500_000);
    expect(getDailyBudget().getMode().dailyLimit).toBe(500_000);
  });

  it('env LIRI_DAILY_BUDGET_TOKENS 覆盖上限（非法值回退常量）', () => {
    process.env.LIRI_DAILY_BUDGET_TOKENS = '12345';
    resetDailyBudgetForTest();
    expect(getDailyBudget().getMode().dailyLimit).toBe(12345);

    process.env.LIRI_DAILY_BUDGET_TOKENS = 'abc';
    resetDailyBudgetForTest();
    expect(getDailyBudget().getMode().dailyLimit).toBe(500_000);
  });

  it('recordUsage 累积并反映到 getMode（80000/500000 = warning）', () => {
    const b = getDailyBudget();
    b.recordUsage(400_000);
    const m = b.getMode();
    expect(m.todayUsed).toBe(400_000);
    expect(m.mode).toBe('report_only');
  });
});

/**
 * R16 **原子预留**（预扣/结算）：闭合 check→record 的 TOCTOU 窗口。
 * 关键安全性质：**无预留时** `projectedUsed === todayUsed`（行为逐一不变）。
 */
describe('DailyBudgetManager 原子预留（R16）', () => {
  beforeEach(() => resetDailyBudgetForTest());
  afterEach(() => resetDailyBudgetForTest());

  it('无预留 ⇒ projectedUsed === todayUsed（行为不变）', () => {
    const b = getDailyBudget();
    b.recordUsage(1_000);
    const m = b.getMode();
    expect(m.projectedUsed).toBe(m.todayUsed);
    expect(m.projectedUsed).toBe(1_000);
  });

  it('预留累加计入 projectedUsed / remaining（并发可见）', () => {
    const b = getDailyBudget();
    b.recordUsage(100_000);
    b.reserveFor('s1', 300_000);
    b.reserveFor('s2', 50_000);
    const m = b.getMode();
    expect(m.todayUsed).toBe(100_000); // 实际不变
    expect(m.projectedUsed).toBe(450_000); // 实际 + 在途
    expect(m.remaining).toBe(50_000);
    expect(m.mode).toBe('report_only'); // 450000/500000
  });

  it('同一会话多次预留累加', () => {
    const b = getDailyBudget();
    b.reserveFor('s1', 1_000);
    const r = b.reserveFor('s1', 2_000);
    expect(r.projected).toBe(3_000);
  });

  it('settle 清在途并**按真实用量**入账（多退少补）', () => {
    const b = getDailyBudget();
    b.reserveFor('s1', 300_000);
    b.settleFor('s1', 120_000); // 真实 < 预留 ⇒ 退还
    const m = b.getMode();
    expect(m.todayUsed).toBe(120_000);
    expect(m.projectedUsed).toBe(120_000); // 在途已清
  });

  it('无预留的 settle ⇒ 等同 recordUsage', () => {
    const b = getDailyBudget();
    b.settleFor('never-reserved', 5_000);
    expect(b.getMode().todayUsed).toBe(5_000);
  });

  it('reserveFor 超额 ⇒ ok=false（含他人在途）', () => {
    const b = getDailyBudget();
    b.reserveFor('s1', 400_000);
    const r = b.reserveFor('s2', 400_000); // 累计 800k > 500k
    expect(r.ok).toBe(false);
    expect(r.projected).toBe(800_000);
  });
});

/**
 * R16 子代理/任务侧记账（`recordDailyBudgetFromUsage`）：非 chat 管线单点记账的统一提取口径。
 */
describe('recordDailyBudgetFromUsage（R16 非 chat 管线记账）', () => {
  beforeEach(() => resetDailyBudgetForTest());
  afterEach(() => resetDailyBudgetForTest());

  it('归一化字段（inputTokens/outputTokens）⇒ 计入 in+out 并返回', () => {
    expect(
      recordDailyBudgetFromUsage({ inputTokens: 100, outputTokens: 20 })
    ).toBe(120);
    expect(getDailyBudget().getMode().todayUsed).toBe(120);
  });

  it('OpenAI 形（prompt_tokens/completion_tokens）⇒ 同样计入', () => {
    expect(
      recordDailyBudgetFromUsage({ prompt_tokens: 7, completion_tokens: 3 })
    ).toBe(10);
    expect(getDailyBudget().getMode().todayUsed).toBe(10);
  });

  it('无 usage / 空对象 ⇒ 返回 0 且不计入', () => {
    expect(recordDailyBudgetFromUsage(undefined)).toBe(0);
    expect(recordDailyBudgetFromUsage({})).toBe(0);
    expect(getDailyBudget().getMode().todayUsed).toBe(0);
  });
});
