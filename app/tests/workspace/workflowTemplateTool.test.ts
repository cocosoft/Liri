/**
 * `workflow:run-template` 工具测试（P0-2 续，2026-10-08）
 *
 * 规格：`.trae/specs/workflow-template-execution-binding.md` §7（P0-2 / P0-3）。
 *
 * 锁四类：
 *  1. **可见性（N-44/N-45 回归锁）**：类别登记为 `assist`，且**wire 形态**（出站裁剪读的名字）
 *     同样解析到 `assist` ⇒ 在 `chat` / `default` / **`coding` / `agent`** 任务下**不被裁剪**
 *     （否则模型永远看不到；后两者为 2026-10-08 用户裁定放宽）；
 *  2. `list` / `run` 两动作的基本语义（含"未知 id ⇒ 回列可用清单"的动态目录处理）；
 *  3. `run` 的参数透传与结果归一（成功 / 未完成 / 抛异常）；
 *  4. 参数缺项与非法动作 ⇒ 明确 FAILURE（不静默）。
 */
import { describe, expect, it } from 'bun:test';
import { ToolExecutionStatus } from '@modules/tools/types/ToolResult';
import type { Tool, ToolUseContext } from '@modules/tools/types/Tool';
import {
  createWorkflowTemplateTool,
  WORKFLOW_TEMPLATE_TOOL_NAME,
  type WorkflowTemplateToolDeps,
} from '../../src/workspace/workflowTemplateTool';
import {
  filterToolsByTask,
  getToolCategory,
} from '../../src/tools/toolCategories';
import { toWireToolName } from '../../src/tools/toolNameCodec';

/** 最小上下文（本工具的 execute 只用 sessionId 透传给 seam；桩实现可忽略） */
const ctx = {
  sessionId: 'session_test_wf_template',
} as unknown as ToolUseContext;

/**
 * 工具返回形状**窄化 cast**（成功/失败两个分支字段不同；非 `any`，符合「新代码零 any」）。
 */
interface LooseToolResult {
  status: string;
  data: {
    success?: boolean;
    templates?: unknown[];
    completedSteps?: string[];
    error?: string;
  };
  output?: unknown;
  errorOutput?: unknown;
  metadata?: Record<string, unknown>;
}

async function runTool(
  tool: Tool,
  input: Record<string, unknown>
): Promise<LooseToolResult> {
  return (await tool.execute(input, ctx)) as unknown as LooseToolResult;
}

const BRIEFS = [
  {
    id: 't1',
    name: '发版流程',
    description: '打包 → 校验',
    steps: [
      { id: 'build', tool: 'bash:run', description: '打包' },
      { id: 'check', tool: 'grep', description: '校验' },
    ],
  },
];

function makeTool(overrides: Partial<WorkflowTemplateToolDeps> = {}) {
  const calls: Array<{ id: string; params: Record<string, unknown> }> = [];
  const tool = createWorkflowTemplateTool({
    listRunnableTemplates: () => BRIEFS,
    runTemplate: async (id, params) => {
      calls.push({ id, params });
      return {
        result: {
          stopReason: 'completed',
          completedSteps: ['build', 'check'],
          value: { steps: ['build', 'check'] },
        },
        workflowRun: { runId: 'run_1' },
      };
    },
    ...overrides,
  });
  return { tool, calls };
}

describe('workflow:run-template · 模型可见性（N-44/N-45 回归锁）', () => {
  it('真名与 **wire 形态**均解析为 assist；在 chat / default / coding / agent 下不被裁剪', () => {
    expect(getToolCategory(WORKFLOW_TEMPLATE_TOOL_NAME)).toBe('assist');

    const wire = toWireToolName(WORKFLOW_TEMPLATE_TOOL_NAME);
    expect(wire).not.toBe(WORKFLOW_TEMPLATE_TOOL_NAME); // 冒号 ⇒ 出站会改形
    expect(getToolCategory(wire)).toBe('assist'); // 修复前：wire 形态落 misc ⇒ 被裁

    const defs = [
      { type: 'function' as const, function: { name: wire } },
      { type: 'function' as const, function: { name: 'bash' } },
    ];
    for (const taskType of ['chat', 'default', 'coding', 'agent', undefined]) {
      const kept = filterToolsByTask(defs, taskType).map(
        (t) => t.function.name
      );
      expect(kept).toContain(wire);
    }
  });

  it('`assist` 放宽到 coding / agent（2026-10-08）：plan 亦随该类别可见', () => {
    // 如实记录副作用：类别级放宽 ⇒ 同类的 plan / clipboard / canvas 一并可见。
    const defs = [{ name: 'plan' }, { name: 'bash' }];
    for (const taskType of ['coding', 'agent']) {
      const kept = filterToolsByTask(defs, taskType).map((t) => t.name);
      expect(kept).toContain('plan');
    }
  });
});

