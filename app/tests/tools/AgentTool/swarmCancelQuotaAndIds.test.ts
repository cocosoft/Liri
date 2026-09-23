/**
 * 多 Agent 协同遗留修复专项（P0-A / P0-B / P1-C / P1-D / P1-E，2026-09-21）
 *
 * 来源：`chat-export` 复查清单第二轮（A–E 五条，修复前**均无用例覆盖**）。
 *
 * - **A**（P0）：`swarmAbort` 从不被 `abort()` ⇒ 并行批次没有取消通路。修复：把
 *   `context.abortController.signal` 桥接到批次控制器（含"父级已中止则立即同步"）。
 * - **B**（P0）：worker 工具池可能被 `allowedTools ∩ 类别池` 静默清空 ⇒ 修复为
 *   **空集 fail-closed**（不执行、落 `failed`、原因进汇总）。
 * - **C**（P1）：批次只按 1 个额度占位 ⇒ 修复为按 worker 数占位（`setWeight`）。
 * - **D**（P1）：磁盘台账的 `cancel_requested` 无写入点（死状态）⇒ 修复为
 *   `stopAgent` 受理时落盘。
 * - **E**（P1）：台账/引擎/控制面三处 worker id 断裂 ⇒ 修复为引擎 id 与磁盘主键同源
 *   （`${batchId}::${taskKey}`），并补批次 → worker 的取消扇出。
 *
 * 说明：与 `swarmDescriptorResolution.test.ts` 同法注入 fake 引擎（`Reflect.set`，
 * 不使用 `any` / `ts-ignore`），走**真实** `AgentSwarm` 编排；`AgentRunStore` 由
 * `bunfig.toml` preload（`setupIsolateAgentStore.ts`）隔离到临时库，不污染生产台账。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import {
  getAgentRunLedger,
  resetAgentRunLedger,
} from '../../../src/tools/AgentTool/AgentRunLedger';
import { getAgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';
import {
  swarmBatchRegistrySize,
  resetSwarmBatchRegistry,
} from '../../../src/tools/AgentTool/swarmBatchRegistry';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool, ToolUseContext } from '../../../src/tools/types/Tool';

/** fake 引擎收到的调用参数（只声明本测试断言用到的字段） */
interface EngineStubParams {
  agentId?: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function?: { name?: string } }>;
  toolInstances?: Map<string, unknown>;
  signal?: AbortSignal;
}

/** 一次引擎调用的关键观测点 */
interface EngineCall {
  /** 引擎侧 id（E：应与磁盘 `tool_call_id` 同源） */
  engineAgentId: string;
  toolNames: string[];
  /** 引擎收到的 AbortSignal（A：应与父级信号联动） */
  signal?: AbortSignal;
  /** worker **执行当时**台账占用的槽位总数（C） */
  liveCount: number;
}

interface EngineStubOptions {
  /** 引擎侧"活跃 run"快照（E 的扇出用例据此断言） */
  activeIds?: string[];
  produce?: (call: EngineCall) => { output: string; completed?: boolean };
}

/** 注入 fake 引擎并记录每次调用 */
function installEngine(
  tool: AgentTool,
  options: EngineStubOptions = {}
): { calls: EngineCall[]; aborted: string[] } {
  const calls: EngineCall[] = [];
  const aborted: string[] = [];
  Reflect.set(tool, 'engine', {
    execute: async (params: EngineStubParams) => {
      const call: EngineCall = {
        engineAgentId: params.agentId ?? '',
        toolNames: (params.tools ?? []).map((t) => t.function?.name ?? ''),
        signal: params.signal,
        liveCount: getAgentRunLedger().liveCount(),
      };
      calls.push(call);
      const res = options.produce?.(call) ?? { output: 'out', completed: true };
      return {
        output: res.output,
        completed: res.completed ?? true,
        timedOut: false,
      };
    },
    abort: (agentId: string) => {
      aborted.push(agentId);
      return true;
    },
    ownerSessionId: () => undefined,
    getActiveAgents: () =>
      (options.activeIds ?? []).map((agentId) => ({ agentId, elapsedMs: 0 })),
  });
  return { calls, aborted };
}

