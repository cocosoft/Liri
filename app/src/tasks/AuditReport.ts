/**
 * 审计报告模型
 *
 * 长程任务完成后的全量审计，包含：
 * - 步骤级状态与审查分数
 * - 时间与重试统计
 * - 文件变更清单
 */

import type { PlanReview } from './PlanReview';

/** 单步骤审计条目 */
export interface AuditStepEntry {
  stepId: string;
  description: string;
  status: string;
  reviewScore?: number;
  retries: number;
  durationMs: number;
  error?: string;
}

/** 审计报告 */
export interface AuditReport {
  taskId: string;
  planId: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  totalDurationMs: number;
  totalRetries: number;
  steps: AuditStepEntry[];
  summary: string;
  generatedAt: number;
}

/**
 * 从执行数据生成审计报告
 */
export function generateAuditReport(params: {
  taskId: string;
  planId: string;
  steps: Array<{
    id: string;
    description: string;
    status: string;
    reviewResult?: PlanReview;
    retryCount: number;
    durationMs: number;
    error?: string;
  }>;
}): AuditReport {
  const { taskId, planId, steps } = params;

  let completedSteps = 0;
  let failedSteps = 0;
  let skippedSteps = 0;
  let totalDurationMs = 0;
  let totalRetries = 0;

  const entries: AuditStepEntry[] = steps.map((s) => {
    if (s.status === 'completed') completedSteps++;
    else if (s.status === 'failed') failedSteps++;
    else if (s.status === 'cancelled') skippedSteps++;

    totalDurationMs += s.durationMs;
    totalRetries += s.retryCount;

    return {
      stepId: s.id,
      description: s.description,
      status: s.status,
      reviewScore: s.reviewResult?.score,
      retries: s.retryCount,
      durationMs: s.durationMs,
      error: s.error,
    };
  });

  const allPassed = failedSteps === 0 && skippedSteps === 0;
  const avgScore =
    entries.filter((e) => e.reviewScore !== undefined).length > 0
      ? Math.round(
          entries
            .filter((e) => e.reviewScore !== undefined)
            .reduce((sum, e) => sum + (e.reviewScore ?? 0), 0) /
            entries.filter((e) => e.reviewScore !== undefined).length
        )
      : undefined;

  const summary = [
    `任务 ${allPassed ? '完成' : '未完全完成'}`,
    `${completedSteps}/${steps.length} 步骤完成`,
    failedSteps > 0 ? `${failedSteps} 步骤失败` : '',
    avgScore !== undefined ? `平均审查分: ${avgScore}` : '',
    `总耗时: ${(totalDurationMs / 1000).toFixed(1)}s`,
    totalRetries > 0 ? `总重试: ${totalRetries} 次` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  return {
    taskId,
    planId,
    totalSteps: steps.length,
    completedSteps,
    failedSteps,
    skippedSteps,
    totalDurationMs,
    totalRetries,
    steps: entries,
    summary,
    generatedAt: Date.now(),
  };
}