describe('workflow:run-template · 元信息', () => {
  it('名称 / 别名 / 参数表齐备；不冒充只读', () => {
    const { tool } = makeTool();
    expect(tool.name).toBe('workflow:run-template');
    expect(tool.aliases).toContain('run_workflow_template');
    expect(tool.params.map((p) => p.name)).toEqual([
      'action',
      'template',
      'params',
    ]);
    // 保守：不冒充只读（避免影响既有只读清单/审批口径）
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isDestructive?.()).toBe(false);
  });
});

describe('workflow:run-template · list', () => {
  it('列出可执行模板（含步骤工具名）', async () => {
    const { tool } = makeTool();
    const res = await runTool(tool, { action: 'list' });

    expect(res.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(res.data.templates).toEqual(BRIEFS);
    expect(String(res.output)).toContain('t1');
    expect(String(res.output)).toContain('build→bash:run');
  });

  it('无可用模板 ⇒ 成功返回空清单 + 明确提示（不报错）', async () => {
    const { tool } = makeTool({ listRunnableTemplates: () => [] });
    const res = await runTool(tool, { action: 'list' });

    expect(res.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(res.data.templates).toEqual([]);
    expect(String(res.output)).toContain('没有可执行的用户工作流模板');
  });
});

describe('workflow:run-template · run', () => {
  it('成功 ⇒ SUCCESS，透传参数与 completedSteps，并按契约带出 workflowRun', async () => {
    const { tool, calls } = makeTool();
    const res = await runTool(tool, {
      action: 'run',
      template: 't1',
      params: { topic: 'x' },
    });

    expect(calls).toEqual([{ id: 't1', params: { topic: 'x' } }]);
    expect(res.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(res.data.success).toBe(true);
    expect(res.data.completedSteps).toEqual(['build', 'check']);
    expect(res.metadata?.workflowRun).toEqual({ runId: 'run_1' });
  });

  it('缺 params ⇒ 以空对象执行（不报错）', async () => {
    const { tool, calls } = makeTool();
    await runTool(tool, { action: 'run', template: 't1' });
    expect(calls).toEqual([{ id: 't1', params: {} }]);
  });

  it('未知 / 不可执行 id ⇒ FAILURE 且回列**当前可用清单**（动态目录，不用 enum）', async () => {
    const { tool, calls } = makeTool();
    const res = await runTool(tool, { action: 'run', template: 'nope' });

    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('nope');
    expect(String(res.errorOutput)).toContain('t1'); // 可用清单
    expect(calls).toHaveLength(0); // 未触达执行
  });

  it('无可执行模板时请求 run ⇒ FAILURE 且提示"当前没有任何可执行模板"', async () => {
    const { tool } = makeTool({ listRunnableTemplates: () => [] });
    const res = await runTool(tool, { action: 'run', template: 't1' });

    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('当前没有任何可执行模板');
  });

  it('**内建** id（builtin:*）⇒ FAILURE 且给出准确原因（人工方法论清单／不可自动执行）', async () => {
    const { tool, calls } = makeTool();
    const res = await runTool(tool, {
      action: 'run',
      template: 'builtin:bug-fix',
    });

    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('内建');
    expect(String(res.errorOutput)).toContain('人工方法论清单');
    expect(calls).toHaveLength(0);
  });

  it('seam 返回非 completed（如③权限拒绝）⇒ FAILURE，error 透出且带 completedSteps', async () => {
    const { tool } = makeTool({
      runTemplate: async () => ({
        result: {
          stopReason: 'error',
          completedSteps: [],
          error: '权限策略拒绝：模板仅允许调用非破坏性工具；越界工具: bash',
        },
      }),
    });
    const res = await runTool(tool, { action: 'run', template: 't1' });

    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('权限策略拒绝');
    expect(res.metadata?.completedSteps).toEqual([]);
  });

  it('执行抛异常 ⇒ FAILURE（不冒泡到循环层）', async () => {
    const { tool } = makeTool({
      runTemplate: async () => {
        throw new Error('boom');
      },
    });
    const res = await runTool(tool, { action: 'run', template: 't1' });

    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('boom');
  });
});

describe('workflow:run-template · 参数校验', () => {
  it('action 非法 ⇒ FAILURE 并列出可选值', async () => {
    const { tool } = makeTool();
    const res = await runTool(tool, { action: 'explode' });
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('list | run');
  });

  it('action=run 缺 template ⇒ FAILURE', async () => {
    const { tool } = makeTool();
    const res = await runTool(tool, { action: 'run' });
    expect(res.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(res.errorOutput)).toContain('必填');
  });
});
