// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Token/成本统计 — 去重语义与接线守卫
 *
 * 背景：主响应路径曾同时经 `trackUsage` 与 `onUsage` 调 `costTracker.addCost` ⇒ 成本 ×2。
 * v1.2 起成本统计收敛到 `UsageTracker.trackUsage` 唯一入口（`CoreAPIImpl.onUsage` 不再直连
 * tracker）⇒ 本文件锁定两件事：
 *   ① `CostTracker.addCost` 是**非幂等**累加（幂等由接线层的唯一入口保证，不在 tracker 内做）；
 *   ② 接线守卫：`CoreAPIImpl` 内不得再出现 `costTracker.addCost(...)` 调用（回归即失败）。
 *
 * 台账：`dev_docs/error_repairs/预存错误与待处理问题.md`（R8 跳过登记项的验收占位，已收口）。
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CostTracker, costTracker } from '../../src/cost/CostTracker';

describe('CostTracker.addCost — 单次调用语义', () => {
  let tracker: CostTracker;

  afterEach(() => {
    tracker?.reset();
    costTracker.reset();
  });

  it('单次 addCost 后 totalCostUSD = 本次 cost（且 > 0）', () => {
    tracker = new CostTracker();
    const cost = tracker.addCost('gpt-4o', 1000, 500);
    expect(tracker.getTotalCostUSD()).toBe(cost);
    expect(cost).toBeGreaterThan(0);
  });

  it('单次 addCost 后 input/output tokens 累加正确', () => {
    tracker = new CostTracker();
    tracker.addCost('gpt-4o', 1000, 500);
    expect(tracker.getTotalInputTokens()).toBe(1000);
    expect(tracker.getTotalOutputTokens()).toBe(500);
  });

  it('单次 addCost 后 modelUsage requestCount = 1', () => {
    tracker = new CostTracker();
    tracker.addCost('gpt-4o', 1000, 500);
    expect(tracker.getModelUsage()['gpt-4o'].requestCount).toBe(1);
  });

  it('多次调用累加（工具轮 + 主响应各自一次 ⇒ 两次都是真实请求）', () => {
    tracker = new CostTracker();
    tracker.addCost('gpt-4o', 300, 200);
    tracker.addCost('gpt-4o', 1000, 500);
    expect(tracker.getModelUsage()['gpt-4o'].requestCount).toBe(2);
    expect(tracker.getTotalInputTokens()).toBe(1300);
  });

  it('addCost 返回 costUSD（数值，定价稳定 ⇒ 同输入同返回）', () => {
    tracker = new CostTracker();
    const cost1 = tracker.addCost('gpt-4o', 1000, 500);
    const cost2 = tracker.addCost('gpt-4o', 1000, 500);
    expect(typeof cost1).toBe('number');
    expect(cost1).toBeGreaterThan(0);
    expect(cost2).toBe(cost1);
  });

  it('reset 清空所有累计', () => {
    tracker = new CostTracker();
    tracker.addCost('gpt-4o', 1000, 500);
    tracker.reset();
    expect(tracker.getTotalCostUSD()).toBe(0);
    expect(tracker.getTotalInputTokens()).toBe(0);
    expect(Object.keys(tracker.getModelUsage()).length).toBe(0);
  });
});

describe('CostTracker.addCost — 不做幂等（重复调用即重复累加）', () => {
  let tracker: CostTracker;

  afterEach(() => {
    tracker?.reset();
  });

  it('同一请求被记两次 ⇒ 成本与 tokens 都翻倍', () => {
    tracker = new CostTracker();
    const single = tracker.addCost('gpt-4o', 1000, 500);
    tracker.addCost('gpt-4o', 1000, 500);

    expect(tracker.getTotalCostUSD()).toBe(single * 2);
    expect(tracker.getTotalInputTokens()).toBe(2000);
    expect(tracker.getModelUsage()['gpt-4o'].requestCount).toBe(2);
  });

  it('语义边界：幂等责任在**接线层**（唯一入口），不在 tracker 内', () => {
    // 若将来有人把"去重"塞进 CostTracker（按模型+token 去重），本用例会先失败 ——
    // 那会把"两次真实请求"也误合并；正确的做法是保持唯一记账入口。
    tracker = new CostTracker();
    tracker.addCost('gpt-4o', 1000, 500);
    tracker.addCost('gpt-4o', 1000, 500);
    expect(tracker.getModelUsage()['gpt-4o'].requestCount).toBe(2);
  });
});

describe('接线守卫 — 主响应只有一条记账路径', () => {
  const source = readFileSync(
    join(__dirname, '..', '..', 'src', 'runtime', 'api', 'CoreAPIImpl.ts'),
    'utf-8'
  );

  it('`CoreAPIImpl` 内不得调用 `costTracker.addCost(...)`（v1.2 已收敛到 UsageTracker）', () => {
    expect(source).not.toContain('costTracker.addCost(');
  });
});
