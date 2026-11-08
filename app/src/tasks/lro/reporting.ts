/**
 * lro/reporting.ts — PDCA 报告生成与状态 / 指标投影
 *
 * 由 `tasks/LongRunningTaskOrchestrator.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §46）：**只搬不改**（含全部原注释与日志文案）。
 * 原为 4 个宿主方法（`generateReport` / `persistAuditReport` / `getStatus` / `getMetrics`）；
 * 所需宿主状态经 `PdcaReportView` **只读窄端口**传入 ⇒ 宿主仅保留薄委托，行为逐字不变。
 *
 * 依赖方向：本模块**不被宿主以外引用**，且不反向 import 宿主 ⇒ 无循环。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@openliri/infra/environment';
import { taskOrchestrator } from '../TaskOrchestrator';
import type { PlanProgress, PlanStep } from '../TaskOrchestrator';
import { generateAuditReport } from '../AuditReport';
import type { AuditReport } from '../AuditReport';
import { TaskStatus } from '../types';
import type { LifecycleEvent } from '../LifecycleTracker';
import { PDCA_PHASE_FAILED } from '@modules/tasks/phases';
import type { PdcaPhase } from '@modules/tasks/phases';
import type { ReviewDecision } from '../PlanReview';
import type { PdcaStatus, PdcaMetrics } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/** 报告 / 状态投影所需的宿主状态（只读快照） */
export interface PdcaReportView {
  taskId: string;
  planId: string | null;
  phase: PdcaPhase;
  decisionAwait: Promise<ReviewDecision> | null;
  auditReport: AuditReport | null;
  lifecycle: LifecycleEvent[];
  /** 已执行的 PDCA 轮次（编排器随每轮 `iterations++` 回写；见 `PdcaStatus.loopIteration`） */
  iterations: number;
  stepDurations: ReadonlyMap<
    string,
    { startMs: number; endMs?: number; tokens?: number }
  >;
}

/** 生成审计报告（原 `generateReport`） */
export function renderAuditReport(view: PdcaReportView): AuditReport {
  if (!view.planId) throw new Error('No plan created');

  const plan = taskOrchestrator.getPlan(view.planId)!;
  return generateAuditReport({
    taskId: view.taskId,
    planId: view.planId,
    // 2026-11-08（真机 `pdca_mw7f7h2g`）：目标未收敛等**任务级失败**要与步骤事实一起进摘要
    taskFailed: view.phase === PDCA_PHASE_FAILED,
    steps: plan.steps.map((s) => {
      const dur = view.stepDurations.get(s.id);
      return {
        id: s.id,
        description: s.description,
        status: s.status,
        reviewResult: s.reviewResult,
        retryCount: s.retryCount,
        durationMs: dur ? (dur.endMs ?? Date.now()) - dur.startMs : 0,
        error: s.error,
      };
    }),
  });
}

/**
 * BUG 修复: 将审计报告持久化到文件，重启后可恢复。
 * 保存路径: ~/.pyapp/data/task-audits/{taskId}.json
 */
