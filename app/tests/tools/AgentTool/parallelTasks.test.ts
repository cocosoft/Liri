/**
 * AgentTool.tasks[] 并行分支护栏测试（B-4，2026-09-20）
 *
 * 目的：锁定 `tasks[]` 分支改走 AgentSwarm 单引擎后，**不传新参数**时的对外行为逐字不变：
 * - 汇总格式仍为 `[OK|FAIL] <description>: <output|error>`，以 `\n---\n` 连接
 * - PARALLEL_START / PARALLEL_END 事件仍发布（前端 SSE 时间线不断供）
 * - metadata.parallelTaskCount / parallelSuccessCount 语义保持
 * 并浅覆盖新参数（`verify` → gated 汇总格式）。
 *
 * 说明：`execute` 的 `tasks[]` 分支位于 teammate / 后台任务逻辑**之前**且直接 return，
 * 故只需注入 fake SubAgentEngine（`Reflect.set`，不使用 any / ts-ignore）即可端到端驱动该分支。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool } from '../../../src/tools/types/Tool';
import { globalEventBus } from '../../../src/core/events/EventBus.js';
import { OrchestrationEventType } from '@modules/agent';
import { getAgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';
import {
  setSpawnPaused,
  resetSpawnPause,
  isSpawnPaused,
} from '../../../src/tools/AgentTool/spawnPause';

/** fake 引擎入参（只声明本测试用到的字段；实参多出的字段可安全忽略） */
interface EngineStubParams {
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  maxTurns: number;
}

/** 注入 fake 引擎（替换私有字段 `engine`，绕开真实子代理执行） */
function installEngine(
  tool: AgentTool,
  execute: (params: EngineStubParams) => Promise<{
    output: string;
    /** O4：适配器按引擎**真实结果**判定 worker 成败（缺省视为成功，保持既有桩简洁） */
    completed?: boolean;
    timedOut?: boolean;
  }>
): void {
  Reflect.set(tool, 'engine', { execute });
}

/** 取 executor 收到的用户提示词（适配器只发一条 user 消息） */
function userPromptOf(params: EngineStubParams): string {
  return params.messages[0]?.content ?? '';
}

const TASKS = [
  { description: '分析需求 A', prompt: 'p1' },
  { description: '设计模块 B', prompt: 'p2' },
];

/** worker 类别池所需的只读检索工具（命中 `search` + `file_read` 两个类别） */
const READ_TOOL_NAMES = ['grep', 'glob', 'file_read'];

/** 最小可用 Tool（本路径只消费 `name` 与 `getInfo()`） */
function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

/**
 * 取 worker 的自身子任务描述。
 * 注意：swarm 黑板会把**全部子任务清单**注入每个 worker 的 prompt，
 * 因此不能用 `includes('设计模块 B')` 之类判别（会导致所有 worker 都命中同一分支），
 * 必须锚定 `你的子任务:` 之后的片段。
 */
function ownTask(prompt: string): string {
  return prompt.match(/你的子任务: (.+)/)?.[1]?.trim() ?? '';
}

/** 两个 worker 的固定输出（与并发顺序无关，按自身子任务路由） */
function workerOutput(prompt: string): string {
  const own = ownTask(prompt);
  if (own.startsWith('分析需求 A')) return 'out-a';
  if (own.startsWith('设计模块 B')) return 'out-b';
  return 'out-other';
}

