// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D3 二期：既有计划 → 可执行投影（系统级续跑的执行器输入）。
 *
 * 锁定语义：
 * - **只重做未终态步骤**（pending/running → pending）；completed → completed；failed/cancelled → skipped；
 * - 步骤 id 与依赖 id **原样保留**（执行器靠它把进度写回同一份计划台账）；
 * - 无未终态步骤 ⇒ 不可续跑（调用方回退既有路径，不假装续跑）。
 */

import { describe, expect, it } from 'bun:test';
import type { Plan, PlanStep } from '../../../src/tasks/TaskOrchestrator';
import {
  buildResumeDecomposition,
  isPlanResumableByExecutor,
  projectPlanStepForResume,
} from '../../../src/tasks/plan/planResumeExecution';

function step(over: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 'step_1',
    description: '做第一步',
    status: 'completed',
    taskId: 'task_1',
    retryCount: 0,
    maxRetries: 3,
    ...over,
  };
}

function plan(steps: PlanStep[]): Plan {
  return {
    id: 'plan_a',
    description: '计划描述',
    status: 'running',
    createdAt: '2026-11-14T09:00:00.000Z',
    sessionId: 'sess_1',
    steps,
  };
}

describe('projectPlanStepForResume', () => {
  it('completed → completed；failed/cancelled → skipped；pending/running → pending', () => {
    expect(projectPlanStepForResume(step())).toBe('completed');
    expect(projectPlanStepForResume(step({ status: 'failed' }))).toBe(
      'skipped'
    );
    expect(projectPlanStepForResume(step({ status: 'cancelled' }))).toBe(
      'skipped'
    );
    expect(projectPlanStepForResume(step({ status: 'pending' }))).toBe(
      'pending'
    );
    expect(projectPlanStepForResume(step({ status: 'running' }))).toBe(
      'pending'
    );
  });
});

describe('isPlanResumableByExecutor', () => {
  it('有未终态步骤 ⇒ true；全终态 ⇒ false', () => {
    expect(
      isPlanResumableByExecutor(
        plan([step(), step({ id: 'step_2', status: 'pending' })])
      )
    ).toBe(true);
    expect(
      isPlanResumableByExecutor(
        plan([
          step(),
          step({ id: 'step_2', status: 'failed' }),
          step({ id: 'step_3', status: 'cancelled' }),
        ])
      )
    ).toBe(false);
  });
});

describe('buildResumeDecomposition', () => {
  it('保留步骤 id / 依赖 id，并携带结果与验收标准', () => {
    const decomposition = buildResumeDecomposition(
      plan([
        step({ result: '已完成产出' }),
        step({
          id: 'step_2',
          description: '替换变量',
          status: 'pending',
          dependsOn: ['step_1'],
          acceptanceCriteria: 'file_read 返回包含 THEME',
        }),
      ])
    );

    expect(decomposition.mainTier).toBe('medium');
    expect(decomposition.reasoning).toContain('plan_a');
    expect(decomposition.subTasks.map((t) => t.id)).toEqual([
      'step_1',
      'step_2',
    ]);
    expect(decomposition.subTasks[0]).toMatchObject({
      status: 'completed',
      result: '已完成产出',
    });
    expect(decomposition.subTasks[1]).toMatchObject({
      status: 'pending',
      dependsOn: ['step_1'],
      acceptanceCriteria: 'file_read 返回包含 THEME',
    });
  });

  it('空步骤计划 ⇒ 抛错（调用方应先判定可续性）', () => {
    expect(() => buildResumeDecomposition(plan([]))).toThrow('没有步骤');
  });
});
