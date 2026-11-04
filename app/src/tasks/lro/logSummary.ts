// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * lro/logSummary.ts — LRO **每任务汇总**日志（P2-1，2026-11-04）
 *
 * **为什么要汇总**：真机窗口内 `[orchestrator]` 逐次日志合计 64.5 MB，其中四条逐次/逐工具
 * 日志（`callModel 完成` / `executeTools 开始执行` / `executeTools 执行完毕` / `工具执行成功`）
 * 约 47 MB / 148 k 条。它们承载的是"事故指纹"（结构性不可达靠它发现），不能删 —— 故
 * 改为「每步一行（`TAORLoop 步骤收尾`）+ 每任务一行（本模块）」，逐次明细降 debug。
 *
 * 口径：步骤终态计数 + 重试合计 + 工具结局合计（缺 `toolOutcomes` 的步骤**不参与**
 * 工具合计 —— 未采集 ≠ 零失败）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import type { Plan } from '../TaskOrchestrator';
import {
  STEP_STATUS_CANCELLED,
  STEP_STATUS_COMPLETED,
  STEP_STATUS_FAILED,
} from '../TaskOrchestrator';

const logger = getLogger('tasks:longRunning');

export interface PlanLogSummary {
  steps: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    retried: number;
  };
  tools: {
    total: number;
    success: number;
    failed: number;
    intercepted: number;
    pendingApproval: number;
  };
}

/** 计划 → 日志汇总载荷（纯函数，供每任务一行日志使用） */
export function summarizePlanForLog(plan: Plan): PlanLogSummary {
  const steps = plan.steps;
  const tools = steps.reduce(
    (acc, s) => {
      const o = s.toolOutcomes;
      if (!o) return acc;
      acc.total += o.total;
      acc.success += o.successCount;
      acc.failed += o.failedCount;
      acc.intercepted += o.securityIntercepted;
      acc.pendingApproval += o.pendingApproval;
      return acc;
    },
    { total: 0, success: 0, failed: 0, intercepted: 0, pendingApproval: 0 }
  );
  return {
    steps: {
      total: steps.length,
      completed: steps.filter((s) => s.status === STEP_STATUS_COMPLETED).length,
      failed: steps.filter((s) => s.status === STEP_STATUS_FAILED).length,
      cancelled: steps.filter((s) => s.status === STEP_STATUS_CANCELLED).length,
      retried: steps.reduce((n, s) => n + (s.retryCount ?? 0), 0),
    },
    tools,
  };
}

/** 任务终态收口（`pdca_completed` / `pdca_failed` / `pdca_aborted`）各输出一次 */
export function logTaskSummary(params: {
  taskId: string;
  planId: string | null;
  stage: string;
  plan: Plan;
  totalTokens: number;
  startedAt: number;
}): void {
  const { steps, tools } = summarizePlanForLog(params.plan);
  logger.info('[orchestrator] 任务汇总', {
    taskId: params.taskId,
    planId: params.planId,
    stage: params.stage,
    planStatus: params.plan.status,
    durationMs: params.startedAt > 0 ? Date.now() - params.startedAt : 0,
    totalTokens: params.totalTokens,
    steps,
    tools,
  });
}