/**
 * 最小可用 `ToolUseContext`。
 *
 * A 的用例必须经 `context.abortController` 注入父级信号 —— 修复前该信号
 * 与批次控制器之间没有任何通路。
 */
function fakeContext(
  abortController: AbortController,
  sessionId: string
): ToolUseContext {
  return {
    options: {},
    abortController,
    sessionId,
    readFileState: undefined,
    getAppState: () => undefined,
    setAppState: () => undefined,
  } as unknown as ToolUseContext;
}

/** 最小可用 Tool（本路径只消费 `name` 与 `getInfo()`） */
function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

/** worker 类别池由此二者构成（`search` + `file_read`）；`file_write` 属写入类别，不在池内 */
const READ_TOOL_NAMES = ['grep', 'glob', 'file_read'];
const WRITE_TOOL_NAMES = ['file_write'];

/** 取某批次的 worker 落盘行 */
async function batchRows(
  metadata: Record<string, unknown>
): Promise<
  Array<{ toolCallId: string; status: string; error?: string | null }>
> {
  const batchId = String(metadata['agentId']);
  const rows = await getAgentRunStore().listRuns();
  return rows
    .filter((r) => r.batchId === batchId)
    .map((r) => ({
      toolCallId: r.toolCallId,
      status: r.status,
      error: r.error ?? null,
    }));
}

