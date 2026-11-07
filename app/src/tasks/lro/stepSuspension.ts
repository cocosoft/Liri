// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepSuspension — 步骤级审批挂起的**落点与恢复**（PR-5，2026-10-23）
 *
 * 背景（方案 §3.10.6）：LRO 步骤内工具可返回 `requireApproval`，旧实现把它当普通结果
 * 进证据 ⇒ 审查门判"未产出" ⇒ retry/escalate（**把等审批当成模型失败**）。
 *
 * 现口径：
 * - 审查门 `decide` 见 `toolOutcomes.pendingApproval > 0` ⇒ `suspend`；
 * - 编排循环见任一 `decision==='suspend'` ⇒ 阶段转 `stage_awaiting_approval` 并**早退**
 *   （不落 completed / failed，也不进入目标级评估）；
 * - 用户批准后（`inboxApproval` → `resumeAfterApproval`）把挂起步骤置回 `pending` 重跑。
 *
 * 为什么外移：`LongRunningTaskOrchestrator` 已接近 R04-001 的 2000 行上限；
 * 本模块只做纯状态搬运 + 一次审计日志，不持有状态。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { PdcaPhase } from '@modules/tasks/phases';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import { STEP_STATUS_PENDING } from '../TaskOrchestrator';
import type { PdcaStatus } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/** 挂起等待审批的步骤（`decision==='suspend'`） */
export function listSuspendedSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.decision === 'suspend');
}

/**
 * 在等人工审批的步骤（2026-11-07 真机）。
 *
 * 批次调度用：`executeAllSteps` 在每批结束后调用 —— 有任一步的工具结果
 * `pendingApproval > 0` 时**不得**再启动后续批次，否则依赖步骤会基于"尚未执行"的
 * 产物空转（真机：step_1 的 bash 被 ask 挂起后，step_2/3 仍并行跑了数分钟）。
 */
export function listStepsAwaitingApproval(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => (s.toolOutcomes?.pendingApproval ?? 0) > 0);
}

/** 是否有步骤在等人工审批（挂起决策 或 工具结果标记） */
export function hasPendingApproval(plan: Plan): boolean {
  return (
    listSuspendedSteps(plan).length > 0 ||
    listStepsAwaitingApproval(plan).length > 0
  );
}

/**
 * 2026-11-07 真机：批次/轮次调度的「待审批」短路判定（有则落一条日志）。
 *
 * - `batch`：本批结束后**不得**再启动后续批次 —— 否则依赖步骤会基于"尚未执行"的产物
 *   空转（真机 step_1 被 ask 挂起后 step_2/3 仍并行跑了数分钟）；
 * - `iteration`：本轮结束后**直接退出** PDCA 循环，交给 `suspendPlanForApproval` 落
 *   `stage_awaiting_approval` —— 否则下一轮会继续执行依赖步骤，且目标级评估会把
 *   "等待审批"判成未收敛（plan.status=failed + P2 告警）。
 */
export function shouldStopForPendingApproval(
  scope: 'batch' | 'iteration',
  taskId: string,
  planId: string | null,
  plan: Plan
): boolean {
  if (!hasPendingApproval(plan)) return false;
  logger.warn(
    scope === 'batch'
      ? '[orchestrator] 检测到待审批步骤 ⇒ 停止后续批次'
      : '[orchestrator] 存在待审批步骤 ⇒ 结束本轮循环，等待人工审批',
    {
      taskId,
      planId,
      stepIds: [
        ...listSuspendedSteps(plan),
        ...listStepsAwaitingApproval(plan),
      ].map((s) => s.id),
    }
  );
  return true;
}

/**
 * 把挂起步骤置回 `pending` 并清 `decision`（**保留** result / 其余工具证据）。
 *
 * 2026-11-07（隐藏缺陷）：`toolOutcomes.pendingApproval` 必须**清零** —— 它同时是
 * 「批次/轮次调度判据」的输入（`listStepsAwaitingApproval`）。恢复后若该步不在首批执行
 * （依赖未满足），旧计数会让后续批次继续短路 ⇒ 再次挂起但**没有新卡**（永久等待）。
 *
 * @returns 被恢复的步骤 id 列表（空 = 没有可恢复的挂起步骤）
 */
export function resumeSuspendedSteps(plan: Plan): string[] {
  const resumed: string[] = [];
  for (const step of plan.steps) {
    if (step.decision === 'suspend') {
      step.status = STEP_STATUS_PENDING;
      step.decision = undefined;
      if (step.toolOutcomes) {
        step.toolOutcomes = { ...step.toolOutcomes, pendingApproval: 0 };
      }
      resumed.push(step.id);
    }
  }
  return resumed;
}

/**
 * 若计划中有挂起步骤 ⇒ 阶段转 `stage_awaiting_approval`、落检查点并返回当前状态；
 * 否则返回 `null`（调用方继续走既有终态裁决）。
 */
export async function suspendPlanForApproval(args: {
  taskId: string;
  planId: string | null;
  plan: Plan;
  setPhase: (phase: PdcaPhase) => Promise<void>;
  persistCheckpoint: () => Promise<void>;
  getStatus: () => PdcaStatus;
}): Promise<PdcaStatus | null> {
  const suspended = listSuspendedSteps(args.plan);
  if (suspended.length === 0) return null;
  await args.setPhase('stage_awaiting_approval');
  await args.persistCheckpoint();
  logger.info('[orchestrator] PDCA 挂起：等待人工审批', {
    taskId: args.taskId,
    planId: args.planId,
    steps: suspended.map((s) => ({
      id: s.id,
      pendingApproval: s.toolOutcomes?.pendingApproval ?? 0,
    })),
  });
  return args.getStatus();
}
