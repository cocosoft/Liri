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
  DEFAULT_DAILY_BUDGET_TOKENS,
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import {
  checkDailyBudget,
  formatBudget,
} from '../../src/query/dailyBudgetGate';

/**
 * G-1 前置 / D-k 接缝：日预算闸门**单一收口** `checkDailyBudget`。
 *
 * 设计依据（Spec §11）：对外结构化字段用与单位无关的命名并携带单位与展示串：
 * `{ used, limit, unit, formatted }`。
 *
 * ⚠️ **2026-10-15 语义变更（用户裁定）**：闸门判定式改为
 * `allowed = !killSwitch && (waiver || 主口径档位 !== 'locked')` —— **Token 轨只观测、不拦**
 * （它不再产生 `report_only`/`locked`）⇒ 本文件原「Token 越界 ⇒ 拒发」两例**已废并被反向钉住**。
 * 金额口径的拒发/放行见 `dailyBudgetUsdGate.test.ts`（S3 契约）。
 */
describe('dailyBudgetGate — 闸门单一收口（G-1 前置 / D-k 接缝）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    // 断言**不依赖开发机 `config.json`**：显式把观测阈值对齐代码常量（单一真源）。
    getDailyBudget().setLimit(DEFAULT_DAILY_BUDGET_TOKENS);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('未超限 ⇒ allowed=true，快照为单位无关形状且 formatted 描述已用量', () => {
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 10 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.unit).toBe('tokens');
    expect(r.snapshot.mode).toBe('normal');
    expect(r.snapshot.formatted).toContain('Tokens');
    expect(r.snapshot.limit).toBe(DEFAULT_DAILY_BUDGET_TOKENS);
  });

  it('**Token 越界 ⇒ 不再拦**（只观测）：allowed=true 且档位恒 normal', () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(100); // 观测阈值已越界（旧实现 ⇒ locked + 拒发）
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 1 });
    expect(r.allowed).toBe(true);
    expect(r.snapshot.mode).toBe('normal');
    // 观测面仍如实可见（越界不隐藏）
    expect(budget.getMode().todayUsed).toBe(100);
  });

  it('**本轮估算将越界 ⇒ 同样不拦**（`estimatedTokens` 仅进观测日志）', () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(50);
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 60 });
    expect(r.snapshot.mode).toBe('normal');
    expect(r.allowed).toBe(true);
  });

  it('`canExecute` / `canSpawnSubAgent` 不因 Token 越界阻断（档位同源）', () => {
    const budget = getDailyBudget();
    budget.setLimit(100);
    budget.recordUsage(1_000_000);
    expect(budget.canExecute('s1')).toBe(true);
    expect(budget.canSpawnSubAgent()).toBe(true);
  });

  it('formatBudget：<1000 原样；≥1000 走 K 且保留 1 位小数（只格式化已用量）', () => {
    expect(formatBudget(999, 'tokens')).toBe('999 Tokens');
    expect(formatBudget(901200, 'tokens')).toBe('901.2 K Tokens');
    expect(formatBudget(1_000, 'tokens')).toBe('1.0 K Tokens');
  });
});
