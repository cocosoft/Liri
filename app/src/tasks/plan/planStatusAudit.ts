// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 计划（Plan）状态转移审计（治理方案 P2-1 / R09-013，2026-11-24）。
 *
 * 背景：`Plan.status` 的写入点分散在编排器 / LRO / 续跑闸门等 9 处，
 * 且此前只有进程内 `OrchEvent.PLAN_*`（会话结束后不可重建）⇒ 统一经本函数落
 * `state/transition` 会话事件。
 *
 * 约定：**在赋值 `plan.status = next` 之前调用**（本函数读取 `from`）；
 * `from === to` 时直接返回（无转移不落事件）。
 */

import { emitStateTransitionAudit } from '@openliri/infra/state/engine/stateTransitionAudit';

/** 计划状态转移的最小结构（避免反向 import `TaskOrchestrator` 的类型造成环） */
export interface PlanStatusCarrier {
  id: string;
  sessionId?: string;
  status: string;
}

/**
 * 落一条计划状态转移审计。
 *
 * @param plan   计划对象（读取 `from` / `sessionId` / `id`）
 * @param to     目标状态
 * @param reason 触发原因（短标签，便于排查）
 */
export function auditPlanStatusChange(
  plan: PlanStatusCarrier,
  to: string,
  reason: string
): void {
  if (plan.status === to) return;
  emitStateTransitionAudit(plan.sessionId, {
    machine: 'plan',
    from: plan.status,
    to,
    reason,
    subjectId: plan.id,
  });
}

/** 计划**创建**（`null → pending`）：首次落盘时记一条，便于重建"计划何时开始"。 */
export function auditPlanCreated(
  plan: PlanStatusCarrier,
  reason: string
): void {
  emitStateTransitionAudit(plan.sessionId, {
    machine: 'plan',
    from: null,
    to: plan.status,
    reason,
    subjectId: plan.id,
  });
}
