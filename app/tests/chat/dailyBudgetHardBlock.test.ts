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

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  applyPreSendProtection,
  type PreSendProtectionParams,
} from '../../src/chat/orchestrator/preSendContextProtection';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

/**
 * R16 **日预算硬阻断**（2026-10-09，用户裁定「超限即拒发」）：
 * 预算耗尽 ⇒ `applyPreSendProtection` **抛** `DAILY_BUDGET_EXCEEDED`（调用方不发起模型请求），
 * 并且必须**释放本轮预扣**（`settleFor(…, 0)`）——不得让在途残留污染后续判定。
 */

const session = {
  id: 'budget-hard-block-session',
} as unknown as PreSendProtectionParams['session'];
const host = {
  truncateApiMessages: async (): Promise<void> => {},
} as unknown as PreSendProtectionParams['host'];
const activeClient = {
  getProviderId: () => 'test-provider',
} as unknown as PreSendProtectionParams['activeClient'];

function params(): PreSendProtectionParams {
  return {
    host,
    apiMessages: [{ role: 'user', content: 'hello' }],
    toolDefinitions: [],
    activeClient,
    // 显式模型 ⇒ resolveEffectiveTurnModel 直接返回，不触 DB/路由
    options: { model: 'test-model' },
    session,
  };
}

describe('applyPreSendProtection — R16 日预算硬阻断', () => {
  beforeEach(() => resetDailyBudgetForTest());
  afterEach(() => resetDailyBudgetForTest());

  it('预算未耗尽 ⇒ 正常返回（不抛错、放行）', async () => {
    const toolsCleared = await applyPreSendProtection(params());
    expect(toolsCleared).toBe(false);
  });

  it('预算耗尽 ⇒ 抛 DAILY_BUDGET_EXCEEDED（拒绝发送）', async () => {
    const budget = getDailyBudget();
    const limit = budget.getMode().dailyLimit;
    expect(limit).toBeGreaterThan(0); // 默认上限 > 0；否则断言前提不成立
    budget.recordUsage(limit + 1);

    let caught: unknown;
    try {
      await applyPreSendProtection(params());
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    const err = caught as { code?: string; message?: string };
    expect(err.code).toBe('DAILY_BUDGET_EXCEEDED');
    expect(String(err.message)).toContain('预算已用完');
  });

  it('预算耗尽 ⇒ 释放本轮预扣（在途归零，projected === todayUsed）', async () => {
    const budget = getDailyBudget();
    const limit = budget.getMode().dailyLimit;
    budget.recordUsage(limit + 1);
    const todayUsed = budget.getMode().todayUsed;

    await expect(applyPreSendProtection(params())).rejects.toThrow();

    const after = budget.getMode();
    expect(after.projectedUsed).toBe(after.todayUsed);
    expect(after.todayUsed).toBe(todayUsed);
  });
});