/** 轮询等待磁盘行到达期望状态（D 的落盘是 fire-and-forget，需等一拍） */
async function waitForStatus(
  toolCallId: string,
  expected: string
): Promise<string | undefined> {
  for (let i = 0; i < 40; i++) {
    const row = await getAgentRunStore().getRun(toolCallId);
    if (row?.status === expected) return row.status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return (await getAgentRunStore().getRun(toolCallId))?.status;
}

describe('P0-A：父级取消信号接入并行批次', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('父级**已**中止 ⇒ 批次不启动任何 worker（修复前照常跑满）', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool);
    const controller = new AbortController();
    controller.abort();

    const result = await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      },
      fakeContext(controller, 'sess-A')
    );

    // `AgentSwarm.runBatched` 的 `if (signal?.aborted)` 短路：修复前该信号恒不中止
    expect(calls).toHaveLength(0);
    // 出口⑥/②③（2026-09-22）：0 个 worker 跑过 ⇒ `allPassed=false`（基数守卫）⇒ 工具级 FAILURE。
    // 修复前 `[].every(...) === true` ⇒ 一个任务都没执行反被判"全部通过"。
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(result.error).toContain('批次被取消');
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['completed']).toBe(false);
    // 出口⑥：未投递的任务计入 `cancelledTaskCount`，不得混入失败数
    expect(meta['cancelledTaskCount']).toBe(1);
    expect(meta['parallelSuccessCount']).toBe(0);
    // §3.0 顺序守门：内存台账拒绝的写，磁盘不得写 ⇒ 该批次磁盘行终态与工具级口径一致
    const batchAgentId = String(meta['agentId']);
    expect(await waitForStatus(batchAgentId, 'failed')).toBe('failed');
  });

  test('父级**运行中**中止 ⇒ worker 引擎侧信号同步为 aborted', async () => {
    const tool = new AgentTool();
    const controller = new AbortController();
    // 在 worker 执行途中触发父级中止（模拟"用户点停止"落在批次运行期间）
    const { calls } = installEngine(tool, {
      produce: () => {
        controller.abort();
        return { output: 'out-a', completed: true };
      },
    });

    await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      },
      fakeContext(controller, 'sess-A')
    );

    expect(calls).toHaveLength(1);
    // 同一个 AbortSignal 引用：修复前它是 `swarmAbort.signal`（从不 abort）⇒ 恒 false
    expect(calls[0].signal?.aborted).toBe(true);
  });

  test('门禁被跳过 ≠ 门禁通过（2026-09-22 P1）：verify:true 且 worker 完成后中止', async () => {
    const tool = new AgentTool();
    const controller = new AbortController();
    // worker 执行成功返回，但**同时**触发取消 ⇒ 门禁阶段的前置条件 `!signal?.aborted` 为假
    // ⇒ 门禁**整批不启动**，成功后 worker 的 `verify` 停在初值 `'skipped'`
    const { calls } = installEngine(tool, {
      produce: () => {
        controller.abort();
        return { output: 'out-a', completed: true };
      },
    });

    const result = await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '分析需求 A', prompt: 'p1' }],
        verify: true, // 显式请求门禁
      },
      fakeContext(controller, 'sess-gate')
    );

    // 修复前：`ok = success && verify !== 'failed'` ⇒ `'skipped'` 直接通过
    // ⇒ 用户请求了门禁、门禁一次没跑，却被报成"全部通过"。现改为 fail-closed。
    expect(calls).toHaveLength(1); // worker 跑了
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['completed']).toBe(false);
    expect(meta['parallelSuccessCount']).toBe(0); // 未获门禁结论 ⇒ 不计通过
    // 归因不遮蔽：既报"未通过"，也报清真实原因"门禁未完成"
    expect(String(result.error)).toContain('未通过');
    expect(String(result.error)).toContain('门禁未完成');
  });

  test('取消发生在收尾阶段 ⇒ 取消事实仍可见（投递缺口为 0 不得掩盖取消）', async () => {
    const tool = new AgentTool();
    const controller = new AbortController();
    let callIndex = 0;
    installEngine(tool, {
      produce: () => {
        callIndex += 1;
        // 调用 #1 = worker 执行；#2 = verifier 门禁。
        // 在门禁通过后才触发取消 ⇒ 中止落在**收尾（合成）阶段**，此时任务已全部投递。
        if (callIndex === 2) controller.abort();
        return callIndex === 2
          ? { output: '{"pass":true,"feedback":"ok"}', completed: true }
          : { output: 'out-a', completed: true };
      },
    });

    const result = await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '分析需求 A', prompt: 'p1' }],
        verify: true,
      },
      fakeContext(controller, 'sess-tail-cancel')
    );

    const meta = result.metadata as Record<string, unknown>;
    // 任务已全部投递 ⇒ 投递缺口为 0（这正是修复前唯一被派生的"取消相关"量）
    expect(meta['cancelledTaskCount']).toBe(0);
    // 修复前：缺口为 0 ⇒ 对外彻底看不到"批次被取消"，无法与"正常跑完"区分
    expect(meta['cancelled']).toBe(true);
    // D-B 路线 A：`cancelled` 仅用于归因，终态仍只由 `batchOk` 决定
    expect(meta['completed']).toBe(true);
  });

  test('未请求门禁时 `skipped` 仍算通过（不误伤 legacy 行为）', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool); // 不传 verify ⇒ enableVerify=false

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
    });

    expect(calls).toHaveLength(1);
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    const meta = result.metadata as Record<string, unknown>;
    expect(meta['completed']).toBe(true);
  });
});

describe('P0-B：worker 工具池空集 fail-closed', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('类别池 ∩ allowedTools = ∅ ⇒ 不执行、落 failed、原因进汇总', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool);

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      // 写入工具通过 O7 两段校验（父级确有 `file_write`），但与 worker 的
      // 只读类别池（`search` + `file_read`）无交集 ⇒ 修复前静默空池跑满 20 轮
      allowedTools: ['file_write'],
    });

    expect(calls).toHaveLength(0);
    expect(result.output).toContain('[FAIL] 分析需求 A');
    expect(result.output).toContain('worker 工具池为空');

    const rows = await batchRows(result.metadata as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed'); // 不残留 running
    expect(rows[0].error).toContain('worker 工具池为空');
  });
});

