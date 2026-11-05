/**
 * 编排层 no-progress 熔断（2026-11-05）
 *
 * 真机事故（`app.log` 23:31–23:36）：PDCA 同一步骤连续两轮产出**完全相同**的失败证据
 * （同一份 review issues、没有新增产物、工具成败计数一致），`decideStep` 仍按普通 retry
 * 消耗重试预算（默认 3 次），把同一个大编辑再跑一遍 ⇒ 空转。
 *
 * 本片锁住三条契约：
 *  ① 连续两轮证据完全一致 ⇒ 第二次 retry 直接 escalate（不再增加 retryCount，触发增量 replan）；
 *  ② 只要有任何进展（分数变化 / 新增产物 / 工具计数变化）⇒ 走正常 retry；
 *  ③ 证据缺失（无 toolOutcomes 且无 artifacts）⇒ 不启用熔断，避免误伤旧路径。
 */
import { describe, expect, it } from 'bun:test';
import { decideStep } from '../../src/tasks/lro/stepReviewDecide';
import type { StepReviewDecideDeps } from '../../src/tasks/lro/stepReviewDecide';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';
import type { AgentIsolation } from '../../src/agent/AgentIsolation';
import type { PlanReview } from '../../src/tasks/PlanReview';
import type { ToolOutcomeSummary } from '../../src/tasks/lro/stepHelpers';

function review(score: number): PlanReview {
  return {
    stepId: 'step-1',
    pass: false,
    score,
    issues: [{ severity: 'critical', description: '章节未写入' }],
    summary: '',
    reviewedAt: 1,
  };
}

function outcomes(failed: number): ToolOutcomeSummary {
  return {
    outcomes: [],
    total: failed,
    successCount: 0,
    failedCount: failed,
    securityIntercepted: 0,
    pendingApproval: 0,
  };
}

function makeStep(id: string, overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id,
    description: '补 docs/PRD.md 的验收章节',
    status: 'completed',
    taskId: 'task-np',
    retryCount: 1,
    maxRetries: 3,
    reviewResult: review(20),
    toolOutcomes: outcomes(1),
    artifacts: [],
    ...overrides,
  };
}

function makeDeps(step: PlanStep) {
  const plan: Plan = {
    id: 'plan-np',
    description: 'no-progress test plan',
    steps: [step],
    status: 'running',
    createdAt: new Date(0).toISOString(),
    sessionId: 'session-np',
  };
  const escalations: PlanStep[] = [];
  const deps: StepReviewDecideDeps = {
    taskId: 'task-np',
    planId: plan.id,
    sessionId: plan.sessionId,
    isolation: {
      abortController: new AbortController(),
    } as unknown as AgentIsolation,
    executor: (async () => undefined) as never,
    verifier: {} as never,
    reviewGate: {} as never,
    getPlan: () => plan,
    recordLifecycle: () => {},
    recordEscalation: async (s) => {
      escalations.push(s);
    },
    previousStepDurationMs: () => undefined,
  };
  return { deps, plan, escalations };
}

describe('decideStep no-progress 熔断', () => {
  it('连续两轮证据一致 ⇒ 第二次 retry 直接 escalate，不再消耗重试', async () => {
    const step = makeStep('step-identical');
    const { deps, escalations } = makeDeps(step);

    // 第 1 轮结束：普通 retry（记录指纹，retryCount 1 → 2）
    await decideStep(step.id, 'retry', deps);
    expect(step.status).toBe('pending');
    expect(step.retryCount).toBe(2);

    // 第 2 轮结束：证据与上一轮完全相同（reviewResult 被上一轮清空，这里重新写入同一份）
    step.status = 'completed';
    step.reviewResult = review(20);

    await decideStep(step.id, 'retry', deps);

    expect(step.decision).toBe('escalate');
    expect(step.status).toBe('failed');
    expect(step.error).toContain('No progress');
    expect(step.retryCount).toBe(2); // 熔断不再增加重试计数
    expect(escalations).toHaveLength(1);
  });

  it('有任何进展（新增产物）⇒ 正常 retry，不熔断', async () => {
    const step = makeStep('step-progress');
    const { deps, escalations } = makeDeps(step);

    await decideStep(step.id, 'retry', deps);
    expect(step.retryCount).toBe(2);

    step.status = 'completed';
    step.reviewResult = review(20);
    step.artifacts = ['docs/PRD.md#section-8.1'];

    await decideStep(step.id, 'retry', deps);

    expect(step.status).toBe('pending');
    expect(step.retryCount).toBe(3);
    expect(escalations).toHaveLength(0);
  });

  it('证据缺失（无 toolOutcomes / artifacts）⇒ 不启用熔断', async () => {
    const step = makeStep('step-no-evidence', {
      toolOutcomes: undefined,
      artifacts: undefined,
    });
    const { deps, escalations } = makeDeps(step);

    await decideStep(step.id, 'retry', deps);
    step.status = 'completed';
    step.reviewResult = review(20);
    await decideStep(step.id, 'retry', deps);

    expect(step.status).toBe('pending');
    expect(step.retryCount).toBe(3);
    expect(escalations).toHaveLength(0);
  });
});
