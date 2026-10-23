// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * PR-5（2026-10-23）：审查门读**结构化工具结果**回归锁。
 *
 * 锁三条：
 *   ① `success=false` ⇒ 直接构成阻塞 issue（不依赖 Reviewer 是否看出来）；
 *   ② 有工具在等审批 ⇒ 决策 `suspend`（**不得** retry/escalate —— 等审批 ≠ 未达成）；
 *   ③ 待审批不冒充"失败"：不产生失败类阻塞 issue。
 */

import { describe, it, expect } from 'bun:test';
import { DefaultReviewGate } from '../../src/tasks/review/ReviewGate.js';
import type { ReviewGateContext } from '../../src/tasks/review/ReviewGate.js';
import type { PlanStep } from '../../src/tasks/TaskOrchestrator.js';
import type { ToolOutcomeSummary } from '../../src/tasks/lro/stepHelpers.js';

function stepWith(
  toolOutcomes?: ToolOutcomeSummary,
  reviewResult?: PlanStep['reviewResult']
): PlanStep {
  return {
    id: 'step-1',
    description: '写一个文件并读回',
    status: 'completed',
    taskId: 'task-1',
    retryCount: 0,
    maxRetries: 3,
    acceptanceCriteria: '文件存在且内容为 hello',
    ...(toolOutcomes ? { toolOutcomes } : {}),
    ...(reviewResult ? { reviewResult } : {}),
  };
}

const summary = (
  overrides: Partial<ToolOutcomeSummary>
): ToolOutcomeSummary => ({
  outcomes: [],
  total: 0,
  successCount: 0,
  failedCount: 0,
  securityIntercepted: 0,
  pendingApproval: 0,
  ...overrides,
});

/** 只测纯逻辑：关掉机械验证与 Verifier（审查员文本由 executor 桩给出） */
function makeGate(): DefaultReviewGate {
  return new DefaultReviewGate({
    enableMechanicalVerify: false,
    enableVerifier: false,
  });
}

function ctxFor(
  step: PlanStep,
  executor: ReviewGateContext['executor']
): ReviewGateContext {
  return {
    taskId: 'task-1',
    planId: 'plan-1',
    step,
    isolation: {} as never,
    executor,
    verifier: {} as never,
  };
}

describe('PR-5：审查门读 toolOutcomes', () => {
  it('success=false ⇒ 阻塞 issue + pass=false（即便 Reviewer 自述通过）', async () => {
    const gate = makeGate();
    const step = stepWith(
      summary({
        total: 1,
        failedCount: 1,
        outcomes: [
          {
            toolName: 'file_write',
            success: false,
            error: '缺少必填参数 file_path',
            securityIntercepted: false,
            pendingApproval: false,
          },
        ],
      })
    );
    const executor = (async () => ({
      content: '{"pass":true,"score":95,"issues":[],"summary":"看起来完成了"}',
    })) as never;

    const review = await gate.reviewStep(ctxFor(step, executor));
    expect(review.pass).toBe(false);
    expect(
      review.issues.some(
        (i) => i.severity === 'major' && i.description.includes('工具调用失败')
      )
    ).toBe(true);
  });

  it('待审批 ⇒ 决策 suspend（不是 retry/escalate）', async () => {
    const gate = makeGate();
    const step = stepWith(
      summary({
        total: 1,
        pendingApproval: 1,
        outcomes: [
          {
            toolName: 'bash',
            success: false,
            securityIntercepted: false,
            pendingApproval: true,
          },
        ],
      }),
      {
        stepId: 'step-1',
        pass: false,
        score: 10,
        issues: [],
        summary: '未产出',
        reviewedAt: Date.now(),
      }
    );
    const decision = await gate.decide(
      ctxFor(step, (async () => ({})) as never)
    );
    expect(decision).toBe('suspend');
  });

  it('无待审批 ⇒ 按原口径决策（未过 + 未超重试 ⇒ retry）', async () => {
    const gate = makeGate();
    const step = stepWith(undefined, {
      stepId: 'step-1',
      pass: false,
      score: 30,
      issues: [],
      summary: '未达成',
      reviewedAt: Date.now(),
    });
    const decision = await gate.decide(
      ctxFor(step, (async () => ({})) as never)
    );
    expect(decision).toBe('retry');
  });

  it('待审批不产生"工具调用失败"阻塞 issue（不冒充失败）', async () => {
    const gate = makeGate();
    const step = stepWith(
      summary({
        total: 1,
        pendingApproval: 1,
        outcomes: [
          {
            toolName: 'bash',
            success: false,
            securityIntercepted: false,
            pendingApproval: true,
          },
        ],
      })
    );
    const executor = (async () => ({
      content: '{"pass":true,"score":80,"issues":[],"summary":"等审批中"}',
    })) as never;
    const review = await gate.reviewStep(ctxFor(step, executor));
    expect(
      review.issues.some((i) => i.description.includes('工具调用失败'))
    ).toBe(false);
  });
});