describe('P1-C：批次按 worker 数占位并发额度', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('3 个任务的批次在 worker 执行期间占 3 个槽位（修复前恒 1）', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool);

    await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '子任务 1', prompt: 'p1' },
        { description: '子任务 2', prompt: 'p2' },
        { description: '子任务 3', prompt: 'p3' },
      ],
    });

    expect(calls).toHaveLength(3);
    // 额度在 `AgentSwarm.run` **之前**校准 ⇒ 任一 worker 执行时都应看到 3 个占位
    expect(calls.every((c) => c.liveCount === 3)).toBe(true);
    // 批次收口后额度归还
    expect(getAgentRunLedger().liveCount()).toBe(0);
  });
});

describe('P1-E：worker 对外 id 三处同源', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('引擎 id = 磁盘主键 = 控制面可见 id', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool);

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
    });

    const batchId = String(
      (result.metadata as Record<string, unknown>)['agentId']
    );
    // SubTask 未显式给 id ⇒ `runSwarmPath` 补 `task-0`
    expect(calls[0].engineAgentId).toBe(`${batchId}::task-0`);

    // 控制面 `/v1/agents/runs` 暴露的正是该 `toolCallId` ⇒ 可直接用于 stop
    const row = await getAgentRunStore().getRun(calls[0].engineAgentId);
    expect(row).not.toBeNull();
    expect(row?.batchId).toBe(batchId);
    expect(row?.status).toBe('completed');
  });
});

describe('R1：批次取消通路与父级信号汇合', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('批次运行中 stopAgent(batchId) ⇒ 未投递的后续批次不再启动', async () => {
    const tool = new AgentTool();
    let stopped = false;
    // 4 个任务、swarm 并发 3 ⇒ 分两批（3 + 1）；第一个 worker 执行期间停批次
    const { calls } = installEngine(tool, {
      produce: (call) => {
        if (!stopped) {
          stopped = true;
          // 引擎 id 与磁盘主键同源（P1-E）⇒ 可直接切出 batchId
          const batchId = call.engineAgentId.split('::')[0];
          tool.stopAgent(batchId, { privileged: true });
        }
        return { output: 'out', completed: true };
      },
    });

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '子任务 1', prompt: 'p1' },
        { description: '子任务 2', prompt: 'p2' },
        { description: '子任务 3', prompt: 'p3' },
        { description: '子任务 4', prompt: 'p4' },
      ],
    });

    // 关键：第 4 个 worker **从未投递**（修复前 stopAgent 不触碰 swarmAbort，
    // `runBatched` 的 `signal?.aborted` 短路恒为假 ⇒ 4 个全跑）
    expect(calls).toHaveLength(3);
    expect(
      (result.metadata as Record<string, unknown>)['parallelTaskCount']
    ).toBe(3);
  });

  test('批次收口后控制器被注销（不泄漏）', async () => {
    const tool = new AgentTool();
    installEngine(tool);

    await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '子任务 1', prompt: 'p1' }],
    });

    // R1 修正：注册表已升为进程内单例（`swarmBatchRegistry`）
    expect(swarmBatchRegistrySize()).toBe(0);
  });

  test('跨实例可见（进程内单例）：实例 B 停实例 A 的批次仍然生效', async () => {
    const runner = new AgentTool(); // 执行批次的实例
    const controlPlane = new AgentTool(); // 模拟控制面取到的"另一个实例"
    let stopped = false;
    const { calls } = installEngine(runner, {
      produce: (call) => {
        if (!stopped) {
          stopped = true;
          const batchId = call.engineAgentId.split('::')[0];
          // 关键：由**另一个实例**发起停止 —— 若注册表是实例字段，这里查不到控制器
          controlPlane.stopAgent(batchId, { privileged: true });
        }
        return { output: 'out', completed: true };
      },
    });

    const result = await runner.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '子任务 1', prompt: 'p1' },
        { description: '子任务 2', prompt: 'p2' },
        { description: '子任务 3', prompt: 'p3' },
        { description: '子任务 4', prompt: 'p4' },
      ],
    });

    // 第 4 个 worker 未投递 ⇒ 跨实例取消生效（实例字段实现下会是 4）
    expect(calls).toHaveLength(3);
    expect(
      (result.metadata as Record<string, unknown>)['parallelTaskCount']
    ).toBe(3);
  });
});

