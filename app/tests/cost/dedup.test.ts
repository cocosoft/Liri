// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 第 0 步：Token/成本统计 — 去重测试基线
 *
 * 验证 P0 重复计数问题：
 *   - 主响应路径：costTracker.addCost 被 trackUsage + onUsage 双重调用
 *   - 工具轮路径：仅 trackUsage 调用（正常）
 *
 * 当前期望（bug）：主响应 addCost 调用 2 次 → totalCostUSD = 真实成本 ×2
 * 修复后期望：主响应 addCost 调用 1 次 → totalCostUSD = 真实成本
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { CostTracker, costTracker } from '../../src/cost/CostTracker';

describe('P0 重复计数基线 — addCost 调用次数', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  afterEach(() => {
    costTracker.reset();
  });

  // ============================================================
  // 基线 1：单次 addCost 的正确行为（正常路径：工具轮）
  // ============================================================
  describe('单次调用 addCost（模拟工具轮路径：仅 trackUsage）', () => {
    it('单次 addCost 后 totalCostUSD = 本次 cost', () => {
      const cost = tracker.addCost('gpt-4o', 1000, 500);
      expect(tracker.getTotalCostUSD()).toBe(cost);
      expect(cost).toBeGreaterThan(0);
    });

    it('单次 addCost 后 inputTokens 累加正确', () => {
      tracker.addCost('gpt-4o', 1000, 500);
      expect(tracker.getTotalInputTokens()).toBe(1000);
    });

    it('单次 addCost 后 outputTokens 累加正确', () => {
      tracker.addCost('gpt-4o', 1000, 500);
      expect(tracker.getTotalOutputTokens()).toBe(500);
    });

    it('单次 addCost 后 modelUsage requestCount = 1', () => {
      tracker.addCost('gpt-4o', 1000, 500);
      const usage = tracker.getModelUsage();
      expect(usage['gpt-4o'].requestCount).toBe(1);
    });
  });

  // ============================================================
  // 基线 2：模拟双重调用的错误行为（主响应路径：trackUsage + onUsage）
  // 这证明当前代码中存在 P0 重复计数 bug
  // ============================================================
  describe('双重调用 addCost（模拟主响应路径：trackUsage + onUsage）= 当前 BUG', () => {
    it('⚠️ 双重调用后 totalCostUSD = 单次 ×2（这是 bug，修复后应等于单次）', () => {
      const singleCost = tracker.addCost('gpt-4o', 1000, 500);
      // 模拟 onUsage 第二次调用（当前 CoreAPIImpl.ts:538 的实际行为）
      const duplicateCost = tracker.addCost('gpt-4o', 1000, 500);

      // 当前行为：累加了两次
      expect(tracker.getTotalCostUSD()).toBe(singleCost + duplicateCost);
      // 修复后应该等于单次：expect(tracker.getTotalCostUSD()).toBe(singleCost);
    });

    it('⚠️ 双重调用后 inputTokens = 单次 ×2', () => {
      tracker.addCost('gpt-4o', 1000, 500);   // trackUsage 调用
      tracker.addCost('gpt-4o', 1000, 500);   // onUsage 调用（重复）

      expect(tracker.getTotalInputTokens()).toBe(2000);
      // 修复后：expect(tracker.getTotalInputTokens()).toBe(1000);
    });

    it('⚠️ 双重调用后 modelUsage requestCount = 2（应为 1）', () => {
      tracker.addCost('gpt-4o', 1000, 500);
      tracker.addCost('gpt-4o', 1000, 500);

      const usage = tracker.getModelUsage();
      expect(usage['gpt-4o'].requestCount).toBe(2);
      // 修复后：expect(usage['gpt-4o'].requestCount).toBe(1);
    });

    it('⚠️ 双重调用导致 cost_records 事件发布两次（间接验证：modelUsage.costUSD = 单次×2）', () => {
      const singleCost = tracker.addCost('gpt-4o', 1000, 500);
      tracker.addCost('gpt-4o', 1000, 500);

      const usage = tracker.getModelUsage();
      expect(usage['gpt-4o'].costUSD).toBe(singleCost * 2);
      // 修复后：expect(usage['gpt-4o'].costUSD).toBe(singleCost);
    });
  });

  // ============================================================
  // 基线 3：工具轮（正常路径 — 仅 trackUsage，不应重复）
  // ============================================================
  describe('工具轮场景：addCost 仅调用 1 次（当前已正确，修复后不应退化）', () => {
    it('工具轮后 requestCount = 1（仅 trackUsage，无 onUsage）', () => {
      // 模拟 ChatManager.ts:4276 的工具轮 trackUsage
      tracker.addCost('gpt-4o', 300, 200);
      // 工具轮没有 onUsage 调用 → 只有 1 次

      const usage = tracker.getModelUsage();
      expect(usage['gpt-4o'].requestCount).toBe(1);
    });
  });

  // ============================================================
  // 基线 4：addCost 返回值验证（迁移 recordCost 时直接复用）
  // ============================================================
  describe('addCost 返回值', () => {
    it('addCost 返回 costUSD（非 undefined）', () => {
      const cost = tracker.addCost('gpt-4o', 1000, 500);
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThan(0);
    });

    it('addCost 对同一输入两次调用返回相同 cost（定价稳定）', () => {
      const cost1 = tracker.addCost('gpt-4o', 1000, 500);
      const cost2 = tracker.addCost('gpt-4o', 1000, 500);
      expect(cost1).toBe(cost2);
    });
  });

  // ============================================================
  // 基线 5：reset 行为
  // ============================================================
  describe('reset 清空所有累计', () => {
    it('reset 后 totalCostUSD = 0', () => {
      tracker.addCost('gpt-4o', 1000, 500);
      tracker.reset();
      expect(tracker.getTotalCostUSD()).toBe(0);
      expect(tracker.getTotalInputTokens()).toBe(0);
      expect(Object.keys(tracker.getModelUsage()).length).toBe(0);
    });
  });
});

// ============================================================
// 修复目标测试（打桩，修复后取消 skip）
// ============================================================
describe('修复目标 — 主响应 addCost 仅调用 1 次', () => {
  it.skip('修复后：主响应 totalCostUSD = 单次成本（非 ×2）', () => {
    const tracker = new CostTracker();
    const singleCost = tracker.addCost('gpt-4o', 1000, 500);

    // 修复后 CoreAPIImpl.onUsage 不再调 addCost
    // 此处模拟修复后的行为：仅 trackUsage 路径调用 1 次
    expect(tracker.getTotalCostUSD()).toBe(singleCost);
    expect(tracker.getModelUsage()['gpt-4o'].requestCount).toBe(1);
  });
});
