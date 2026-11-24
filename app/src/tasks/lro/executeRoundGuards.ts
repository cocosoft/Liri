// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * executeRoundGuards —— PDCA 执行循环的**轮级守卫**（P3-2 拆分，从
 * `LongRunningTaskOrchestrator._runExecuteDecideLoop` 原样外移）。
 *
 * 三个纯编排动作：轮前准入拒绝、轮尾 review/decide 与停止闸门、轮次上限强制退出。
 * 宿主只按返回的失败码（或哨兵）分派控制流；计划落库、告警与日志语义未变。
 */
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import {
  PLAN_STATUS_FAILED,
  STEP_STATUS_COMPLETED,
  STEP_STATUS_PENDING,
} from '../TaskOrchestrator';
import { validatePlanAdmission } from '../planAdmission';
// P2-1（2026-11-24，R09-013）：计划状态转移审计（唯一入口）
import { auditPlanStatusChange } from '../plan/planStatusAudit';
import { shouldStopForPendingApproval } from './stepSuspension';
import { budgetStopped } from './failureRecovery';

export interface RoundGuardDeps {
  taskId: string;
  planId: string | null;
  savePlan: (plan: Plan) => void;
}

/** 轮尾停止哨兵：外部闸门（如等待人工审批）命中 ⇒ 宿主仅退出循环，不记失败原因。 */
export const ROUND_STOP_EXTERNAL = 'round_stop:external';

/** 落失败终态（与循环内原写法一致：status/completedAt + 持久化）。 */
function markPlanFailed(
  plan: Plan,
  deps: RoundGuardDeps,
  reason: string
): void {
  auditPlanStatusChange(plan, PLAN_STATUS_FAILED, reason);
  plan.status = PLAN_STATUS_FAILED;
  plan.completedAt = new Date().toISOString();
  deps.savePlan(plan);
}

/**
 * 轮前准入校验：不通过则计划落 failed 并返回失败码 `PLAN_ADMISSION_REJECTED`。
 */
export function rejectUnadmittedPlan(
  plan: Plan,
  maxSteps: number,
  deps: RoundGuardDeps
): string | null {
  const admission = validatePlanAdmission(plan, { maxSteps });
  if (admission.ok) return null;

  markPlanFailed(plan, deps, 'admission_rejected');
  void handleError(
    new AppError(
      `计划未通过准入校验：${admission.reason}`,
      ErrorCategory.VALIDATION,
      ErrorSeverity.HIGH,
      'PLAN_ADMISSION_REJECTED',
      {
        taskId: deps.taskId,
        planId: deps.planId,
        reason: admission.reason,
        steps: plan.steps.map((s) => s.id),
      }
    ),
    { module: 'tasks:longRunning', action: 'planAdmission' }
  );
  return 'PLAN_ADMISSION_REJECTED';
}

/**
 * 轮尾 review/decide + 停止闸门。
 *
 * 仅 `completed && !decision` 的步骤参与（幂等）；返回 `ROUND_STOP_EXTERNAL`
 * 表示外部闸门命中，返回 `DAILY_BUDGET_EXHAUSTED` 表示日预算耗尽。
 */
export async function reviewAndDecideRound(
  plan: Plan,
  deps: RoundGuardDeps & {
    autoDecideStep: (stepId: string) => Promise<unknown>;
  }
): Promise<string | null> {
  for (const step of plan.steps) {
    if (step.status === STEP_STATUS_COMPLETED && !step.decision) {
      await deps.autoDecideStep(step.id);
    }
  }

  if (shouldStopForPendingApproval('iteration', deps.taskId, deps.planId, plan))
    return ROUND_STOP_EXTERNAL;
  if (budgetStopped(plan)) return 'DAILY_BUDGET_EXHAUSTED';
  return null;
}

/**
 * 轮次上限强制退出：无可重试步骤且已达上限 ⇒ 计划落 failed 并返回
 * `PDCA_MAX_ITERATIONS`；否则返回 `null`（继续下一轮）。
 */
export function enforceMaxIterations(
  plan: Plan,
  iterations: number,
  maxIterations: number,
  stepStatuses: Array<
    Pick<PlanStep, 'id' | 'status' | 'decision' | 'retryCount'>
  >,
  deps: RoundGuardDeps
): string | null {
  const hasRetry = plan.steps.some(
    (s) => s.status === STEP_STATUS_PENDING && s.decision === undefined
  );
  if (hasRetry || iterations < maxIterations) return null;

  markPlanFailed(plan, deps, 'max_iterations');
  void handleError(
    new AppError(
      'PDCA exceeded max iterations, forced abort',
      ErrorCategory.OPERATION,
      ErrorSeverity.HIGH,
      'PDCA_MAX_ITERATIONS',
      {
        taskId: deps.taskId,
        planId: deps.planId,
        iterations,
        maxIterations,
        steps: stepStatuses,
      }
    ),
    { module: 'tasks:longRunning', action: 'runFullPdca' }
  );
  return 'PDCA_MAX_ITERATIONS';
}
