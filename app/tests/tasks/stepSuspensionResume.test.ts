// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-08（真机 `pdca_mw6wxxk1`）：审批通过后**恢复挂起步骤**的证据清理。
 *
 * 失败窗口：`resumeSuspendedSteps` 只把 `toolOutcomes.pendingApproval` 计数清零，却保留
 * `outcomes[]` 里仍带 `pendingApproval: true` 的条目。计数一旦按条目重算
 * （`summarizeToolOutcomes` / `mergeToolOutcomeSummaries`），已批准的"待审批"就复活 ⇒
 * 任务再次挂起，但**不会再提交新卡**（收件箱零 pending），用户无处可点、任务永久卡死。
 */

import { describe, expect, it } from 'bun:test';
import { resumeSuspendedSteps } from '../../src/tasks/lro/stepSuspension';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';

function makePlan(step: Partial<PlanStep>): Plan {
  return {
    id: 'plan_demo',
    description: 'demo',
    status: 'running',
    createdAt: new Date().toISOString(),
    sessionId: 'session_demo',
    steps: [
      {
        id: 'step_1',
        description: 'demo step',
        taskId: 'task',
        status: 'completed',
        retryCount: 0,
        maxRetries: 3,
        ...step,
      } as PlanStep,
    ],
  };
}

const pendingOutcome = {
  toolName: 'bash',
  toolCallId: 'call_pending',
  success: false,
  pendingApproval: true,
};
const successOutcome = {
  toolName: 'file_write',
  toolCallId: 'call_ok',
  success: true,
};

describe('2026-11-08：resumeSuspendedSteps 清理待审批证据', () => {
  it('挂起步骤恢复 ⇒ 去掉 pending 条目并清零计数（不再"复活"）', () => {
    const plan = makePlan({
      decision: 'suspend',
      toolOutcomes: {
        outcomes: [pendingOutcome, successOutcome] as never,
        total: 2,
        successCount: 1,
        failedCount: 0,
        securityIntercepted: 0,
        pendingApproval: 1,
      },
    });

    const resumed = resumeSuspendedSteps(plan);

    expect(resumed).toEqual(['step_1']);
    expect(plan.steps[0]?.decision).toBeUndefined();
    const outcomes = plan.steps[0]?.toolOutcomes;
    expect(outcomes?.pendingApproval).toBe(0);
    expect(outcomes?.total).toBe(1);
    // 成功证据保留，pending 条目作废
    expect(outcomes?.outcomes.map((o) => o.toolCallId)).toEqual(['call_ok']);
    expect(outcomes?.successCount).toBe(1);
  });

  it('非挂起步骤不动（避免误清审批阻塞判据）', () => {
    const plan = makePlan({
      toolOutcomes: {
        outcomes: [pendingOutcome] as never,
        total: 1,
        successCount: 0,
        failedCount: 0,
        securityIntercepted: 0,
        pendingApproval: 1,
      },
    });

    expect(resumeSuspendedSteps(plan)).toEqual([]);
    expect(plan.steps[0]?.toolOutcomes?.pendingApproval).toBe(1);
    expect(plan.steps[0]?.toolOutcomes?.outcomes).toHaveLength(1);
  });
});
