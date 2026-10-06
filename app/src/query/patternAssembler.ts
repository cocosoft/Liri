// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编排 pattern 的「装配入口」（A8 最后一公里 · 方案 B1，2026-10-04）
 *
 * 职责：把 `PatternSelection.descriptor.assembly.assembler` 解析为**可执行运行路由**
 * （复用既有实现），使装配描述不再只被测试期读取 —— 当前唯一生产消费者 =
 * `ChatManager._maybeLaunchPdca` 的研究分流。
 *
 * 边界（如实 · CS03/CS04）：
 * - **不新建编排运行时**：`competitive_strategy` 复用 A7 冻结的装配点
 *   （`runResearchOrchestration`，构造/默认/执行内聚其中，本层不复制构造逻辑）。
 * - `long_task_pdl` 的运行时（PlanDrivenLoop）存在，但由 ChatManager 快速路径策略
 *   （`_shouldUsePlanDrivenLoop`）**独立驱动**，不经 pattern 装配
 *   （D2 = 以运行时为准）⇒ 本层如实返回 `unavailable`（不静默空转）。
 * - `iterative_refine` / `parallel_distributed` 无运行时、无触发场景（N4）
 *   ⇒ 同 `unavailable`，**不臆造运行时/占位 stub**（CS04）。
 * - 13-P1-3（2026-10-05）：`self_verify` 升为 **ready** —— 复用**既有** `VerifierAgent`
 *   （配方 `verifyPolicy:'blocking'`），并返回执行配方供消费方配置该运行时；
 *   ⚠️ 触发场景仍缺（N4）⇒ 接线存在但当前**不可达**（不谎报为"已生效"）。
 *
 * 完备性：`ASSEMBLER_SPECS` 为 `Record<PatternAssemblerId, …>` ⇒ 闭集增项而漏登记
 * 即**编译失败**（防手写漂移）。
 *
 * 分层：本文件属 **app 层**（`query`），依赖 core 层 barrel `@modules/core`（合法方向）；
 * 不 import 任何 provider 实现（避免引入重依赖与跨模块边）。
 */

import type {
  PatternAssemblerId,
  PatternRecipe,
  PatternSelection,
} from '@modules/core';

/** 已接线的运行路由（闭集；13-P1-3 新增 `verify`） */
export type PatternRunRoute = 'research' | 'verify';

/**
 * 装配结果：可执行路由 **+ 执行配方**，或 显式不可用
 * （CS02：判定式状态字段，非用户可见字符串）。
 */
export type PatternInstantiation =
  | {
      status: 'ready';
      assembler: PatternAssemblerId;
      route: PatternRunRoute;
      /** 13-P1-3：执行配方（并发/验证/预算），供消费方配置**既有**运行时 */
      recipe: PatternRecipe;
    }
  | { status: 'unavailable'; assembler: PatternAssemblerId; reason: string };

/** 单个装配入口的规格：可执行路由（含配方） 或 不可用原因（二选一，必有其一） */
type AssemblerSpec =
  | { route: PatternRunRoute; recipe: PatternRecipe }
  | { reason: string };

/** 研究线路配方：对抗评审为**建议性**（不阻断主流程） */
const RESEARCH_RECIPE: PatternRecipe = {
  loopKind: 'research',
  verifyPolicy: 'advisory',
  budgetPolicy: 'default',
};

/** 自校验线路配方：验证**阻断式**（不通过即不放行）+ 严格预算 */
const VERIFY_RECIPE: PatternRecipe = {
  loopKind: 'verify',
  verifyPolicy: 'blocking',
  budgetPolicy: 'strict',
};

/**
 * assembler → 装配规格（**闭集全覆盖**；`Record` 形态编译期保证无漏配）。
 * 新增 `PatternAssemblerId` 而漏登记 ⇒ 编译失败。
 */
const ASSEMBLER_SPECS: Readonly<Record<PatternAssemblerId, AssemblerSpec>> = {
  competitive_strategy: { route: 'research', recipe: RESEARCH_RECIPE },
  long_task_pdl: {
    reason:
      'PlanDrivenLoop 运行时存在，但由 ChatManager 快速路径策略（_shouldUsePlanDrivenLoop）独立驱动，不经 pattern 装配（D2 = 以运行时为准）',
  },
  iterative_refine: { reason: '无运行时、无触发场景（N4），未接线' },
  parallel_distributed: { reason: '无运行时、无触发场景（N4），未接线' },
  // 13-P1-3（2026-10-05）：`self_verify` 由 unavailable 升为 **ready** —— 复用既有 VerifierAgent
  // （配方 verifyPolicy:'blocking'）。⚠️ 触发场景仍缺（N4）⇒ 接线存在但当前**不可达**，如实记录。
  self_verify: { route: 'verify', recipe: VERIFY_RECIPE },
};

/**
 * 把 pattern 选择结果装配为**可执行路由 + 配方**（不可用则显式给出原因）。
 *
 * @param selection `selectPattern` 的返回值（携带 `descriptor.assembly`）
 */
export function instantiatePattern(
  selection: PatternSelection
): PatternInstantiation {
  const assembler = selection.descriptor.assembly.assembler;
  const spec = ASSEMBLER_SPECS[assembler];
  return 'route' in spec
    ? { status: 'ready', assembler, route: spec.route, recipe: spec.recipe }
    : { status: 'unavailable', assembler, reason: spec.reason };
}

/**
 * 配方 → 验证器配置（13-P1-3）：供消费方把配方应用到**既有** VerifierAgent
 * （不新建运行时；字段语义见 `VerifierAgentConfig`）。
 */
export function verifierConfigForRecipe(recipe: PatternRecipe): {
  enabled: boolean;
  failClosed: boolean;
  maxCycles?: number;
} {
  switch (recipe.verifyPolicy) {
    case 'off':
      return { enabled: false, failClosed: true };
    case 'advisory':
      return { enabled: true, failClosed: false };
    case 'blocking':
      return {
        enabled: true,
        failClosed: true,
        maxCycles: recipe.budgetPolicy === 'strict' ? 2 : undefined,
      };
  }
}