describe('缺陷 2（2026-09-22）：批次控制器注册点移入 try 作用域', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('per-task 描述符解析抛出 ⇒ 控制器已注销（修复前永久残留 + stopAgent 假阳性）', async () => {
    const tool = new AgentTool();
    const { calls } = installEngine(tool);
    // 强制抛出。真实可抛点为动态 import / `AgentRoleStore.init()` / `resolveForDelegation()`，
    // 三者都需外部环境配合；此处直接替换该步骤，锁定**接线**（注册 → 抛出 → 注销）本身。
    Reflect.set(tool, 'resolveSwarmTaskDescriptors', async () => {
      throw new Error('resolve boom');
    });

    const before = swarmBatchRegistrySize();
    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '分析需求 A', prompt: 'p1', subagent_type: 'general' },
      ],
    });

    // 抛出由 `execute` 外层 catch 收敛为 FAILURE（且台账已结算）
    expect(result.status).toBe(ToolExecutionStatus.FAILURE);
    expect(String(result.error)).toContain('resolve boom');
    // worker 从未启动
    expect(calls).toHaveLength(0);
    // 本用例核心：注册表回到基线 ⇒ 无永久残留（修复前 `batchAborts` 单调增长）
    expect(swarmBatchRegistrySize()).toBe(before);
  });
});

describe('R2：并发额度准入即预留', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('在途占 2 + 批次 2 worker > 上限 3 ⇒ 准入即拒（修复前按 1 放行）', async () => {
    const tool = new AgentTool({ maxConcurrentAgents: 3 });
    const { calls } = installEngine(tool);
    // 模拟另一条在途批次：占 2 个槽位
    getAgentRunLedger().register({
      id: 'inflight-batch',
      name: 'inflight-batch',
      type: 'general',
      weight: 2,
    });

    const rejected = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '子任务 1', prompt: 'p1' },
        { description: '子任务 2', prompt: 'p2' },
      ],
    });

    expect(calls).toHaveLength(0);
    expect(rejected.status).toBe(ToolExecutionStatus.FAILURE);
    expect(rejected.error).toContain('Maximum concurrent');
  });

  test('大批次（10 worker > 上限 5）不被误拒：预留取真实并发占用 min(10, 3)', async () => {
    const tool = new AgentTool({ maxConcurrentAgents: 5 });
    const { calls } = installEngine(tool);

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: Array.from({ length: 10 }, (_, i) => ({
        description: `子任务 ${i + 1}`,
        prompt: `p${i + 1}`,
      })),
    });

    // 修复前按"任务总数"预留会把 10 > 5 的合法批次整体拒绝
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(calls).toHaveLength(10); // 3 并发窗口分 4 批，全部投递
  });

  test('同额度下单代理（占 1）仍可准入', async () => {
    const tool = new AgentTool({ maxConcurrentAgents: 3 });
    const { calls } = installEngine(tool);
    getAgentRunLedger().register({
      id: 'inflight-batch',
      name: 'inflight-batch',
      type: 'general',
      weight: 2,
    });

    const result = await tool.execute({
      description: '单代理',
      prompt: '做点事',
    });

    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(calls).toHaveLength(1);
    // 执行期间：在途 2（另一批次）+ 本代理 1 = 3（恰好触顶仍准入）
    expect(calls[0].liveCount).toBe(3);
    // 收口后本代理释放 ⇒ 只剩在途那一批
    expect(getAgentRunLedger().liveCount()).toBe(2);
  });

  test('缺陷 4：配置上限 2 + 3 任务 ⇒ 不再整批被拒，且真实并发峰值 ≤ 2', async () => {
    const tool = new AgentTool({ maxConcurrentAgents: 2 });
    let inFlight = 0;
    let peak = 0;
    Reflect.set(tool, 'engine', {
      execute: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        // 拉长窗口以保证三个 worker 存在真实重叠（否则峰值断言恒真，形同虚设）
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { output: 'out', completed: true, timedOut: false };
      },
    });

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '子任务 1', prompt: 'p1' },
        { description: '子任务 2', prompt: 'p2' },
        { description: '子任务 3', prompt: 'p3' },
      ],
    });

    // 修复前 `plannedWeight = min(3 任务, 3 默认) = 3 > 上限 2` ⇒ 准入算术 `0+3 <= 2` 为假
    // ⇒ **合法批次被整批拒绝**（跑不了）
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    // 修复前即使放行，执行层仍按 `DEFAULT_SWARM_CONCURRENCY(3)` 分批 ⇒ 峰值 3（超配 1.5×）
    expect(peak).toBe(2);
  });
});

