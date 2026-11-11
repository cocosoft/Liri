// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-11：会话级用量累计（`metadata.totalTokens/totalCost`）。
 *
 * 真机缺陷：`recordChatResponseUsage` 只记预算与金额台账，从不回写会话元数据
 * ⇒ 所有会话恒为 `totalTokens: 0 / totalCost: 0`。本用例锁定累加与边界。
 */
import { describe, expect, it } from 'bun:test';
import { addSessionUsageTotals } from '../../src/chat/manager/usageAccounting';

describe('addSessionUsageTotals', () => {
  it('从 0 起算并累加 token 与金额', () => {
    const first = addSessionUsageTotals({}, 120, 0.0012);
    expect(first).toEqual({ totalTokens: 120, totalCost: 0.0012 });

    const second = addSessionUsageTotals(
      { totalTokens: first.totalTokens, totalCost: first.totalCost },
      80,
      0.0008
    );
    expect(second).toEqual({ totalTokens: 200, totalCost: 0.002 });
  });

  it('金额保留 6 位小数，避免浮点噪声', () => {
    const out = addSessionUsageTotals({ totalCost: 0.1 }, 0, 0.2);
    expect(out.totalCost).toBe(0.3);
  });

  it('token 取整；非法历史值按 0 起算', () => {
    const out = addSessionUsageTotals(
      { totalTokens: 'oops', totalCost: null },
      12.6,
      0.000001
    );
    expect(out.totalTokens).toBe(13);
    expect(out.totalCost).toBe(0.000001);
  });
});
