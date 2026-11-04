// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1（2026-11-04）：LRO「每任务汇总」日志载荷的纯函数守卫。
 *
 * 真机窗口内四条逐次/逐工具 `[orchestrator]` 日志合计 47.1 MB / 148 k 条 ⇒ 已降 debug，
 * 观测改由「每步一行（`TAORLoop 步骤收尾`）+ 每任务一行（`summarizePlanForLog`）」承载。
 * 本用例钉住后者的口径：步骤终态计数、重试合计、工具结局合计（缺 `toolOutcomes` 的步骤不参与）。
 */
import { describe, it, expect } from 'bun:test';
import { summarizePlanForLog } from '../../src/tasks/lro/logSummary';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';

function makeStep(over: Partial<PlanStep> = {}): PlanStep {
  return {
    id: over.id ?? 'step-1',
    description: '步骤',
    status: 'pending',
    taskId: 'task-1',
    retryCount: 0,
    maxRetries: 3,
    ...over,
  };
}

function makePlan(steps: PlanStep[]): Plan {
  return {
    id: 'plan-1',
    description: '汇总口径',
    steps,
    status: 'completed',
    createdAt: new Date().toISOString(),
    sessionId: 'session-1',
  };
}

describe('summarizePlanForLog：每任务汇总口径', () => {
  it('按终态计数步骤、累加重试次数，并跨步骤汇总工具结局', () => {
    const summary = summarizePlanForLog(
      makePlan([
        makeStep({
          id: 'a',
          status: 'completed',
          retryCount: 1,
          toolOutcomes: {
            outcomes: [],
            total: 4,
            successCount: 3,
            failedCount: 1,
            securityIntercepted: 0,
            pendingApproval: 0,
          },
        }),
        makeStep({
          id: 'b',
          status: 'failed',
          retryCount: 2,
          toolOutcomes: {
            outcomes: [],
            total: 2,
            successCount: 0,
            failedCount: 1,
            securityIntercepted: 1,
            pendingApproval: 0,
          },
        }),
        makeStep({ id: 'c', status: 'cancelled' }),
      ])
    );

    expect(summary.steps).toEqual({
      total: 3,
      completed: 1,
      failed: 1,
      cancelled: 1,
      retried: 3,
    });
    expect(summary.tools).toEqual({
      total: 6,
      success: 3,
      failed: 2,
      intercepted: 1,
      pendingApproval: 0,
    });
  });

  it('缺 toolOutcomes 的步骤不参与工具合计（未采集 ≠ 零失败）', () => {
    const summary = summarizePlanForLog(
      makePlan([
        makeStep({ id: 'a', status: 'completed' }),
        makeStep({
          id: 'b',
          status: 'completed',
          toolOutcomes: {
            outcomes: [],
            total: 1,
            successCount: 1,
            failedCount: 0,
            securityIntercepted: 0,
            pendingApproval: 1,
          },
        }),
      ])
    );

    expect(summary.tools.total).toBe(1);
    expect(summary.tools.pendingApproval).toBe(1);
    expect(summary.steps.completed).toBe(2);
  });
});
