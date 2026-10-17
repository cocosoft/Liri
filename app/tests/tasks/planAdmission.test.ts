// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-04（2026-10-17）：PDCA 计划准入与停滞判定守卫。
 */
import { describe, it, expect } from 'bun:test';
import {
  validatePlanAdmission,
  computeProgressFingerprint,
  shouldStopForStall,
  DEFAULT_MAX_PLAN_STEPS,
} from '../../src/tasks/planAdmission.js';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator.js';

function step(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: 's1',
    description: '步骤1',
    status: 'pending',
    taskId: 't1',
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

function plan(steps: PlanStep[], overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    description: '测试计划',
    steps,
    status: 'pending',
    createdAt: new Date().toISOString(),
    sessionId: 'sess-1',
    ...overrides,
  };
}

describe('validatePlanAdmission', () => {
  it('正常计划通过', () => {
    expect(validatePlanAdmission(plan([step()])).ok).toBe(true);
  });

  it('空步骤拒绝', () => {
    const result = validatePlanAdmission(plan([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-steps');
  });

  it('超过步骤上限拒绝', () => {
    const steps = Array.from({ length: DEFAULT_MAX_PLAN_STEPS + 1 }, (_, i) =>
      step({ id: `s${i}`, description: `步骤${i}` })
    );
    const result = validatePlanAdmission(plan(steps));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('too-many-steps');
  });

  it('空描述拒绝', () => {
    const result = validatePlanAdmission(plan([step({ description: '  ' })]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('empty-step-description');
  });

  it('依赖未知 id 拒绝', () => {
    const result = validatePlanAdmission(
      plan([step({ id: 's1', dependsOn: ['missing'] })])
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('depends-on-unknown');
  });

  it('依赖自身/前向引用拒绝', () => {
    const self = validatePlanAdmission(
      plan([step({ id: 's1', dependsOn: ['s1'] })])
    );
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.reason).toContain('depends-on-self-or-forward');

    const forward = validatePlanAdmission(
      plan([
        step({ id: 's1', dependsOn: ['s2'] }),
        step({ id: 's2', description: '步骤2' }),
      ])
    );
    expect(forward.ok).toBe(false);
  });

  it('前序依赖通过', () => {
    const result = validatePlanAdmission(
      plan([
        step({ id: 's1' }),
        step({ id: 's2', description: '步骤2', dependsOn: ['s1'] }),
      ])
    );
    expect(result.ok).toBe(true);
  });
});

describe('computeProgressFingerprint / shouldStopForStall', () => {
  it('状态变化会改变指纹', () => {
    const a = computeProgressFingerprint(plan([step()]));
    const b = computeProgressFingerprint(
      plan([step({ status: 'completed', result: 'ok' })])
    );
    expect(a).not.toBe(b);
  });

  it('连续相同指纹达到阈值 ⇒ 停止', () => {
    const fp = computeProgressFingerprint(plan([step()]));
    expect(shouldStopForStall(fp, fp, 2, 3)).toBe(false);
    expect(shouldStopForStall(fp, fp, 3, 3)).toBe(true);
  });

  it('指纹变化 ⇒ 不停止', () => {
    const a = computeProgressFingerprint(plan([step()]));
    const b = computeProgressFingerprint(plan([step({ retryCount: 1 })]));
    expect(shouldStopForStall(a, b, 5, 3)).toBe(false);
  });
});
