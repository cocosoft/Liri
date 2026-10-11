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

/**
 * D1（Spec `daily-budget-unification.md`）：日 Token 限额的**单一事实来源**与**热更新**。
 *
 * 锁定：
 *  - 上限优先级：持久化配置 `costControl.dailyTokenBudget` ＞ env ＞ 常量（非法值逐级回落）。
 *  - 阈值同样来自配置，非法比值回落默认。
 *  - `applyConfig` / `setLimit` 运行时**立即生效**（无需重启），且忽略非法值。
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { getConfigManager } from '@modules/config';
import {
  createDailyBudgetManager,
  resolveDailyBudgetConfig,
  DEFAULT_DAILY_BUDGET_TOKENS,
  type DailyBudgetConfigValue,
} from '../../src/query/DailyBudgetManager';

const CONFIG_KEY = 'costControl.dailyTokenBudget';

describe('resolveDailyBudgetConfig 优先级（D1）', () => {
  let configValue: DailyBudgetConfigValue | undefined;
  let spy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    configValue = undefined;
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
    // `configManager` 是 Proxy（每次 get 都 bind 到实例方法）⇒ 直接 spy 实例方法才能生效
    spy = spyOn(getConfigManager(), 'getConfigValue').mockImplementation(
      (key: string) => (key === CONFIG_KEY ? configValue : undefined) as never
    );
  });
  afterEach(() => {
    spy.mockRestore();
    delete process.env.LIRI_DAILY_BUDGET_TOKENS;
  });

  it('无配置无 env ⇒ 常量上限 + 默认阈值', () => {
    const c = resolveDailyBudgetConfig();
    expect(c.dailyLimit).toBe(DEFAULT_DAILY_BUDGET_TOKENS);
    expect(c.warningThreshold).toBe(0.8);
    expect(c.lockThreshold).toBe(1.0);
  });

  it('env 覆盖常量', () => {
    process.env.LIRI_DAILY_BUDGET_TOKENS = '12345';
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(12345);
  });

  it('持久化配置优先于 env', () => {
    process.env.LIRI_DAILY_BUDGET_TOKENS = '12345';
    configValue = { dailyLimit: 777 };
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(777);
  });

  it('配置上限非法（0/负数/非整数）⇒ 回落 env', () => {
    process.env.LIRI_DAILY_BUDGET_TOKENS = '999';
    configValue = { dailyLimit: 0 };
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(999);
    configValue = { dailyLimit: -5 };
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(999);
    configValue = { dailyLimit: 1.5 };
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(999);
  });

  it('配置上限非法且无 env ⇒ 回落常量', () => {
    configValue = { dailyLimit: 0 };
    expect(resolveDailyBudgetConfig().dailyLimit).toBe(
      DEFAULT_DAILY_BUDGET_TOKENS
    );
  });

  it('阈值取自配置（合法比值）', () => {
    configValue = { warningThreshold: 0.5, lockThreshold: 0.9 };
    const c = resolveDailyBudgetConfig();
    expect(c.warningThreshold).toBe(0.5);
    expect(c.lockThreshold).toBe(0.9);
  });

  it('阈值非法（>1 或 ≤0）⇒ 回落默认', () => {
    configValue = { warningThreshold: 1.5, lockThreshold: 0 };
    const c = resolveDailyBudgetConfig();
    expect(c.warningThreshold).toBe(0.8);
    expect(c.lockThreshold).toBe(1.0);
  });
});

describe('DailyBudgetManager applyConfig/setLimit 热更新（D1）', () => {
  it('setLimit 立即生效：上调上限使 locked ⇒ normal', () => {
    const b = createDailyBudgetManager({ dailyLimit: 1000 });
    b.recordUsage(1200);
    expect(b.getMode().mode).toBe('locked');

    b.setLimit(2000); // 无需重启
    const m = b.getMode();
    expect(m.dailyLimit).toBe(2000);
    expect(m.mode).toBe('normal');
  });

  it('applyConfig 更新阈值并即时反映档位', () => {
    const b = createDailyBudgetManager({
      dailyLimit: 1000,
      warningThreshold: 0.8,
    });
    b.recordUsage(500); // 50% < 80% ⇒ normal
    expect(b.getMode().mode).toBe('normal');

    b.applyConfig({ warningThreshold: 0.4 }); // 50% ≥ 40% ⇒ report_only
    expect(b.getMode().mode).toBe('report_only');
  });

  it('applyConfig 忽略非法值（保留当前值）', () => {
    const b = createDailyBudgetManager({ dailyLimit: 1000 });
    b.applyConfig({ dailyLimit: -5, warningThreshold: 2 });
    expect(b.getMode().dailyLimit).toBe(1000);
    b.recordUsage(900); // 90% ≥ 默认 80% ⇒ report_only（说明阈值未被 2 覆盖）
    expect(b.getMode().mode).toBe('report_only');
  });
});