describe('AgentTool.tasks[] 并行分支（B-4 护栏）', () => {
  /**
   * worker 工具池注册（P0-B 后成为必需前置）。
   *
   * worker 池 = 类别池（`AgentSwarm` 硬编码 `search` + `file_read`）∩ 父级可继承池 − denied；
   * 池为空时 P0-B 走 **fail-closed**（不执行、抛错、落 `failed`）⇒ 本文件若像修复前
   * 那样不注册任何工具，worker 会在"无工具"处全部失败，逐字护栏断言随之失配。
   * 本文件关注**汇总格式**而非工具装配，故只注入只读检索工具让 worker 正常执行
   *（与 `swarmDescriptorResolution.test.ts` 同法）。
   */
  beforeEach(() => {
    setAgentToolManager(() => READ_TOOL_NAMES.map(fakeTool));
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('不传新参数：汇总格式与既有实现逐字一致', async () => {
    const tool = new AgentTool();
    installEngine(tool, async (params) => ({
      output: workerOutput(userPromptOf(params)),
      completed: true,
    }));

    const result = await tool.execute({
      description: '并行执行 A/B',
      prompt: '总任务',
      tasks: TASKS,
    });

    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    // 逐字护栏：`[OK] <description>: <output>` + `\n---\n` 连接
    expect(result.output).toBe(
      '[OK] 分析需求 A: out-a\n---\n[OK] 设计模块 B: out-b'
    );
    // 未开 verify/synthesize → 仅 2 次 worker 调用，无 verifier/synthesizer 输出
    expect(result.output).not.toContain('## Worker 结果');
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['parallelTaskCount']).toBe(2);
    expect(meta['parallelSuccessCount']).toBe(2);

    // O6⑥：批次内**逐任务**落盘 —— worker 行以 `batchId::taskKey` 为主键，逐个写回终态
    const batchRows = (await getAgentRunStore().listRuns()).filter(
      (r) => r.batchId === String(meta['agentId'])
    );
    expect(batchRows.map((r) => r.taskKey).sort()).toEqual([
      'task-0',
      'task-1',
    ]);
    expect(batchRows.every((r) => r.status === 'completed')).toBe(true);
  });

  test('worker 失败：FAIL 行逐字一致 + 成功计数只算成功项', async () => {
    const tool = new AgentTool();
    installEngine(tool, async (params) => {
      const prompt = userPromptOf(params);
      if (ownTask(prompt).startsWith('设计模块 B')) throw new Error('boom');
      return { output: workerOutput(prompt), completed: true };
    });

    const result = await tool.execute({
      description: '并行执行 A/B',
      prompt: '总任务',
      tasks: TASKS,
    });

    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(result.output).toBe(
      '[OK] 分析需求 A: out-a\n---\n[FAIL] 设计模块 B: 执行失败: Error: boom'
    );
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['parallelTaskCount']).toBe(2);
    expect(meta['parallelSuccessCount']).toBe(1);
  });

  test('PARALLEL_START / PARALLEL_END 事件仍发布（SSE 时间线不断供）', async () => {
    const seen: Array<{ event: string; data: unknown }> = [];
    const subs = [
      globalEventBus.subscribe(
        OrchestrationEventType.PARALLEL_START,
        (data: unknown) => {
          seen.push({ event: 'start', data });
        }
      ),
      globalEventBus.subscribe(
        OrchestrationEventType.PARALLEL_END,
        (data: unknown) => {
          seen.push({ event: 'end', data });
        }
      ),
    ];

    try {
      const tool = new AgentTool();
      installEngine(tool, async (params) => ({
        output: workerOutput(userPromptOf(params)),
        completed: true,
      }));
      await tool.execute({
        description: '并行执行 A/B',
        prompt: '总任务',
        tasks: TASKS,
      });
    } finally {
      subs.forEach((sub) => sub.unsubscribe());
    }

    expect(seen.map((s) => s.event)).toEqual(['start', 'end']);
    expect(seen[0].data).toMatchObject({ totalTasks: 2 });
    expect(seen[1].data).toMatchObject({ completedTasks: 2, failedTasks: 0 });
  });

  test('verify=true：改走 gated 汇总（含门禁统计），不再用 legacy 行格式', async () => {
    const tool = new AgentTool();
    installEngine(tool, async (params) => {
      const prompt = userPromptOf(params);
      // verifier 提示词含「worker 输出」→ 返回门禁结论
      if (prompt.includes('worker 输出')) {
        return {
          output: JSON.stringify({ pass: true, feedback: '通过' }),
          completed: true,
        };
      }
      return { output: workerOutput(prompt), completed: true };
    });

    const result = await tool.execute({
      description: '并行执行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      verify: true,
    });

    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    // 无 id 的任务用 `task-<idx>` 兜底，gated 行格式为 `[OK] <id>: <output>`
    // 出口⑤（2026-09-22）：门禁三态分列 —— `skipped` 不再与 `passed` 混算成 "verified"
    expect(result.output).toContain(
      '## Worker 结果（门禁：passed 1 / failed 0 / skipped 0；allPassed: true）'
    );
    expect(result.output).toContain('[OK] task-0: out-a');
  });

  test('E2：spawn 暂停 ⇒ 新委派被拒（在途不受影响）', async () => {
    setSpawnPaused(true, '测试刹车');
    try {
      const tool = new AgentTool();
      installEngine(tool, async (params) => ({
        output: workerOutput(userPromptOf(params)),
        completed: true,
      }));

      const result = await tool.execute({
        description: '并行执行 A',
        prompt: '总任务',
        tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      });

      expect(result.status).toBe(ToolExecutionStatus.FAILURE);
      expect(result.error).toContain('已暂停');
      expect(result.error).toContain('测试刹车');
      // 关键语义：只挡新增 —— 暂停期间不做任何取消/中止
      expect(isSpawnPaused()).toBe(true);
    } finally {
      resetSpawnPause();
    }
    expect(isSpawnPaused()).toBe(false);
  });

  test('O4：引擎 `completed=false`（超时/截断）⇒ 计为 FAIL 且不计入成功数', async () => {
    const tool = new AgentTool();
    installEngine(tool, async (params) => ({
      output: workerOutput(userPromptOf(params)),
      completed: false,
      timedOut: true,
    }));

    const result = await tool.execute({
      description: '并行执行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
    });

    // 出口②③（2026-09-22）：`okCount === 0` ⇒ 工具级 FAILURE（修复前恒 SUCCESS）
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(result.error).toContain('未通过');
    // 原实现"未抛错即成功" ⇒ 超时/截断会被记成 `[OK]`；O4 后按引擎真实结果记 FAIL
    expect(result.output).toContain('[FAIL] 分析需求 A:');
    expect(result.output).not.toContain('[OK] 分析需求 A');
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['parallelSuccessCount']).toBe(0);
    // 出口①：台账终态与工具级口径一致（全失败批次不得落 `completed`）
    expect(meta['completed']).toBe(false);
    // §3.0 顺序守门：内存台账拒绝的写，磁盘不得写 —— 该批次磁盘行必须同为终态 `failed`
    expect(
      (await getAgentRunStore().getRun(String(meta['agentId'])))?.status
    ).toBe('failed');
  });

  test('出口⑤/⑥：部分失败 ⇒ 门禁三态分列 + partialFailure 归因 + 事件口径自洽', async () => {
    const tool = new AgentTool();
    const seen: Array<Record<string, unknown>> = [];
    const sub = globalEventBus.subscribe(
      OrchestrationEventType.PARALLEL_END,
      (data) => {
        seen.push(data as Record<string, unknown>);
      }
    );
    try {
      installEngine(tool, async (params) => {
        const prompt = userPromptOf(params);
        // verifier 提示词内含「worker 输出」⇒ 返回门禁结论；仅 B 判不过（走正常判负路径）
        if (prompt.includes('worker 输出')) {
          const pass = !prompt.includes('out-b');
          return {
            output: JSON.stringify({
              pass,
              feedback: pass ? '通过' : '未达标',
            }),
            completed: true,
          };
        }
        return { output: workerOutput(prompt), completed: true };
      });

      const result = await tool.execute({
        description: '并行执行 A/B',
        prompt: '总任务',
        tasks: TASKS,
        verify: true,
      });

      // okCount = 1（A 过、B 门禁判不过）⇒ 部分失败：保住部分结果（工具级 SUCCESS），
      // 但对外**任何一处**都不得声称"全部通过"。
      expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
      expect(result.output).toContain(
        '## Worker 结果（门禁：passed 1 / failed 1 / skipped 0；allPassed: false）'
      );
      expect(result.output).toContain('[OK 未过门禁] task-1:');
      const meta = result.metadata as Record<string, unknown>;
      expect(meta['completed']).toBe(false);
      expect(meta['parallelSuccessCount']).toBe(1);
      // 出口⑥：无取消 ⇒ 未投递数为 0（不得把门禁判负混入取消）
      expect(meta['cancelledTaskCount']).toBe(0);
      expect(String(meta['partialFailure'])).toContain('1/2 个 worker 未通过');
      // 出口④：PARALLEL_END 分母为**已投递** worker，取消数独立成列
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({
        totalTasks: 2,
        completedTasks: 1,
        failedTasks: 1,
        cancelledTasks: 0,
      });
    } finally {
      sub.unsubscribe();
    }
  });
});
