/**
 * 单轮流式预算的**窗口回落口径**回归 —— CS03 落地（2026-10-11）。
 *
 * **背景（真机取证）**：`resolveContextWindow` 在模型不在 `model_registry` 缓存时回落到
 * `DEFAULT_CONTEXT_WINDOW = 200_000`（`source='default'`）。而 `createStreamBudget` 原判据
 * `!Number.isFinite(windowTokens) || windowTokens <= 0` 是**死判据**（该函数恒返回有限正数）
 * ⇒ 注释所称"取不到可靠窗口时**不臆造预算**"从未生效。
 *
 * **后果（本仓 DB 实测窗口跨 8,192 … 1,048,576）**：未知窗口回落 200K ⇒ 32K 模型硬停线
 * 高约 **6×**、8K 模型高约 **22×** ⇒ 保护形同虚设（且静默）。
 *
 * **修法**：按 `source` 判定 —— `default` ⇒ 返回 `undefined`（骨架 `config.budget` 分支不生效）；
 * `db` / `config` / `known_model` ⇒ 照常建预算。
 */
import { describe, expect, it } from 'bun:test';
import { createStreamBudget } from '../../src/chat/createAgentLoop';
import {
  resolveContextWindow,
  setModelWindow,
} from '../../src/utils/ContextWindowResolver';

describe('createStreamBudget · 窗口回落口径（CS03：不臆造预算）', () => {
  it('模型不在窗口缓存（source=default）⇒ 不臆造预算（undefined）', () => {
    const model = 'test-model-unknown-window';
    // 先证前提：该模型确实走回落分支
    expect(resolveContextWindow(model).source).toBe('default');
    expect(createStreamBudget(model)).toBeUndefined();
  });

  it('缓存命中（source=db）⇒ 预算生效，且阈值锚定**缓存窗口**（非 200K）', () => {
    const model = 'test-model-cached-32k-window';
    setModelWindow(model, 32_768);
    expect(resolveContextWindow(model).source).toBe('db');

    const budget = createStreamBudget(model);
    expect(budget).toBeDefined();

    // 32K 窗口 ⇒ 92% 线 = 30,146.56
    // 占用 30,000（91.55%）⇒ 仍放行（critical 但未 exceed）
    budget!.chargeContextEstimate(30_000);
    expect(budget!.canExecute()).toBe(true);

    // 占用 31,000（94.6%）⇒ 必须硬停（若误用 200K 兜底，此处会放行 = 旧缺陷形态）
    budget!.chargeContextEstimate(31_000);
    expect(budget!.canExecute()).toBe(false);
  });

  it('无 model ⇒ 不臆造预算（既有行为不变）', () => {
    expect(createStreamBudget(undefined)).toBeUndefined();
    expect(createStreamBudget('')).toBeUndefined();
  });
});
