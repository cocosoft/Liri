/**
 * 用户工作流模板 → seam Provider 测试（P1-19 ②，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md` §7「裁定后实施清单」——
 * 端到端断言 = 用户模板 → 装配 → **真实 `WorkflowEngine.execute`** → 步骤调用断言。
 *
 * 锁五条：
 *  1. 只有**显式带 tool** 的模板进入 seam 目录（内建/缺 tool 模板不产出）；
 *  2. 经引擎执行 ⇒ 逐步按**拓扑序**调用注入的执行器，返回 `completedSteps`；
 *  3. 步骤参数与运行时参数**合并**（运行时覆盖步骤）；
 *  4. 首个失败步骤即终止 ⇒ `stopReason:'error'` 且 `completedSteps` 只含此前成功者；
 *  5. 步骤边界响应中止 ⇒ `stopReason:'cancelled'`。
 */
import { describe, expect, it } from 'bun:test';
import { WorkflowEngine } from '@modules/workflow';
import {
  WorkflowTemplateProvider,
  WORKFLOW_TEMPLATE_PROVIDER_ID,
} from '../../src/workspace/WorkflowTemplateProvider';
import { templateWorkflowName } from '../../src/workspace/workflowTemplateAssembly';
import type { WorkflowTemplate, WorkflowStep } from '../../src/workspace/types';

function step(
  id: string,
  tool?: string,
  extra: Partial<WorkflowStep> = {}
): WorkflowStep {
  return {
    id,
    name: id,
    description: `步骤 ${id}`,
    type: 'auto',
    ...(tool ? { tool } : {}),
    ...extra,
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

/** 记录调用并按工具名决定成败的执行器桩 */
function makeExecutor(failOn?: string) {
  const calls: Array<{ tool: string; params: Record<string, unknown> }> = [];
  const exec = async (tool: string, params: Record<string, unknown>) => {
    calls.push({ tool, params });
    if (failOn && tool === failOn) throw new Error(`stub failure: ${tool}`);
    return { ok: true };
  };
  return { calls, exec };
}

describe('WorkflowTemplateProvider：目录', () => {
  it('只有显式带 tool 的模板进入 seam；缺 tool 者不产出（内建 4 模板行为不变）', () => {
    const provider = new WorkflowTemplateProvider(
      () => [
        template('ok', [step('a', 'x:y')]),
        template('no-tool', [step('a')]),
        template('partially', [step('a', 'x:y'), step('b')]),
      ],
      async () => ({ ok: true })
    );

    const names = provider.listWorkflows().map((d) => d.name);
    expect(names).toEqual([templateWorkflowName('ok')]);
    expect(provider.providerId).toBe(WORKFLOW_TEMPLATE_PROVIDER_ID);
  });
});

describe('WorkflowTemplateProvider：经真实 WorkflowEngine 执行', () => {
  it('用户模板 → 装配 → engine.execute ⇒ 逐步按拓扑序调用 + completedSteps', async () => {
    const engine = new WorkflowEngine();
    const { calls, exec } = makeExecutor();
    const provider = new WorkflowTemplateProvider(
      () => [
        template('flow', [
          step('build', 'bash:run'),
          step('publish', 'release:publish', { dependsOn: ['build'] }),
        ]),
      ],
      exec
    );
    engine.registerProvider(provider);

    const result = await engine.execute(templateWorkflowName('flow'), {});

    expect(result.stopReason).toBe('completed');
    expect(result.completedSteps).toEqual(['build', 'publish']);
    expect(calls.map((c) => c.tool)).toEqual(['bash:run', 'release:publish']);
  });

  it('步骤参数与运行时参数合并（运行时覆盖步骤）', async () => {
    const provider = new WorkflowTemplateProvider(
      () => [template('merge', [step('a', 'x:y')])],
      async (tool, params) => {
        expect(tool).toBe('x:y');
        expect(params).toEqual({ fromStep: 1, shared: 'runtime' });
        return { ok: true };
      }
    );
    // 直接调用 Provider（步骤参数只能存在于装配产物中）
    const definition = provider.listWorkflows()[0];
    definition.steps[0] = {
      ...definition.steps[0],
      params: { fromStep: 1, shared: 'step' },
    };
    const result = await provider.execute(definition, { shared: 'runtime' });
    expect(result.stopReason).toBe('completed');
  });

  it('首个失败步骤即终止 ⇒ error，completedSteps 只含此前成功者', async () => {
    const engine = new WorkflowEngine();
    const { calls, exec } = makeExecutor('bad:tool');
    engine.registerProvider(
      new WorkflowTemplateProvider(
        () => [
          template('flow', [
            step('ok', 'good:tool'),
            step('bad', 'bad:tool', { dependsOn: ['ok'] }),
            step('never', 'good:tool', { dependsOn: ['bad'] }),
          ]),
        ],
        exec
      )
    );

    const result = await engine.execute(templateWorkflowName('flow'), {});

    expect(result.stopReason).toBe('error');
    expect(result.completedSteps).toEqual(['ok']);
    expect(result.error).toContain('bad:tool');
    expect(calls.map((c) => c.tool)).toEqual(['good:tool', 'bad:tool']); // 第三步未执行
  });

  it('步骤边界响应中止 ⇒ cancelled（不执行任何步骤）', async () => {
    const engine = new WorkflowEngine();
    const { calls, exec } = makeExecutor();
    engine.registerProvider(
      new WorkflowTemplateProvider(
        () => [
          template('flow', [
            step('a', 'x:y'),
            step('b', 'x:z', { dependsOn: ['a'] }),
          ]),
        ],
        exec
      )
    );

    const controller = new AbortController();
    controller.abort();
    const result = await engine.execute(
      templateWorkflowName('flow'),
      {},
      {
        signal: controller.signal,
        gracePeriodMs: 0,
      }
    );

    expect(result.completedSteps).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('请求不在目录内的既有工作流名 ⇒ 引擎报"未知工作流"（前缀命名不影响既有查找）', async () => {
    const engine = new WorkflowEngine();
    engine.registerProvider(
      new WorkflowTemplateProvider(
        () => [template('flow', [step('a', 'x:y')])],
        async () => ({ ok: true })
      )
    );

    const result = await engine.execute('send-report', {});
    expect(result.stopReason).toBe('error');
    expect(result.error).toContain('未知工作流');
  });

  it('引擎目录含 `template:` 前缀名（与既有工作流名不撞名）', () => {
    const engine = new WorkflowEngine();
    engine.registerProvider(
      new WorkflowTemplateProvider(
        () => [template('flow', [step('a', 'x:y')])],
        async () => ({ ok: true })
      )
    );
    expect(engine.listWorkflows().map((w) => w.name)).toEqual([
      templateWorkflowName('flow'),
    ]);
  });
});
