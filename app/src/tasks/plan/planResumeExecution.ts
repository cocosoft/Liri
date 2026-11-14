// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 按既有计划续跑：`Plan` → `DecompositionResult` 投影（D3 二期，2026-11-14）
 *
 * 用途：系统级续跑时，`PlanDrivenLoop` **不再**走复杂度门/分解/`createPlan`，而是把既有
 * 计划的步骤投影成"分解结果"直接进入既有的拓扑批次执行路径。
 *
 * 步骤状态映射（**只重做未终态步骤**，不擅自重试已失败/已取消步骤）：
 * | 计划步骤状态 | 投影到 SubTask | 语义 |
 * |---|---|---|
 * | `completed` | `completed` | 已完成，执行器跳过；前驱状态记为 `ok` |
 * | `failed` / `cancelled` | `skipped` | 已结束（失败/取消），执行器跳过；前驱状态记为 `skipped` |
 * | `pending` / `running` | `pending` | 待执行（`running` 由调用方先行复位为 `pending`） |
 *
 * 纯函数、无 IO —— 执行器的采纳逻辑由 `PlanDrivenLoop._executeDecomposed(…, existingPlan)` 承接。
 */

import type {
  DecompositionResult,
  SubTask,
} from '../../ai/router/TaskDecomposer';
import {
  type Plan,
  STEP_STATUS_CANCELLED,
  STEP_STATUS_COMPLETED,
  STEP_STATUS_FAILED,
  STEP_STATUS_PENDING,
} from '../TaskOrchestrator';

/**
 * 单步投影（纯函数）。
 *
 * 取值复用 `TaskOrchestrator` 常量（不另写字符串）；`PlanStep['status']` 含 `cancelled`
 * （不在 `SubTask['status']` 值域内）⇒ 用**窄化断言**转换而不是重复字面量。
 * ⚠️ 断言必须**写在函数体内**：本模块与 `TaskOrchestrator` 处于模块环上，
 * 顶层求值常量会在环的另一侧读到未初始化的 `const`（TDZ，实测 `bun test` 触发）。
 */
export function projectPlanStepForResume(
  step: Plan['steps'][number]
): SubTask['status'] {
  if (step.status === STEP_STATUS_COMPLETED) {
    return STEP_STATUS_COMPLETED as SubTask['status'];
  }
  if (step.status === STEP_STATUS_FAILED) return 'skipped';
  if (step.status === STEP_STATUS_CANCELLED) return 'skipped';
  return STEP_STATUS_PENDING as SubTask['status'];
}

/** 该计划是否还有可执行（未终态）步骤 ⇒ 值得续跑 */
export function isPlanResumableByExecutor(plan: Plan): boolean {
  return plan.steps.some(
    (step) => projectPlanStepForResume(step) === STEP_STATUS_PENDING
  );
}

/**
 * 计划 → 分解结果（**保留步骤 id 与依赖 id**，使执行器的 `stepId` 映射与计划台账一致）。
 *
 * @throws 无步骤 ⇒ 抛错（调用方应先用 {@link isPlanResumableByExecutor} 判定）
 */
export function buildResumeDecomposition(plan: Plan): DecompositionResult {
  if (plan.steps.length === 0) {
    throw new Error(`计划 ${plan.id} 没有步骤，无法续跑`);
  }
  return {
    // 续跑不重新判档：沿用可执行的最低档位（路由档位只影响步内模型选择，不改变依赖语义）
    mainTier: 'medium',
    reasoning: `按既有计划续跑（plan ${plan.id}）：已完成/已结束步骤跳过，未终态步骤按既有依赖执行`,
    subTasks: plan.steps.map((step) => ({
      id: step.id,
      description: step.description,
      dependsOn: [...(step.dependsOn ?? [])],
      status: projectPlanStepForResume(step),
      ...(step.result ? { result: step.result } : {}),
      ...(step.acceptanceCriteria
        ? { acceptanceCriteria: step.acceptanceCriteria }
        : {}),
    })),
  };
}
