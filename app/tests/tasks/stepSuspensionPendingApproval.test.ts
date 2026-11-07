// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 2026-11-07 真机：PDCA 步骤里 bash 被 ask 挂起后，依赖步骤仍继续执行（基于未执行的产物空转）。
 * 批次调度据此在每批结束后停止启动后续批次。本用例锁住判据（只认显式 `pendingApproval`）。
 */
import { describe, expect, it } from 'bun:test';

import {
  hasPendingApproval,
  listStepsAwaitingApproval,
  shouldStopForPendingApproval,
} from '../../src/tasks/lro/stepSuspension';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';

function step(id: string, pendingApproval?: number): PlanStep {
  return {
    id,
    description: id,
    status: 'completed',
    retryCount: 0,
    maxRetries: 3,
    ...(pendingApproval === undefined
      ? {}
      : {
          toolOutcomes: {
            outcomes: [],
            total: 1,
            successCount: 0,
            failedCount: 0,
            securityIntercepted: 0,
            pendingApproval,
          },
        }),
  } as unknown as PlanStep;
}

function plan(steps: PlanStep[]): Plan {
  return { id: 'p1', description: 'd', steps, status: 'running' } as Plan;
}

describe('listStepsAwaitingApproval', () => {
  it('只挑出 pendingApproval > 0 的步骤', () => {
    const p = plan([step('a'), step('b', 1), step('c', 0), step('d', 2)]);
    expect(listStepsAwaitingApproval(p).map((s) => s.id)).toEqual(['b', 'd']);
    expect(hasPendingApproval(p)).toBe(true);
  });

  it('都没有待审批 ⇒ false（零行为变更）', () => {
    const p = plan([step('a'), step('b', 0)]);
    expect(listStepsAwaitingApproval(p)).toEqual([]);
    expect(hasPendingApproval(p)).toBe(false);
  });

  it('已判 suspend（decision）也算待审批', () => {
    const suspended = { ...step('a'), decision: 'suspend' } as PlanStep;
    expect(hasPendingApproval(plan([suspended]))).toBe(true);
  });
});

describe('shouldStopForPendingApproval', () => {
  it('有待审批 ⇒ batch/iteration 都返回 true（调度方据此 break）', () => {
    const p = plan([step('a', 1)]);
    expect(shouldStopForPendingApproval('batch', 't1', 'p1', p)).toBe(true);
    expect(shouldStopForPendingApproval('iteration', 't1', 'p1', p)).toBe(true);
  });

  it('无待审批 ⇒ false（零行为变更）', () => {
    const p = plan([step('a', 0)]);
    expect(shouldStopForPendingApproval('batch', 't1', 'p1', p)).toBe(false);
  });
});