describe('P1-D/E：控制面取消（批次扇出 + 磁盘中间态）', () => {
  beforeEach(() => {
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  afterEach(() => {
    resetAgentRunLedger();
    resetSwarmBatchRegistry();
  });

  test('按批次 id 停 ⇒ 扇出中止批次内 worker、不误伤他批、磁盘记 cancel_requested', async () => {
    const tool = new AgentTool();
    const batchId = `a-batch-${randomUUID().slice(0, 8)}`;
    const workerIds = [`${batchId}::task-0`, `${batchId}::task-1`];
    const otherId = `z-batch-${randomUUID().slice(0, 8)}::task-0`;
    const { aborted } = installEngine(tool, {
      activeIds: [...workerIds, otherId],
    });

    // 台账：批次整体一条（控制面 `/v1/agents/control` 列的就是它）
    getAgentRunLedger().register({
      id: batchId,
      name: batchId,
      type: 'general',
      sessionId: 'sess-A',
    });
    // 磁盘：worker 逐一成行（`batchId::taskKey`），另加一条**别的批次**的行
    for (const toolCallId of [...workerIds, otherId]) {
      await getAgentRunStore().startRun({
        toolCallId,
        agentId: toolCallId === otherId ? otherId.split('::')[0] : batchId,
        name: toolCallId,
        agentType: 'general',
        status: 'running',
        batchId: toolCallId === otherId ? otherId.split('::')[0] : batchId,
        taskKey: toolCallId.split('::')[1],
      });
    }

    expect(tool.stopAgent(batchId, { privileged: true })).toBe(true);

    // E：批次 → worker 扇出（修复前 `engine.abort(batchId)` 精确匹配必然 miss）
    for (const workerId of workerIds) {
      expect(aborted).toContain(workerId);
    }
    expect(aborted).not.toContain(otherId);

    // 内存中间态（O10a③ 原语义，未被本次修复改动）
    expect(getAgentRunLedger().view(batchId)?.status).toBe('cancel_requested');

    // D：磁盘中间态落地（修复前磁盘恒为 running，重启后被自愈成 unknown）
    expect(await waitForStatus(workerIds[0], 'cancel_requested')).toBe(
      'cancel_requested'
    );
    expect(await waitForStatus(workerIds[1], 'cancel_requested')).toBe(
      'cancel_requested'
    );
    // 前缀不匹配别的批次 ⇒ 不误伤
    expect((await getAgentRunStore().getRun(otherId))?.status).toBe('running');
  });
});
