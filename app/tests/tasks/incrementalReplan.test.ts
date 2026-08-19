// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D5（M6，2026-08-13）：阶段回退增量 replan 测试
 * escalate 捕获缺陷清单 → 重开循环（executePlanPhase）注入增量 replan 指令
 * （基线 + 缺陷清单 → 仅修订受影响部分，不全盘重来）。
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import type { PlanReview } from '../../src/tasks/PlanReview';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';

// 隔离计划持久化目录：测试计划写入临时目录，避免污染用户数据（~/.pyapp/data/plans/）
taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-test-')));

type EscalationRecord = {
  stepId: string;
  stepDescription: string;
  defects: string[];
};

type OrchestratorWithPrivates = LongRunningTaskOrchestrator & {
  planId: string | null;
  _lastEscalations: EscalationRecord[];
};

describe('阶段回退增量 replan（D5/M6）', () => {
  it('escalate 时捕获缺陷清单（severity + description）', async () => {
    const o = new LongRunningTaskOrchestrator(
      `d5-test-${Date.now()}`,
      async () => 'mock'
    ) as unknown as OrchestratorWithPrivates;

    const plan = taskOrchestrator.createPlan('D5 测试任务', ['步骤A'], 's-d5');
    o.planId = plan.id;
    const step = plan.steps[0];
    taskOrchestrator.markStepRunning(step.id);
    step.reviewResult = {
      stepId: step.id,
      pass: false,
      score: 40,
      issues: [
        { severity: 'critical', description: '结算逻辑未覆盖边界' },
        { severity: 'major', description: '缺少异常分支' },
      ],
      summary: '审查未通过',
      reviewedAt: Date.now(),
    } as PlanReview;

    await o.decideStep(step.id, 'escalate');

    expect(o._lastEscalations.length).toBe(1);
    expect(o._lastEscalations[0].stepId).toBe(step.id);
    expect(o._lastEscalations[0].defects).toEqual([
      '[critical] 结算逻辑未覆盖边界',
      '[major] 缺少异常分支',
    ]);
  });

  it('重开循环注入增量 replan 指令（基线 + 缺陷清单）', async () => {
    const capturedPrompts: string[] = [];
    const o = new LongRunningTaskOrchestrator(
      `d5-replan-${Date.now()}`,
      async (params: { userPrompt: string }) => {
        capturedPrompts.push(params.userPrompt);
        return JSON.stringify({
          steps: ['修订后步骤'],
          acceptanceCriteria: ['修订后标准'],
        });
      }
    ) as unknown as OrchestratorWithPrivates;

    // 先制造一次 escalate
    const plan = taskOrchestrator.createPlan(
      'D5 重开测试',
      ['步骤B'],
      's-d5-r'
    );
    o.planId = plan.id;
    const step = plan.steps[0];
    taskOrchestrator.markStepRunning(step.id);
    step.reviewResult = {
      stepId: step.id,
      pass: false,
      score: 30,
      issues: [{ severity: 'critical', description: '性能瓶颈未优化' }],
      summary: '审查未通过',
      reviewedAt: Date.now(),
    } as PlanReview;
    await o.decideStep(step.id, 'escalate');

    // 重开循环 → PLAN prompt 含增量修订要求
    await o.executePlanPhase('D5 重开测试', 's-d5-r');

    expect(capturedPrompts.length).toBe(1);
    expect(capturedPrompts[0]).toContain('增量修订要求');
    expect(capturedPrompts[0]).toContain('上次失败步骤');
    expect(capturedPrompts[0]).toContain('[critical] 性能瓶颈未优化');
    expect(capturedPrompts[0]).toContain('仅针对上述缺陷重规划受影响步骤');
  });
});
