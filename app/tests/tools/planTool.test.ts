/**
 * 特征化测试：`PlanTool.execute` 的既有行为（P3-2 拆分前置）。
 *
 * 目的：在把 `execute` 的 execute 分支与单步执行原样外移为私有方法之前，
 * 先用测试锁住各 action 的外部可观测结果（消息文案、计划状态、执行明细、步骤顺序）。
 *
 * 覆盖范围刻意避开权限引擎分支（工具成功执行路径）：那需要完整
 * PermissionManager 装配，属另一层职责；此处只锁 PlanTool 自身的编排结果。
 */
import { describe, expect, it } from 'bun:test';
import { PlanTool } from '@openliri/tool-task';
import type {
  PlanData,
  PlanStep,
  PlanToolInput,
  PlanToolOutput,
} from '@openliri/tool-task';
import type {
  ToolResult,
  ToolUseContext,
  ToolProgressData,
} from '../../src/tools/types';

type ExecuteResult = ToolResult<PlanToolOutput>;

const CONTEXT = {} as unknown as ToolUseContext;

async function run(
  tool: PlanTool,
  input: PlanToolInput
): Promise<ExecuteResult> {
  return (await tool.execute(input, CONTEXT)) as ExecuteResult;
}

function step(partial: Partial<PlanStep> & { id: string }): PlanStep {
  return {
    name: partial.id,
    description: '',
    type: 'condition',
    params: {},
    ...partial,
  };
}

/** 建一个计划并返回其 id */
async function createPlan(
  tool: PlanTool,
  steps: PlanStep[],
  name = '计划 A'
): Promise<string> {
  const created = await run(tool, { action: 'create', name, steps });
  const planId = (created.data as PlanToolOutput).plan?.id;
  if (!planId) throw new Error('create 未返回 plan_id');
  return planId;
}

