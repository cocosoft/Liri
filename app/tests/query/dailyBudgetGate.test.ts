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
} from '../../src/query/DailyBudgetManager';
import {
  checkDailyBudget,
  formatBudget,
} from '../../src/query/dailyBudgetGate';

/**
 * G-1 前置 / D-k 接缝：日预算闸门**单一收口** `checkDailyBudget` + 单位无关快照。
 *
 * 设计依据（Spec §11）：对外结构化字段用与单位无关的命名并携带单位与展示串：
 * `{ used, limit, unit, formatted }` —— 专项切 USD 时只换 `unit`/`formatted`/折算逻辑。
 */
describe('dailyBudgetGate — 闸门单一收口（G-1 前置 / D-k 接缝）', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
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
    expect(r.snapshot.limit).toBe(500_000);
  });

  it('used 达上限 ⇒ allowed=false 且 mode=locked', () => {
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(100);
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 1 });
    expect(r.allowed).toBe(false);
    expect(r.snapshot.mode).toBe('locked');
    expect(r.snapshot.used).toBe(100);
    expect(r.snapshot.limit).toBe(100);
  });

  it('尚未 locked 但本轮估算将越界 ⇒ allowed=false（自含估算）', () => {
    getDailyBudget().setLimit(100);
    getDailyBudget().recordUsage(50); // 50% ⇒ mode=normal（未达 warning 0.8）
    const r = checkDailyBudget({ sessionId: 's1', estimatedTokens: 60 });
    expect(r.snapshot.mode).toBe('normal');
    expect(r.allowed).toBe(false); // 50 + 60 >= 100 ⇒ 拒发
  });

  it('formatBudget：<1000 原样；≥1000 走 K 且保留 1 位小数（只格式化已用量）', () => {
    expect(formatBudget(999, 'tokens')).toBe('999 Tokens');
    expect(formatBudget(901200, 'tokens')).toBe('901.2 K Tokens');
    expect(formatBudget(1_000, 'tokens')).toBe('1.0 K Tokens');
  });
});
