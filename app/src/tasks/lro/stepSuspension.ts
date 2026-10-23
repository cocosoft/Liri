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

import { getLogger } from '@modules/monitoring';
import type { PdcaPhase } from '@modules/core';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import { STEP_STATUS_PENDING } from '../TaskOrchestrator';
import type { PdcaStatus } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/** 挂起等待审批的步骤（`decision==='suspend'`） */
export function listSuspendedSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.decision === 'suspend');
}

/**
 * 把挂起步骤置回 `pending` 并清 `decision`（**保留** result/toolOutcomes 作为审计证据）。
 *
 * @returns 被恢复的步骤 id 列表（空 = 没有可恢复的挂起步骤）
 */
export function resumeSuspendedSteps(plan: Plan): string[] {
  const resumed: string[] = [];
  for (const step of plan.steps) {
    if (step.decision === 'suspend') {
      step.status = STEP_STATUS_PENDING;
      step.decision = undefined;
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
