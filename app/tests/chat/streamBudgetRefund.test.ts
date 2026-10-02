/**
 * 流式 token 预算：**对称记账**回归（2026-09-26 修「为什么还会提前终止」的根因）。
 *
 * **缺陷**：`createStreamBudget` 把 `total` 设为**模型上下文窗口**，却按"累积增长量"单向记账
 * （`compact 回落后不退款`）⇒ 累计量必然逼近 `UNIFIED_THRESHOLDS.CRITICAL`(0.92) ⇒
 * **长任务在某一轮被硬停**，与 compaction"压缩后让长会话继续"的目的自相矛盾。
 * 实测证据：`app.log` 中 `reActLoop:budget_exhausted meta:{maxIterations:200,iteration:72}`
 * —— **72/200 就被掐断**。
 *
 * **修法**：`chargeContextEstimate` 改为对称记账（增长 `consumeTokens` / 回落 `releaseTokens`）
 * ⇒ `spent` 恒等于**当前上下文占用** ⇒ 阈值语义变为"当前上下文接近窗口才硬停"。
 *
 * 本用例的**分水岭**在第 ③ 步：模拟"增长→压缩→再增长"，
 * 旧实现（只增不退）在第二次增长时累计已 ~150% ⇒ `canExecute()` 必为 false；新实现为 true。
 */
import { describe, test, expect } from 'bun:test';
import { createStreamBudget } from '../../src/chat/createAgentLoop';
import {
  TokenBudgetController,
  TokenBudgetStatus,
} from '../../src/tokenBudget/TokenBudgetController';
import { resolveContextWindow } from '../../src/context';

const MODEL = 'test-model-budget-refund';

describe('createStreamBudget · 对称记账（当前占用语义）', () => {
  test('增长→压缩→再增长：压缩后退款，不得因"历史累计"被硬停', () => {
    // 窗口事实源（2026-09-26 二次修复）：`createStreamBudget.total` 现与 `UnifiedTokenTracker`
    // **同源**取 `resolveContextWindow`；修复前它取价格表（`getDefaultTokenBudget`），
    // 实测同一模型给出 200,000 vs 128,000 两个窗口 ⇒ 阈值线失准。
    const total = resolveContextWindow(MODEL).tokens;
    expect(total).toBeGreaterThan(0);

    const budget = createStreamBudget(MODEL);
    expect(budget).toBeDefined();

    // ① 增长到 90%（< 92% 阈值）⇒ 仍可执行
    budget!.chargeContextEstimate(Math.floor(total * 0.9));
    expect(budget!.canExecute()).toBe(true);

    // ② compaction 回落 ⇒ 退款（当前占用降到 30%）
    budget!.chargeContextEstimate(Math.floor(total * 0.3));
    expect(budget!.canExecute()).toBe(true);

    // ③ **分水岭**：再次增长到 90%。旧实现累计 = 90% + 60% = 150% ⇒ 必 EXCEEDED（false）；
    //    新实现 = 当前占用 90% ⇒ true。
    budget!.chargeContextEstimate(Math.floor(total * 0.9));
    expect(budget!.canExecute()).toBe(true);

    // ④ 保护意图不变：真正逼近窗口（95% ≥ 92%）⇒ **必须**硬停
    budget!.chargeContextEstimate(Math.floor(total * 0.95));
    expect(budget!.canExecute()).toBe(false);
  });

  test('needsGraceCall 每 run 仅授予一次（语义未被本次修改影响）', () => {
    const budget = createStreamBudget(MODEL);
    expect(budget!.needsGraceCall?.()).toBe(true);
    expect(budget!.needsGraceCall?.()).toBe(false);
  });

  test('无 model 时不臆造预算（CS03，行为不变）', () => {
    expect(createStreamBudget(undefined)).toBeUndefined();
    expect(createStreamBudget('')).toBeUndefined();
  });
});

describe('TokenBudgetController.releaseTokens（退款原语）', () => {
  test('退款下调 spent 与 remaining，且不篡改生命周期累计统计', () => {
    const controller = new TokenBudgetController(
      MODEL,
      { total: 1000, remaining: 1000, maxOutputTokens: 200 },
      1000
    );

    controller.consumeTokens(950); // 95% ≥ 92% ⇒ EXCEEDED
    expect(controller.checkBudget()).toBe(TokenBudgetStatus.EXCEEDED);

    controller.releaseTokens(600); // 回到 35% ⇒ 恢复可执行
    expect(controller.checkBudget()).not.toBe(TokenBudgetStatus.EXCEEDED);
    expect(controller.getRemainingBudget()).toBe(650);
  });

  test('退款不得越过 0（坏输入亦不放大额度）', () => {
    const controller = new TokenBudgetController(
      MODEL,
      { total: 1000, remaining: 1000, maxOutputTokens: 200 },
      1000
    );
    controller.consumeTokens(100);

    controller.releaseTokens(99999); // 超退 ⇒ 夹到 0
    expect(controller.getRemainingBudget()).toBe(1000);

    controller.releaseTokens(-5); // 负数/非法 ⇒ no-op
    controller.releaseTokens(Number.NaN);
    expect(controller.getRemainingBudget()).toBe(1000);
  });
});
