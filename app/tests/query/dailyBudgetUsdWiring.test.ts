/**
 * 债四「**换算接线**」（2026-10-13）：把「单轮真实用量 + 本轮模型 ⇒ 金额」接到 USD 台账。
 *
 * 上游切片：S1/S2（core 换算内核 + query 取价适配器，证据 `DEBT4-S1S2`）与 S5（USD 底座
 * `recordUsdUsage`，证据 `DEBT4-S5-USD-BASE`）——本片让 `recordUsdUsage` 获得**生产消费者**。
 *
 * 覆盖：
 * ① `recordTurnCostUsd(parts, model, sid)` ⇒ `usedUsd` 按**与计费链同源**的公式增长；
 * ② **闸门不动**：同一轮里 Token 口径（`getMode().todayUsed`）**不因金额记账而改变**；
 * ③ **模型名不可得 / `'unknown'` 占位** ⇒ **不入账、不取兜底价**（不臆造金额）；
 * ④ 四参形状（Q-U4）：**缓存用量纳入**（同 tokens 下带 cache 的金额 > 不带）；
 * ⑤ `recordDailyBudgetFromUsage(usage, sid, model)` 同时记 token 与金额；缺 `model` ⇒ 只记 token；
 * ⑥ 金额 ≤ 0（0 tokens）⇒ 幂等 no-op（`usedUsd` 不变）。
 *
 * ⚠️ 未登记模型在本测试中**走兜底价**（无 SPI 装配 ⇒ `resolveAiAccess()` 为 no-op 代理）⇒
 * 断言用 `DEFAULT_MODEL_PRICING` 公式对照；**已知模型的取价正确性**由既有
 * `tests/query/modelPricingAdapter.test.ts`（S2）覆盖，不在本文件重复。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  getDailyBudget,
  recordDailyBudgetFromUsage,
  recordTurnCostUsd,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager.js';
import {
  calculateTotalCost,
  DEFAULT_MODEL_PRICING,
} from '../../src/core/pricing.js';

const MODEL = 'test-model-not-registered'; // 未登记 ⇒ 走兜底价（如实标注 unknownModel）

beforeEach(() => {
  resetDailyBudgetForTest();
});
afterEach(() => {
  resetDailyBudgetForTest();
});

describe('债四「换算接线」：用量 + 模型 ⇒ 金额入账', () => {
  it('① 记金额：usedUsd 增长，且等于 core calculateTotalCost（同源公式）', () => {
    const budget = getDailyBudget();
    const before = budget.getUsdState().usedUsd;

    const costUsd = recordTurnCostUsd(
      { inputTokens: 1000, outputTokens: 500 },
      MODEL,
      'sess-1'
    );

    const expected = calculateTotalCost(DEFAULT_MODEL_PRICING, 1000, 500, 0, 0);
    expect(costUsd).toBeCloseTo(expected, 10);
    expect(costUsd).toBeGreaterThan(0);
    expect(budget.getUsdState().usedUsd).toBeCloseTo(before + expected, 10);
  });

  it('② 闸门不动：金额记账**不改变** Token 口径（USD 闸门 = S3，未启用）', () => {
    const budget = getDailyBudget();
    const modeBefore = budget.getMode();

    recordTurnCostUsd(
      { inputTokens: 10_000, outputTokens: 2_000 },
      MODEL,
      'sess-1'
    );

    expect(budget.getUsdState().usedUsd).toBeGreaterThan(0);
    const modeAfter = budget.getMode();
    expect(modeAfter.todayUsed).toBe(modeBefore.todayUsed); // token 口径零变化
    expect(modeAfter.mode).toBe(modeBefore.mode); // 档位零变化（不被金额影响）
  });

  it('③ 模型名不可得 / `unknown` 占位 ⇒ 不入账（不取兜底价、不臆造金额）', () => {
    const budget = getDailyBudget();

    expect(
      recordTurnCostUsd(
        { inputTokens: 1000, outputTokens: 500 },
        undefined,
        's1'
      )
    ).toBe(0);
    expect(
      recordTurnCostUsd(
        { inputTokens: 1000, outputTokens: 500 },
        'unknown',
        's1'
      )
    ).toBe(0);
    expect(
      recordTurnCostUsd({ inputTokens: 1000, outputTokens: 500 }, '', 's1')
    ).toBe(0);

    expect(budget.getUsdState().usedUsd).toBe(0);
  });

  it('④ 缓存用量**纳入**折算（Q-U4 四参形状）：带 cache 的金额更高', () => {
    const budget = getDailyBudget();
    const base = { inputTokens: 1000, outputTokens: 100 };

    const plain = recordTurnCostUsd(base, MODEL, 's1');
    const withCache = recordTurnCostUsd(
      { ...base, cacheReadTokens: 5000, cacheCreationTokens: 2000 },
      MODEL,
      's1'
    );

    expect(withCache).toBeGreaterThan(plain);
    expect(budget.getUsdState().usedUsd).toBeCloseTo(plain + withCache, 10);
  });

  it('⑤ recordDailyBudgetFromUsage：有 model ⇒ token 与金额**两本账都记**；缺 model ⇒ 只记 token', () => {
    const budget = getDailyBudget();

    const tokens = recordDailyBudgetFromUsage(
      { prompt_tokens: 800, completion_tokens: 200 },
      's1',
      MODEL
    );
    expect(tokens).toBe(1000);
    expect(budget.getMode().todayUsed).toBe(1000);
    expect(budget.getUsdState().usedUsd).toBeGreaterThan(0);

    const usdAfterModel = budget.getUsdState().usedUsd;
    const tokens2 = recordDailyBudgetFromUsage(
      { prompt_tokens: 400, completion_tokens: 100 },
      's1'
    );
    expect(tokens2).toBe(500);
    expect(budget.getMode().todayUsed).toBe(1500); // token 照记
    expect(budget.getUsdState().usedUsd).toBeCloseTo(usdAfterModel, 10); // 金额未记（缺模型）
  });

  it('⑥ 0 tokens ⇒ 金额为 0 ⇒ 幂等 no-op（usedUsd 不变）', () => {
    const budget = getDailyBudget();
    expect(
      recordTurnCostUsd({ inputTokens: 0, outputTokens: 0 }, MODEL, 's1')
    ).toBe(0);
    expect(budget.getUsdState().usedUsd).toBe(0);
  });
});
