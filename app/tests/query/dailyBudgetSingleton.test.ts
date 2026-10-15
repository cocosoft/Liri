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

  it('默认阈值：常量与类内默认配置单源（= 30_000_000，2026-10-15 重设为观测阈值）', () => {
    // 2026-10-13 裁定：常量与 `DEFAULT_CONFIG.dailyLimit` 统一为同一值（此前 500_000 vs 1_000_000 分裂）。
    // 2026-10-15 重设：Token 轨**只观测、不拦**（用户裁定）⇒ 该值不再是额度，只是告警线；
    // 按 58 天历史分布取 p90 整数值 30_000_000（原 1_000_000 低于除 1 天外所有日子 ⇒ 天天告警）。
    expect(DEFAULT_DAILY_BUDGET_TOKENS).toBe(30_000_000);
    // 运行期生效阈值来自「持久化配置 ＞ env ＞ 常量」解析（含本机持久化配置）⇒ 一律**从解析结果派生**，
    // 不硬编码数值（解析顺序由 `dailyBudgetConfig.test.ts` 的 fresh 实例用例覆盖）。
    expect(getDailyBudget().getMode().dailyLimit).toBeGreaterThan(0);
  });

  it('recordUsage 累积并反映到 getMode（todayUsed 可见；**Token 不产档位**）', () => {
    const b = getDailyBudget();
    b.recordUsage(400_000);
    const m = b.getMode();
    expect(m.todayUsed).toBe(400_000);
    // Token 轨只观测（用户 2026-10-15 裁定）⇒ 档位恒 normal（档位只由 USD 口径 / kill-switch 产出）
    expect(m.mode).toBe('normal');
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
    // remaining/上限同为**解析结果派生**（本机持久化配置与 CI 默认可能不同）⇒ 不硬编码数值
    expect(m.remaining).toBe(m.dailyLimit - m.projectedUsed);
    // Token 口径**不产档位**（用户 2026-10-15 裁定）⇒ 恒 normal（档位只由 USD / kill-switch 产出）
    expect(m.mode).toBe('normal');
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
    // 显式设定上限（不依赖开发机 config.json 的 Token 基座）
    b.setLimit(1000);
    const r1 = b.reserveFor('s1', 400);
    const r2 = b.reserveFor('s2', 400); // 累计 800 < 1000 ⇒ 仍在限内
    expect(r2.ok).toBe(true);
    const r3 = b.reserveFor('s3', 400); // 累计 1200 > 1000 ⇒ 越界
    expect(r3.ok).toBe(false);
    expect(r3.projected).toBe(1_200);
    expect(r1.projected).toBe(400);
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
