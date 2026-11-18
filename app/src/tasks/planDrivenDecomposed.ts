// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PlanDrivenLoop 分解路径的**纯辅助**（P3-2 拆分，从 `PlanDrivenLoop.ts` 原样外移）。
 *
 * 这里只放不依赖宿主实例状态的函数 —— 编排与副作用仍留在主类，避免主文件继续膨胀
 *（R04-001 单文件 2000 行上限）。
 */
import type { Plan } from './TaskOrchestrator.js';
import {
  STEP_STATUS_CANCELLED,
  STEP_STATUS_COMPLETED,
  STEP_STATUS_FAILED,
} from './TaskOrchestrator.js';
import type { TopoTaskStatus } from './topoBatches.js';

/**
 * D3 二期：采纳既有计划时回填**已结束步骤**的前驱状态与产出（不执行这些步骤）。
 *
 * completed ⇒ `ok`（并回填其产出，供后继注入）；failed/cancelled ⇒ `skipped`
 *（与原硬依赖阻断语义一致）。语义与日志均未变，仅从 `PlanDrivenLoop` 外移。
 */
export function seedDepStatusFromExistingPlan(
  existingPlan: Plan | undefined,
  depStatusById: Map<string, TopoTaskStatus>,
  stepOutputs: Map<string, string>
): void {
  if (!existingPlan) return;
  for (const step of existingPlan.steps) {
    if (step.status === STEP_STATUS_COMPLETED) {
      depStatusById.set(step.id, 'ok');
      if (step.result) stepOutputs.set(step.id, step.result);
    } else if (
      step.status === STEP_STATUS_FAILED ||
      step.status === STEP_STATUS_CANCELLED
    ) {
      depStatusById.set(step.id, 'skipped');
    }
  }
}