describe('PlanTool.execute 既有行为', () => {
  it('校验失败 ⇒ success=false 且 data.message 透出原因', async () => {
    const tool = new PlanTool();
    const res = await run(tool, { action: 'get' } as PlanToolInput);
    expect(res.success).toBe(false);
    expect((res.data as PlanToolOutput).message).toContain(
      'plan_id is required'
    );
  });

  it('create ⇒ 落库并可 get 回读', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1' })]);

    const got = (await run(tool, { action: 'get', plan_id: planId }))
      .data as PlanToolOutput;
    expect(got.success).toBe(true);
    expect(got.plan?.name).toBe('计划 A');
    expect(got.plan?.status).toBe('draft');
    expect(got.plan?.steps).toHaveLength(1);
  });

  it('list ⇒ 返回全部计划条数', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1' })], 'A');

    const listed = (await run(tool, { action: 'list' })).data as PlanToolOutput;
    expect(listed.plans).toHaveLength(1);
    expect(listed.plans?.[0].id).toBe(planId);
    expect(listed.message).toBe('Retrieved 1 plans');
  });

  it('get 不存在 ⇒ success=false + Plan not found', async () => {
    const tool = new PlanTool();
    const got = (await run(tool, { action: 'get', plan_id: 'nope' }))
      .data as PlanToolOutput;
    expect(got.success).toBe(false);
    expect(got.message).toBe('Plan not found: nope');
  });

  it('update ⇒ 覆盖给定字段并刷新 updated_at', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1' })]);
    const updated = (
      await run(tool, {
        action: 'update',
        plan_id: planId,
        name: '计划 B',
        status: 'active',
      })
    ).data as PlanToolOutput;

    expect(updated.success).toBe(true);
    expect(updated.plan?.name).toBe('计划 B');
    expect(updated.plan?.status).toBe('active');
    expect(updated.plan?.steps).toHaveLength(1);
  });

  it('delete ⇒ 删除后再 get 得到 not found', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1' })]);

    const deleted = (await run(tool, { action: 'delete', plan_id: planId }))
      .data as PlanToolOutput;
    expect(deleted.success).toBe(true);

    const got = (await run(tool, { action: 'get', plan_id: planId }))
      .data as PlanToolOutput;
    expect(got.message).toBe(`Plan not found: ${planId}`);
  });

  it('execute 不存在 ⇒ success=false + Plan not found', async () => {
    const tool = new PlanTool();
    const res = await run(tool, { action: 'execute', plan_id: 'nope' });
    expect(res.success).toBe(false);
    expect((res.data as PlanToolOutput).message).toBe('Plan not found: nope');
  });

  it('execute：condition 步骤跳过 ⇒ 计划置 completed', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({ id: 's1', name: '条件判断' }),
    ]);

    const out = (await run(tool, { action: 'execute', plan_id: planId }))
      .data as PlanToolOutput;
    expect(out.success).toBe(true);
    expect(out.message).toBe(`计划执行成功: ${planId}`);

    const exec = out.execution_result as {
      has_errors: boolean;
      steps: Array<{ step_id: string; status: string; result: unknown }>;
    };
    expect(exec.has_errors).toBe(false);
    expect(exec.steps[0].status).toBe('completed');
    expect(exec.steps[0].result).toMatchObject({ success: true });

    const got = (await run(tool, { action: 'get', plan_id: planId }))
      .data as PlanToolOutput;
    expect(got.plan?.status).toBe('completed');
  });

  it('execute：按依赖拓扑顺序执行（声明的逆序被打平）', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({ id: 's2', name: '第二步', dependencies: ['s1'] }),
      step({ id: 's1', name: '第一步' }),
    ]);

    const out = (await run(tool, { action: 'execute', plan_id: planId }))
      .data as PlanToolOutput;
    const exec = out.execution_result as {
      steps: Array<{ step_id: string }>;
    };
    expect(exec.steps.map((s) => s.step_id)).toEqual(['s1', 's2']);
  });

  it('execute：每步都回调 onProgress（文案带步骤名）', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({ id: 's1', name: '步骤一' }),
      step({ id: 's2', name: '步骤二' }),
    ]);

    const seen: string[] = [];
    await tool.execute({ action: 'execute', plan_id: planId }, CONTEXT, (p) => {
      const data = p.data as ToolProgressData & { value?: string };
      seen.push(data.value ?? '');
    });

    expect(seen).toEqual(['执行步骤: 步骤一', '执行步骤: 步骤二']);
  });

  it('execute：工具缺失 ⇒ 该步 failed、后续不再执行、计划置 active', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({ id: 's1', name: 'missing_tool', type: 'tool' }),
      step({ id: 's2', name: '步骤二' }),
    ]);

    const res = await run(tool, { action: 'execute', plan_id: planId });
    const out = res.data as PlanToolOutput;
    expect(res.success).toBe(false);
    expect(out.message).toBe(
      '计划执行部分完成，1 个步骤失败: 工具未找到: missing_tool'
    );

    const exec = out.execution_result as {
      has_errors: boolean;
      steps: Array<{ step_id: string; status: string; error?: string }>;
    };
    expect(exec.has_errors).toBe(true);
    expect(exec.steps).toHaveLength(1);
    expect(exec.steps[0]).toMatchObject({
      step_id: 's1',
      status: 'failed',
      error: '工具未找到: missing_tool',
    });

    const got = (await run(tool, { action: 'get', plan_id: planId }))
      .data as PlanToolOutput;
    expect(got.plan?.status).toBe('active');
  });

  it('execute：command 步骤缺 command 参数 ⇒ 该步 failed', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({ id: 's1', name: '命令步骤', type: 'command' }),
    ]);

    const out = (await run(tool, { action: 'execute', plan_id: planId }))
      .data as PlanToolOutput;
    expect(out.success).toBe(false);
    expect(out.message).toContain('命令步骤缺少 command 参数');
  });

  it('execute：无 bash 工具 ⇒ 该步 failed 且提示 Bash 工具未找到', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [
      step({
        id: 's1',
        name: '命令步骤',
        type: 'command',
        params: { command: 'echo hi' },
      }),
    ]);

    const out = (await run(tool, { action: 'execute', plan_id: planId }))
      .data as PlanToolOutput;
    expect(out.success).toBe(false);
    expect(out.message).toContain('Bash 工具未找到，无法执行命令');
  });

  it('execute 结果保留计划 id 与完成时间字段', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1' })]);
    const out = (await run(tool, { action: 'execute', plan_id: planId }))
      .data as PlanToolOutput;
    const exec = out.execution_result as {
      plan_id: string;
      completed_at: string;
    };
    expect(exec.plan_id).toBe(planId);
    expect(typeof exec.completed_at).toBe('string');
  });

  it('create 的计划可被 PlanData 类型消费（回归：出参结构未变）', async () => {
    const tool = new PlanTool();
    const planId = await createPlan(tool, [step({ id: 's1', name: 'S1' })]);
    const got = (await run(tool, { action: 'get', plan_id: planId }))
      .data as PlanToolOutput;
    const plan: PlanData = got.plan as PlanData;
    expect(plan.id).toBe(planId);
    expect(plan.created_at).toBe(plan.updated_at);
  });
});
