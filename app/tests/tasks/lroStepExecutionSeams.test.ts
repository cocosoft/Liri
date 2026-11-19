// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P3-2（复杂度清理）：`stepExecution.executeSingleStep` 两处**待外移接缝**的特征化锁。
 *
 * 外移前先把"现有行为"钉住（先测后搬），覆盖两段：
 *   ① 步骤执行提示词（`execPrompt`）—— 步骤描述 / 验收标准 / 上次审查问题 / 硬约束，
 *      以及**工作区是否为空**的分型文案（`isWorkspaceEmpty` 两分支）；
 *   ② `executeTools` 的**工具门短路** —— 未注册 / 路径越界 / 缺必填参数。
 *
 * 走真实链路：① 默认 executor 路径（无 TAORLoop，捕获 `userPrompt`）；
 * ② 假 TAORLoop 转调 `deps.executeTools`（同 `lroBlockedCommandReplay.test.ts` 手法）。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LongRunningTaskOrchestrator } from '../../src/tasks/LongRunningTaskOrchestrator';
import { taskOrchestrator } from '../../src/tasks/TaskOrchestrator';
import type { Plan, PlanStep } from '../../src/tasks/TaskOrchestrator';
import { getToolRegistry } from '../../src/tools';
import type { Tool } from '../../src/tools/types/Tool';

taskOrchestrator.setPlansDir(mkdtempSync(join(tmpdir(), 'plans-seams-')));

const prevDataDir = process.env.LIRI_DATA_DIR;
const dataDir = mkdtempSync(join(tmpdir(), 'pdca-seams-'));
process.env.LIRI_DATA_DIR = dataDir;

afterAll(async () => {
  getToolRegistry().unregisterTool(PROBE_TOOL);
  const { closePdcaCheckpointStore } =
    await import('../../src/tasks/PdcaWorkItemBridge');
  closePdcaCheckpointStore();
  if (prevDataDir === undefined) {
    delete process.env.LIRI_DATA_DIR;
  } else {
    process.env.LIRI_DATA_DIR = prevDataDir;
  }
  // **不删除**临时数据目录：DB 单例可能仍持有句柄（CI macOS 实测 disk I/O error）
});

type OrchestratorUnderTest = {
  planId: string | null;
  isolation: { workspace: string };
  executeSingleStep: (step: PlanStep, plan: Plan) => Promise<void>;
  setTAORLoopFactory: (
    f: (sessionId: string, opts?: unknown) => unknown
  ) => void;
};

interface ToolCallOutcome {
  toolCallId?: string;
  toolName?: string;
  error?: string;
}

