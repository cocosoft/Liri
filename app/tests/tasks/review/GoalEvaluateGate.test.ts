/**
 * GoalEvaluateGate 目标级收敛判定测试（P1-3，对标 Hermes evaluate_after_turn）
 *
 * 覆盖：
 * - 副模型返回 converged=true → 判定收敛
 * - 副模型返回 converged=false → 判定未收敛（阻止假完成）
 * - executor 抛错 → 降级放行（converged=true, evaluated=false，不阻塞主流程）
 * - 输出非 JSON → 解析降级放行
 * - isGoalEvaluateEnabled 默认启用
 */
import { describe, test, expect } from 'bun:test';
import {
  GoalEvaluateGate,
  isGoalEvaluateEnabled,
} from '../../../src/tasks/review/GoalEvaluateGate';
import type { GoalEvaluateContext } from '../../../src/tasks/review/GoalEvaluateGate';
import type { AgentIsolation } from '@modules/agent';

const gate = new GoalEvaluateGate();

function fakeContext(
  executor: GoalEvaluateContext['executor']
): GoalEvaluateContext {
  return {
    isolation: {
      abortController: new AbortController(),
    } as unknown as AgentIsolation,
    executor,
  };
}

const input = {
  goal: '实现 worktree 隔离闭环',
  steps: [
    {
      description: '创建 worktree',
      status: 'completed',
      result: 'done',
      review: '通过',
    },
    {
      description: '回灌 diff',
      status: 'completed',
      result: 'done',
      review: '通过',
    },
  ],
};

describe('GoalEvaluateGate（P1-3）', () => {
  test('副模型判定已收敛 → converged=true', async () => {
    const ctx = fakeContext(async () =>
      JSON.stringify({ converged: true, confidence: 0.9, reason: '目标已实现' })
    );
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(true);
    expect(r.converged).toBe(true);
    expect(r.confidence).toBe(0.9);
    expect(r.reason).toBe('目标已实现');
  });

  test('副模型判定未收敛 → converged=false（阻止假完成）', async () => {
    const ctx = fakeContext(async () =>
      JSON.stringify({
        converged: false,
        confidence: 0.3,
        reason: '步骤完成但输出未实现目标',
      })
    );
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(true);
    expect(r.converged).toBe(false);
  });

  test('executor 抛错 → 降级放行（converged=true, evaluated=false）', async () => {
    const ctx = fakeContext(async () => {
      throw new Error('model unavailable');
    });
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(false);
    expect(r.converged).toBe(true); // 不阻塞主流程
  });

  test('输出非 JSON → 解析降级放行', async () => {
    const ctx = fakeContext(async () => '模型只返回了文本，没有 JSON');
    const r = await gate.evaluate(input, ctx);
    expect(r.evaluated).toBe(true);
    expect(r.converged).toBe(true);
  });

  test('isGoalEvaluateEnabled 默认启用（未配置环境变量时）', () => {
    expect(isGoalEvaluateEnabled()).toBe(true);
  });
});
