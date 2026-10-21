/**
 * 多租户 P5：成本累计**按身份分桶**（读侧不再跨身份聚合）
 *
 * 背景：`/v1/analytics/dashboard`、`/v1/workspaces/:id/cost/report` 直接读
 * `costTracker` 的**进程级内存累计**。改造前那是"全进程所有人"的数字 ⇒ 任一已登录
 * 用户都能看到别人的用量。现累计值按 `principalKeyOf(principal)` 分桶：
 * - 本地身份（桌面 / CLI / cron）恒 `local:local` 一个桶 ⇒ 行为与改造前逐字一致；
 * - 已认证身份各自一桶 ⇒ 读侧自动裁剪。
 */
import { describe, it, expect } from 'bun:test';

import { CostTracker } from '../../src/cost/CostTracker.js';
import { runWithPrincipal } from '../../src/core/identity/requestScope.js';
import type { Principal } from '../../src/core/identity/principal.js';

const ALICE: Principal = { tenantId: 'acme', userId: 'alice', roles: ['user'] };
const BOB: Principal = { tenantId: 'other', userId: 'bob', roles: ['user'] };

describe('CostTracker：累计值按身份分桶', () => {
  it('A 的调用不出现在 B 的读数里（Token / 模型用量 / 成本）', () => {
    const tracker = new CostTracker();

    runWithPrincipal(ALICE, () => {
      tracker.addCost('gpt-4o', 100, 50);
    });

    const aliceUsage = runWithPrincipal(ALICE, () =>
      tracker.getUsageForModel('gpt-4o')
    );
    expect(aliceUsage?.requestCount).toBe(1);
    expect(aliceUsage?.inputTokens).toBe(100);
    expect(runWithPrincipal(ALICE, () => tracker.getTotalInputTokens())).toBe(
      100
    );

    expect(runWithPrincipal(BOB, () => tracker.getModelUsage())).toEqual({});
    expect(runWithPrincipal(BOB, () => tracker.getTotalInputTokens())).toBe(0);
    expect(runWithPrincipal(BOB, () => tracker.getTotalCostUSD())).toBe(0);
  });

  it('本地身份仍是单桶（同一桶内累加，与改造前等价）', () => {
    const tracker = new CostTracker();

    tracker.addCost('gpt-4o', 100, 50);
    tracker.addCost('gpt-4o', 10, 5);

    expect(tracker.getUsageForModel('gpt-4o')?.requestCount).toBe(2);
    expect(tracker.getTotalInputTokens()).toBe(110);
    expect(tracker.getTotalOutputTokens()).toBe(55);
  });

  it('reset 清空所有桶（语义是"从头计量"，不是"只清自己"）', () => {
    const tracker = new CostTracker();
    runWithPrincipal(ALICE, () => tracker.addCost('gpt-4o', 10, 5));
    tracker.addCost('gpt-4o', 10, 5);

    tracker.reset();

    expect(runWithPrincipal(ALICE, () => tracker.getTotalInputTokens())).toBe(
      0
    );
    expect(tracker.getTotalInputTokens()).toBe(0);
    expect(tracker.getModelUsage()).toEqual({});
  });

  it('成本报告只反映当前身份（formatCostReport 不含他人累计）', () => {
    const tracker = new CostTracker();
    runWithPrincipal(ALICE, () => tracker.addCost('gpt-4o', 1_000_000, 0));

    const bobReport = runWithPrincipal(BOB, () =>
      tracker.formatCostReport(false)
    );
    expect(bobReport).toContain('总输入令牌: 0');
  });
});