function makeTaskId(tag: string): string {
  return `seams-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function prepareStep(taskId: string): {
  o: OrchestratorUnderTest;
  plan: Plan;
  step: PlanStep;
} {
  const o = new LongRunningTaskOrchestrator(taskId, async () => {
    throw new Error('executor 不应被调用（本用例只跑 TAOR 分支）');
  }) as unknown as OrchestratorUnderTest;
  const plan = taskOrchestrator.createPlan(
    '接缝特征化',
    ['步骤A'],
    `session-${taskId}`
  );
  o.planId = plan.id;
  const step = plan.steps[0];
  if (!step) throw new Error('计划缺少步骤');
  return { o, plan, step };
}

describe('① 步骤执行提示词（buildStepExecutionPrompt 外移前特征化）', () => {
  /** 默认 executor 路径：捕获 `userPrompt`，返回纯文本（不触发工具调用） */
  function makePromptOrchestrator(capture: { prompt?: string }) {
    const executor = async (params: { userPrompt: string }) => {
      capture.prompt = params.userPrompt;
      return { content: '已执行' };
    };
    const o = new LongRunningTaskOrchestrator(
      makeTaskId('prompt'),
      executor as never
    ) as unknown as OrchestratorUnderTest;
    const plan = taskOrchestrator.createPlan(
      '提示词特征化',
      ['实现 SRS 旋转'],
      'session-seams-prompt'
    );
    o.planId = plan.id;
    const step = plan.steps[0];
    if (!step) throw new Error('计划缺少步骤');
    step.acceptanceCriteria = 'file_read 读取 output/board.txt 返回内容等于 OK';
    (step as unknown as { reviewResult: unknown }).reviewResult = {
      issues: [{ description: '问题甲' }, { description: '问题乙' }],
    };
    return { o, plan, step };
  }

  it('步骤描述 / 验收标准 / 上次审查问题 / 硬约束 均进入提示词', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan, step } = makePromptOrchestrator(capture);
    o.isolation.workspace = mkdtempSync(join(tmpdir(), 'seams-ws-'));

    await o.executeSingleStep(step, plan);

    const prompt = capture.prompt ?? '';
    expect(prompt).toContain('执行以下步骤: 实现 SRS 旋转');
    expect(prompt).toContain(
      '验收标准: file_read 读取 output/board.txt 返回内容等于 OK'
    );
    expect(prompt).toContain('注意: 上次审查发现以下问题，本次请修正：');
    expect(prompt).toContain('- 问题甲\n- 问题乙');
    expect(prompt).toContain('【硬约束】');
  });

  it('工作区路径作为确定性事实前置声明（越界守卫的提示面对齐）', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan, step } = makePromptOrchestrator(capture);
    const workspace = mkdtempSync(join(tmpdir(), 'seams-ws-'));
    o.isolation.workspace = workspace;

    await o.executeSingleStep(step, plan);

    expect(capture.prompt).toContain('相对本任务工作区根目录');
    expect(capture.prompt).toContain(workspace);
  });

  // C 项（2026-11-19，真机 `pdca_mwn8sp00`）：执行器为满足字面验收改去别的目录取数
  // （`app/packages/office`），提示词必须明确禁止，并给"最小决策"划边界。
  it('硬约束含「禁止换目标凑字面」，且最小决策不得改变目标对象', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan, step } = makePromptOrchestrator(capture);
    o.isolation.workspace = mkdtempSync(join(tmpdir(), 'seams-target-'));

    await o.executeSingleStep(step, plan);

    const prompt = capture.prompt ?? '';
    expect(prompt).toContain('换目标凑字面');
    expect(prompt).toContain('以步骤描述的目标为准');
    expect(prompt).toContain('不得改变本步的目标对象');
  });

  // 2026-11-19（真机 `pdca_mwn8sp00`）：`dependsOn` 前驱的**实际产出**必须进入本步提示词。
  // 缺陷现场：step_2 依赖 step_1 的"文件清单"，提示词却不含前驱结果 ⇒ 执行器自述
  // 「步骤1 未随指令给出显式清单」⇒ 另找 `app/packages/office` 凑字面验收（清单写错目录）。
  function makePredecessorOrchestrator(capture: { prompt?: string }): {
    o: OrchestratorUnderTest;
    plan: Plan;
  } {
    const executor = async (params: { userPrompt: string }) => {
      capture.prompt = params.userPrompt;
      return { content: '已执行' };
    };
    const o = new LongRunningTaskOrchestrator(
      makeTaskId('pred'),
      executor as never
    ) as unknown as OrchestratorUnderTest;
    const plan = taskOrchestrator.createPlan(
      '前驱事实注入',
      ['列出 .ts 清单', '按清单写产物'],
      'session-seams-pred',
      undefined,
      undefined,
      undefined,
      [[], [0]]
    );
    o.planId = plan.id;
    return { o, plan };
  }

  it('dependsOn 前驱的 result / artifacts 进入提示词', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan } = makePredecessorOrchestrator(capture);
    o.isolation.workspace = mkdtempSync(join(tmpdir(), 'seams-pred-ws-'));
    const [prev, current] = plan.steps;
    if (!prev || !current) throw new Error('计划缺少步骤');
    prev.status = 'completed';
    prev.result =
      'app/src/tasks/lro/blockedCommandLedger.ts\napp/src/tasks/lro/contracts.ts';
    prev.artifacts = ['output/list.md'];

    await o.executeSingleStep(current, plan);

    const prompt = capture.prompt ?? '';
    expect(prompt).toContain(
      '【前序步骤产出（dependsOn 声明的依赖，事实输入）】'
    );
    expect(prompt).toContain('列出 .ts 清单');
    expect(prompt).toContain('app/src/tasks/lro/contracts.ts');
    expect(prompt).toContain('output/list.md');
    // 与"步骤描述/验收标准"分区，不混进硬约束
    expect(prompt.indexOf('前序步骤产出')).toBeLessThan(
      prompt.indexOf('【硬约束】')
    );
  });

  it('无 dependsOn ⇒ 不注入前序段落（提示词与改造前一致）', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan } = makePredecessorOrchestrator(capture);
    o.isolation.workspace = mkdtempSync(join(tmpdir(), 'seams-pred-none-'));
    const [, current] = plan.steps;
    if (!current) throw new Error('计划缺少步骤');
    current.dependsOn = [];

    await o.executeSingleStep(current, plan);

    expect(capture.prompt ?? '').not.toContain('前序步骤产出');
  });

  it('前驱结果超长 ⇒ 截断并标注（不静默丢弃）', async () => {
    const capture: { prompt?: string } = {};
    const { o, plan } = makePredecessorOrchestrator(capture);
    o.isolation.workspace = mkdtempSync(join(tmpdir(), 'seams-pred-long-'));
    const [prev, current] = plan.steps;
    if (!prev || !current) throw new Error('计划缺少步骤');
    prev.status = 'completed';
    prev.result = `HEAD-${'x'.repeat(4200)}-TAIL`;

    await o.executeSingleStep(current, plan);

    const prompt = capture.prompt ?? '';
    expect(prompt).toContain('已截断');
    expect(prompt).not.toContain('-TAIL');
  });

  it('空工作区 ⇒ 空目录文案；非空工作区 ⇒ 已有内容文案（互斥）', async () => {
    const emptyCapture: { prompt?: string } = {};
    const emptyCase = makePromptOrchestrator(emptyCapture);
    emptyCase.o.isolation.workspace = mkdtempSync(
      join(tmpdir(), 'seams-empty-')
    );
    await emptyCase.o.executeSingleStep(emptyCase.step, emptyCase.plan);

    const fullWorkspace = mkdtempSync(join(tmpdir(), 'seams-full-'));
    writeFileSync(join(fullWorkspace, 'hello.txt'), 'hi', 'utf8');
    const fullCapture: { prompt?: string } = {};
    const fullCase = makePromptOrchestrator(fullCapture);
    fullCase.o.isolation.workspace = fullWorkspace;
    await fullCase.o.executeSingleStep(fullCase.step, fullCase.plan);

    expect(emptyCapture.prompt).toContain('该工作区初始为**空目录**');
    expect(emptyCapture.prompt).not.toContain('该工作区**已有内容**');
    expect(fullCapture.prompt).toContain('该工作区**已有内容**');
    expect(fullCapture.prompt).not.toContain('该工作区初始为**空目录**');
  });
});

const PROBE_TOOL = 'lro_gate_probe';

/** 最小探针工具：带一个必填 `path` 参数（用于越界 / 缺参两条短路） */
const probeTool = {
  name: PROBE_TOOL,
  description: '测试探针：不执行业务',
  params: [
    { name: 'path', type: 'string', description: '路径', required: true },
  ],
  execute: async () => ({ success: true, output: 'probe-executed' }),
} as unknown as Tool;

/** 假 TAORLoop：把本轮工具调用交给 `deps.executeTools` 真执行，并截获结果 */
function makeFakeLoop(
  calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>,
  captured: ToolCallOutcome[][]
) {
  return {
    config: { sessionId: '' },
    injectSteering: () => {},
    runCollect: async (input: {
      deps: {
        executeTools: (
          calls: Array<{
            id: string;
            name: string;
            arguments: Record<string, unknown>;
          }>,
          signal: AbortSignal
        ) => Promise<ToolCallOutcome[]>;
      };
    }) => {
      captured.push(
        await input.deps.executeTools(calls, new AbortController().signal)
      );
      return { turnCount: 1, totalTokens: 1 };
    },
  };
}

describe('② executeTools 工具门短路（外移前特征化）', () => {
  async function runCalls(
    calls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }>
  ): Promise<ToolCallOutcome[]> {
    const { o, plan, step } = prepareStep(makeTaskId('gate'));
    const captured: ToolCallOutcome[][] = [];
    o.setTAORLoopFactory(() => makeFakeLoop(calls, captured));
    await o.executeSingleStep(step, plan);
    const outcome = captured[0];
    if (!outcome) throw new Error('executeTools 未被调用');
    return outcome;
  }

  it('未注册工具 ⇒ 工具未注册（不进入越界/执行）', async () => {
    const [outcome] = await runCalls([
      { id: 'c-missing', name: 'lro_not_registered_tool', arguments: {} },
    ]);
    expect(outcome?.toolCallId).toBe('c-missing');
    expect(outcome?.toolName).toBe('lro_not_registered_tool');
    expect(outcome?.error).toContain('工具未注册: lro_not_registered_tool');
  });

  it('路径越界 ⇒ 拒绝并回传工作区根目录', async () => {
    getToolRegistry().registerTool(probeTool);
    const workspace = mkdtempSync(join(tmpdir(), 'seams-guard-'));

    const { o: orch, plan, step } = prepareStep(makeTaskId('escape'));
    orch.isolation.workspace = workspace;
    const captured: ToolCallOutcome[][] = [];
    orch.setTAORLoopFactory(() =>
      makeFakeLoop(
        [
          {
            id: 'c-escape',
            name: PROBE_TOOL,
            arguments: { file_path: '../../etc/passwd' },
          },
        ],
        captured
      )
    );
    await orch.executeSingleStep(step, plan);

    const outcome = captured[0]?.[0];
    expect(outcome?.error).toContain('路径越界：file_path=../../etc/passwd');
    expect(outcome?.error).toContain(`本任务工作区根目录：${workspace}`);
    expect(outcome?.error).toContain('请改用**相对该目录**的路径');
  });

  it('缺必填参数 ⇒ 与主链同一缺参文案（不进入执行）', async () => {
    getToolRegistry().registerTool(probeTool);
    const [outcome] = await runCalls([
      { id: 'c-noparam', name: PROBE_TOOL, arguments: {} },
    ]);
    expect(outcome?.error).toContain('Missing required parameter: path');
    expect(outcome?.error).not.toContain('路径越界');
  });
});
