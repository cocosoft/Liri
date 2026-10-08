/**
 * 模板执行入口（P0-2(a)）测试 —— `runWorkflowTemplate` 四态归一
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md` §7 P0-2 选项 (a)
 * （`POST /v1/workflows/templates/:id/run`）。
 *
 * 纯逻辑 + 依赖注入 ⇒ 用桩覆盖四态（`not-found` / `not-executable` / `completed` / `failed`），
 * 并锁定"传给 seam 的是**派生名** `template:<id>`"。
 */
import { describe, expect, it } from 'bun:test';
import { runWorkflowTemplate } from '../../src/workspace/workflowTemplateRunner';
import { templateWorkflowName } from '../../src/workspace/workflowTemplateAssembly';
import type { WorkflowTemplate, WorkflowStep } from '../../src/workspace/types';

function step(id: string, tool?: string): WorkflowStep {
  return {
    id,
    name: id,
    description: `步骤 ${id}`,
    type: 'auto',
    ...(tool ? { tool } : {}),
  };
}

function template(id: string, steps: WorkflowStep[]): WorkflowTemplate {
  return {
    id,
    name: id,
    description: `模板 ${id}`,
    category: 'custom',
    steps,
    author: 'user',
    isPublic: false,
    usageCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('runWorkflowTemplate：四态归一', () => {
  it('模板不存在 ⇒ not-found（不触碰 seam）', async () => {
    let executed = 0;
    const outcome = await runWorkflowTemplate(
      'nope',
      {},
      {
        getTemplate: async () => null,
        execute: async () => {
          executed++;
          return { stopReason: 'completed', completedSteps: [] };
        },
      }
    );

    expect(outcome).toEqual({ kind: 'not-found' });
    expect(executed).toBe(0);
  });

  it('步骤未全部声明 tool ⇒ not-executable（不触碰 seam）', async () => {
    let executed = 0;
    const outcome = await runWorkflowTemplate(
      't1',
      {},
      {
        getTemplate: async () =>
          template('t1', [step('a', 'read:only'), step('b')]),
        execute: async () => {
          executed++;
          return { stopReason: 'completed', completedSteps: [] };
        },
      }
    );

    expect(outcome.kind).toBe('not-executable');
    expect(executed).toBe(0);
  });

  it('可执行 ⇒ 以**派生名** `template:<id>` 交 seam；completed 直接透出', async () => {
    const seen: Array<{ name: string; params: Record<string, unknown> }> = [];
    const outcome = await runWorkflowTemplate(
      't1',
      { topic: 'x' },
      {
        getTemplate: async () => template('t1', [step('a', 'read:only')]),
        execute: async (name, params) => {
          seen.push({ name, params });
          return {
            stopReason: 'completed',
            completedSteps: ['a'],
            value: { steps: ['a'] },
          };
        },
      }
    );

    expect(seen).toEqual([
      { name: templateWorkflowName('t1'), params: { topic: 'x' } },
    ]);
    expect(outcome).toEqual({
      kind: 'completed',
      completedSteps: ['a'],
      value: { steps: ['a'] },
    });
  });

  it('seam 返回 error ⇒ failed（透出 stopReason / completedSteps / error）', async () => {
    const outcome = await runWorkflowTemplate(
      't1',
      {},
      {
        getTemplate: async () => template('t1', [step('a', 'read:only')]),
        execute: async () => ({
          stopReason: 'error',
          completedSteps: [],
          error: '权限策略拒绝：仅允许非破坏性工具',
        }),
      }
    );

    expect(outcome).toEqual({
      kind: 'failed',
      stopReason: 'error',
      completedSteps: [],
      error: '权限策略拒绝：仅允许非破坏性工具',
    });
  });

  it('seam 返回 cancelled ⇒ failed（stopReason=cancelled）', async () => {
    const outcome = await runWorkflowTemplate(
      't1',
      {},
      {
        getTemplate: async () => template('t1', [step('a', 'read:only')]),
        execute: async () => ({
          stopReason: 'cancelled',
          completedSteps: [],
          error: '运行在步骤边界被取消',
        }),
      }
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.stopReason).toBe('cancelled');
    }
  });

  it('seam 未给 error 文案 ⇒ 回退为派生名提示（不产出空 error）', async () => {
    const outcome = await runWorkflowTemplate(
      't1',
      {},
      {
        getTemplate: async () => template('t1', [step('a', 'read:only')]),
        execute: async () => ({ stopReason: 'error', completedSteps: [] }),
      }
    );

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.error).toContain(templateWorkflowName('t1'));
    }
  });
});
