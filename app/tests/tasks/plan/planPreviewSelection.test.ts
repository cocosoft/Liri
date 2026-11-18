// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * D7 二期：`/plan preview` 的计划选择（确定性）。
 *
 * 锁定语义：
 * - 指定 planId：精确优先，其次唯一前缀；多命中 ⇒ ambiguous（命令侧报错，不猜）；
 * - 未指定：本会话内**优先未终态**计划，其次按最近心跳倒序；
 * - 无候选 ⇒ 空结果（命令侧如实提示）。
 */

import { describe, expect, it } from 'bun:test';
import type { Plan, PlanStep } from '../../../src/tasks/TaskOrchestrator';
import { selectPlanForPreview } from '../../../src/tasks/plan/planPreviewSelection';

function step(): PlanStep {
  return {
    id: 'step_1',
    description: '步骤',
    status: 'pending',
    taskId: 'task_1',
    retryCount: 0,
    maxRetries: 3,
  };
}

function plan(over: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_a',
    description: '目标',
    status: 'running',
    createdAt: '2026-11-14T09:00:00.000Z',
    sessionId: 'sess_1',
    steps: [step()],
    ...over,
  };
}

describe('selectPlanForPreview', () => {
  it('未指定 planId ⇒ 优先未终态（即使旧于已完成计划）', () => {
    const plans = [
      plan({
        id: 'plan_done',
        status: 'completed',
        lastHeartbeatAt: '2026-11-14T12:00:00.000Z',
      }),
      plan({
        id: 'plan_open',
        status: 'running',
        lastHeartbeatAt: '2026-11-14T10:00:00.000Z',
      }),
    ];
    expect(selectPlanForPreview(plans, { sessionId: 'sess_1' }).plan?.id).toBe(
      'plan_open'
    );
  });

  it('全部终态 ⇒ 取最近心跳', () => {
    const plans = [
      plan({
        id: 'old',
        status: 'completed',
        lastHeartbeatAt: '2026-11-14T09:00:00.000Z',
      }),
      plan({
        id: 'new',
        status: 'aborted',
        lastHeartbeatAt: '2026-11-14T11:00:00.000Z',
      }),
    ];
    expect(selectPlanForPreview(plans, { sessionId: 'sess_1' }).plan?.id).toBe(
      'new'
    );
  });

  it('指定 id：精确优先；唯一前缀命中；多命中 ⇒ ambiguous', () => {
    const plans = [
      plan({ id: 'plan_ab', sessionId: 'sess_1' }),
      plan({ id: 'plan_ac', sessionId: 'sess_1' }),
    ];
    expect(selectPlanForPreview(plans, { planId: 'plan_ab' }).plan?.id).toBe(
      'plan_ab'
    );
    expect(selectPlanForPreview(plans, { planId: 'plan_ab' }).plan?.id).toBe(
      'plan_ab'
    );
    expect(selectPlanForPreview(plans, { planId: 'plan_a' }).ambiguous).toEqual(
      ['plan_ab', 'plan_ac']
    );
    expect(
      selectPlanForPreview(plans, { planId: 'nope' }).plan
    ).toBeUndefined();
  });

  it('会话过滤 + 无候选 ⇒ 空结果', () => {
    const plans = [plan({ id: 'other', sessionId: 'sess_other' })];
    expect(
      selectPlanForPreview(plans, { sessionId: 'sess_1' }).plan
    ).toBeUndefined();
    expect(selectPlanForPreview([]).plan).toBeUndefined();
  });
});