export function persistAuditReportFile(report: AuditReport): void {
  try {
    const dir = join(resolveDataDir(), 'task-audits');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${report.taskId}.json`),
      JSON.stringify(report, null, 2),
      'utf-8'
    );
  } catch (err) {
    // 持久化失败不影响任务完成状态
    logger.warn('审计报告持久化失败', {
      taskId: report.taskId,
      error: String(err),
    });
  }
}

/**
 * 读取落盘的审计报告（**重启后恢复**）。
 *
 * 2026-11-07（真机）：`persistAuditReportFile` 的注释已写明「重启后可恢复」，但此前
 * **没有任何读取点** ⇒ 重启后 `GET /v1/pdca/:id/audit` 只回 `{error:'Not available'}`，
 * 而真实报告就在 `~/.pyapp/data/task-audits/{taskId}.json`。本函数是该文件的唯一读取实现。
 */
export function readAuditReportFile(taskId: string): AuditReport | null {
  try {
    const p = join(resolveDataDir(), 'task-audits', `${taskId}.json`);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf-8')) as AuditReport;
  } catch (err) {
    logger.warn('审计报告读取失败', { taskId, error: String(err) });
    return null;
  }
}

/** PDCA 状态快照投影（原 `getStatus`） */
export function projectPdcaStatus(view: PdcaReportView): PdcaStatus {
  const plan = view.planId ? taskOrchestrator.getPlan(view.planId) : undefined;
  const progress: PlanProgress | undefined = view.planId
    ? taskOrchestrator.getPlanProgress(view.planId)
    : undefined;

  let currentStep: PlanStep | undefined;
  if (plan) {
    currentStep = plan.steps.find((s) => s.status === 'running');
  }

  return {
    taskId: view.taskId,
    planId: view.planId || '',
    phase: view.phase,
    // 2026-11-07（真机）：会话/描述随状态投影 —— 否则详情接口在「内存（重启前）」与
    // 「检查点（重启后）」两条路径字段不一致；两者都取自计划（createPlan 时已落库）。
    ...(plan?.sessionId ? { sessionId: plan.sessionId } : {}),
    ...(plan?.description ? { description: plan.description } : {}),
    plan,
    progress,
    // 2026-11-08：轮次随状态投影（HTTP 层据此并入 `progress.iteration`）
    loopIteration: view.iterations,
    currentStep,
    awaitUserDecision: view.decisionAwait !== null,
    audit: view.auditReport || undefined,
    lifecycle: view.lifecycle,
  };
}

/** PDCA 监控指标投影（原 `getMetrics`） */
export function projectPdcaMetrics(view: PdcaReportView): PdcaMetrics {
  const plan = view.planId ? taskOrchestrator.getPlan(view.planId) : undefined;
  const steps = plan?.steps ?? [];
  const lifecycle = view.lifecycle;

  const totalSteps = steps.length;
  const completedSteps = steps.filter((s) => s.status === 'completed').length;
  const failedSteps = steps.filter((s) => s.status === 'failed').length;

  // 平均每步耗时（1-1d 口径：per-step 墙钟跨度均值）。
  // 依赖批次并行时各步同时计时，此为"每步平均占用跨度"而非任务总耗时；
  // 任务级成本口径看 _totalTokensTracked / goal_metrics.total_tokens。
  const durations = Array.from(view.stepDurations.values())
    .filter((d) => d.endMs)
    .map((d) => d.endMs! - d.startMs);
  const avgStepDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

  // Review 指标
  const reviewedSteps = steps.filter(
    (s) => s.reviewResult?.score !== undefined
  );
  const avgReviewScore =
    reviewedSteps.length > 0
      ? Math.round(
          reviewedSteps.reduce(
            (sum, s) => sum + (s.reviewResult?.score ?? 0),
            0
          ) / reviewedSteps.length
        )
      : 0;
  const passedReviews = reviewedSteps.filter(
    (s) => s.reviewResult?.pass
  ).length;
  const reviewPassRate =
    reviewedSteps.length > 0
      ? Math.round((passedReviews / reviewedSteps.length) * 100)
      : 100;

  // 工具调用失败
  const toolFailureSteps = steps.filter(
    (s) => s.error && s.error.includes('tool')
  ).length;

  // 中断率
  const abortedEvents = lifecycle.filter(
    (e) => e.phase === 'finalized' && e.status === TaskStatus.FAILED
  ).length;
  const abortRate =
    lifecycle.length > 0
      ? Math.round((abortedEvents / lifecycle.length) * 100)
      : 0;

  return {
    totalCycles: lifecycle.filter((e) => e.phase === 'progress').length,
    totalSteps,
    completedSteps,
    failedSteps,
    avgStepDurationMs,
    avgReviewScore,
    reviewPassRate,
    toolFailureSteps,
    abortRate,
  };
}
