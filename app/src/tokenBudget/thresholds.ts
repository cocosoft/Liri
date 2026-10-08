/**
 * 统一预算阈值常量（**叶子模块**：零出向依赖）
 *
 * 台账 S17 根因修复（2026-10-08）：本常量原先定义在 `TokenBudgetController.ts`，而 `tokenBudget`
 * 存在**循环初始化**（`BudgetPolicy → TokenBudgetController → PriceManager/ModelContextCache →
 * @modules/ai` → `UnifiedTokenTracker`）。`UnifiedTokenTracker` 在**模块顶层**求值该常量
 * （`MODEL_THRESHOLD_PRESETS`）⇒ 当 `@modules/ai` 侧先于 `TokenBudgetController` 完成初始化加载它时，
 * **单文件**运行 `tests/tokenBudget/budgetPolicy.test.ts` /
 * `tests/tools/AgentTool/summaryBudgetRegression.test.ts` 必报
 * `ReferenceError: Cannot access 'UNIFIED_THRESHOLDS' before initialization`（生产与全量套件因
 * 加载顺序先行完成 `TokenBudgetController` 而不触发 ⇒ 仅测试隔离性噪音）。
 *
 * 抽到本模块（**无任何 import**）后，任何模块首引本文件都必然先完成求值 ⇒ 环上不再存在
 * "未初始化就取用"的取用点。`TokenBudgetController` 对既有消费者**原样再导出**，故消费面零改动。
 */

// === Phase 1a: 统一阈值常量 — 所有方法共享 ===
export const UNIFIED_THRESHOLDS = {
  COMPACT_LIGHT: 0.5, // 50% → getCompressionLevel 1
  COMPACT_MEDIUM: 0.7, // 70% → getCompressionLevel 2
  WARNING: 0.75, // 75% → getCurrentBudgetState isWarning
  COMPACT_DEEP: 0.85, // 85% → getCurrentBudgetState isCritical / getCompressionLevel 3
  CRITICAL: 0.92, // 92% → checkBudget CRITICAL
} as const;
