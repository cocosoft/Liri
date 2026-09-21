/**
 * AgentTool.tasks[] 并行分支：per-task 描述符解析 + 契约贯通（O12，B6-2）
 *
 * 锁定三件事（修复前均为"契约已声明却从未被消费"）：
 * ① `tasks[].subagent_type` ⇒ 走与单代理路径**同源**的解析链（角色提示词前置 + 推荐模型）；
 *    未知/禁用 ⇒ **fail-closed**（该任务不执行、落 `failed`、不留 `running` 残留）；
 * ② `SwarmExecutorParams.tools`（工具**类别**清单）⇒ 真正注入只读检索工具（修复前恒空池）；
 *    `agent_type` 落盘取**真实类型**（修复前恒 `'general'`）；
 * ③ 未指定 `subagent_type` 的 worker ⇒ 行为中性（沿用 AgentSwarm 硬编码提示词、不调用解析链）；
 *    verifier/synthesizer 调用不注入工具（其产物是 JSON 结论/汇总报告）。
 *
 * 说明：与 `parallelTasks.test.ts` 同法注入 fake 引擎（`Reflect.set`）；工具池经
 * `setAgentToolManager` 注入（生产由 ToolManager 注入，测试环境默认返回空池）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool } from '../../../src/tools/types/Tool';
import { getAgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';
import { getAgentRunLedger } from '../../../src/tools/AgentTool/AgentRunLedger';

/** fake 引擎的调用记录（只保留本测试断言用到的字段） */
interface EngineCall {
  systemPrompt: string;
  userPrompt: string;
  /** 工具定义里的工具名（= 实际注入给模型的工具集） */
  toolNames: string[];
  /** 工具实例映射（执行侧，与定义侧同源） */
  toolInstances: Map<string, unknown>;
  model?: string;
  /** 传给引擎的 agentId（单代理路径 = 工具 run id；并行路径 = `swarm-<uuid>`） */
  engineAgentId: string;
}

interface EngineStubParams {
  agentId?: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function?: { name?: string } }>;
  toolInstances?: Map<string, unknown>;
  model?: string;
}

/** 注入 fake 引擎并记录每次调用 */
function installEngine(
  tool: AgentTool,
  produce: (call: EngineCall) => { output: string; completed?: boolean }
): EngineCall[] {
  const calls: EngineCall[] = [];
  Reflect.set(tool, 'engine', {
    execute: async (params: EngineStubParams) => {
      const call: EngineCall = {
        systemPrompt: params.systemPrompt,
        userPrompt: params.messages[0]?.content ?? '',
        toolNames: (params.tools ?? []).map((t) => t.function?.name ?? ''),
        toolInstances: params.toolInstances ?? new Map<string, unknown>(),
        model: params.model,
        engineAgentId: params.agentId ?? '',
      };
      calls.push(call);
      const res = produce(call);
      return {
        output: res.output,
        completed: res.completed ?? true,
        timedOut: false,
      };
    },
    abort: () => true,
    ownerSessionId: () => undefined,
  });
  return calls;
}

type DescriptorStub =
  | { ok: true; source: string; systemPrompt: string; model?: string }
  | { ok: false; error: string };

/** 注入 fake 解析链（返回被请求过的 `subagent_type` 列表，用于断言"是否解析"） */
function installResolver(
  tool: AgentTool,
  resolve: (subagentType?: string) => DescriptorStub
): string[] {
  const seen: string[] = [];
  Reflect.set(
    tool,
    'resolveAgentDescriptor',
    async (params: { subagentType?: string }) => {
      seen.push(params.subagentType ?? '');
      return resolve(params.subagentType);
    }
  );
  return seen;
}

/** 只读检索（类别 `search` + `file_read`）与写入（类别 `file`）各若干，用于验证类别过滤 */
const READ_TOOL_NAMES = ['grep', 'glob', 'file_read'];
const WRITE_TOOL_NAMES = ['file_write', 'file_edit'];

/** 最小可用 Tool：本路径只消费 `name` 与 `getInfo()`（`buildToolDefinitions` 的取数口） */
function fakeTool(name: string): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${name} tool`, params: [] }),
  } as unknown as Tool;
}

/** 取某批次的 worker 落盘行（`batchId` 仅 worker 行携带） */
async function batchRows(
  metadata: Record<string, unknown>
): Promise<Array<{ status: string; agentType: string; error?: string | null }>> {
  const batchId = String(metadata['agentId']);
  const rows = await getAgentRunStore().listRuns();
  return rows
    .filter((r) => r.batchId === batchId)
    .map((r) => ({
      status: r.status,
      agentType: r.agentType,
      error: r.error ?? null,
    }));
}

describe('swarm per-task 描述符解析（O12-1）', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('指定 DB 角色：角色提示词前置 + 推荐模型 + 落盘真实类型', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'out-a', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'role-store',
      systemPrompt: 'ROLE-ARCHITECT',
      model: 'role-model',
    }));

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1', subagent_type: 'architect' }],
    });

    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    expect(calls).toHaveLength(1);
    // 角色提示词**前置**，swarm 的 worker 框架（黑板/只读契约）保留在后
    expect(calls[0].systemPrompt.startsWith('ROLE-ARCHITECT')).toBe(true);
    expect(calls[0].systemPrompt).toContain('多代理 swarm 中的一个 worker');
    expect(calls[0].model).toBe('role-model');

    const rows = await batchRows(result.metadata as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0].agentType).toBe('architect'); // 修复前恒 'general'
    expect(rows[0].status).toBe('completed');
  });

  test('未知类型 ⇒ fail-closed：不执行引擎、落 failed、原因在汇总行可见', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'never', completed: true }));
    installResolver(tool, () => ({
      ok: false,
      error: '未知的 subagent_type "foo"。可用值：…',
    }));

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1', subagent_type: 'foo' }],
    });

    expect(result.output).toContain('[FAIL] 分析需求 A');
    expect(result.output).toContain('未知的 subagent_type "foo"');
    // 关键：**根本不下发**给引擎（修复前会用硬编码提示词静默执行）
    expect(calls).toHaveLength(0);

    const rows = await batchRows(result.metadata as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed'); // 不残留 running
    expect(rows[0].error).toContain('未知的 subagent_type');
  });

  test('未指定 subagent_type ⇒ 不解析（行为中性），沿用 AgentSwarm 提示词', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'out-a', completed: true }));
    const resolverSeen = installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'SHOULD-NOT-BE-USED',
    }));

    await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
    });

    expect(resolverSeen).toHaveLength(0);
    expect(calls[0].systemPrompt).toContain('多代理 swarm 中的一个 worker');
    expect(calls[0].systemPrompt).not.toContain('SHOULD-NOT-BE-USED');
  });

  test('批次显式模型优先于角色推荐模型（与单代理路径同优先级）', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'out-a', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'role-store',
      systemPrompt: 'ROLE-X',
      model: 'role-model',
    }));

    await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      model: 'batch-model',
      tasks: [{ description: '分析需求 A', prompt: 'p1', subagent_type: 'architect' }],
    });

    expect(calls[0].model).toBe('batch-model');
  });
});

describe('swarm 工具契约贯通（O12-2）', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('worker：按类别注入只读检索工具（写工具与委派入口均不注入）', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'out-a', completed: true }));

    await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
    });

    // `search` + `file_read` 两个类别命中（修复前恒空 ⇒ worker 无任何工具）
    expect([...calls[0].toolNames].sort()).toEqual([
      'file_read',
      'glob',
      'grep',
    ]);
    // 定义侧与执行侧同源（O7）
    expect([...calls[0].toolInstances.keys()].sort()).toEqual([
      'file_read',
      'glob',
      'grep',
    ]);
    // 写入类别（`file`）不注入 —— 与 worker 提示词的"只读操作"一致
    expect(calls[0].toolInstances.has('file_write')).toBe(false);
    expect(calls[0].toolInstances.has('file_edit')).toBe(false);
  });

  test('verifier 调用不注入工具（门禁产物是 JSON，避免非确定性）', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, (call) =>
      call.userPrompt.includes('worker 输出')
        ? { output: JSON.stringify({ pass: true, feedback: '通过' }), completed: true }
        : { output: 'out-a', completed: true }
    );

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [{ description: '分析需求 A', prompt: 'p1' }],
      verify: true,
    });

    const verifier = calls.find((c) => c.userPrompt.includes('worker 输出'));
    expect(verifier).toBeDefined();
    expect(verifier?.toolNames).toEqual([]);
    expect(verifier?.toolInstances.size).toBe(0);
    // 门禁结论仍被采纳（工具缺省不影响判定链）
    expect(result.output).toContain('allPassed: true');

    const worker = calls.find((c) => c.userPrompt.includes('你的子任务'));
    expect((worker?.toolNames.length ?? 0)).toBeGreaterThan(0);
  });
});

describe('可观测面（O19）：来源落盘 + 状态查询回退磁盘', () => {
  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
  });

  afterEach(() => {
    setAgentToolManager(() => []);
  });

  test('并行批次 worker 行记录描述符来源（role-store）', async () => {
    const tool = new AgentTool();
    installEngine(tool, () => ({ output: 'out-a', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'role-store',
      systemPrompt: 'ROLE-ARCHITECT',
    }));

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '分析需求 A', prompt: 'p1', subagent_type: 'architect' },
      ],
    });

    const batchId = String((result.metadata as Record<string, unknown>)['agentId']);
    const rows = (await getAgentRunStore().listRuns()).filter(
      (r) => r.batchId === batchId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptorSource).toBe('role-store');
  });

  test('单代理路径：解析成功 ⇒ 该 run 行记录来源', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({ output: 'ok', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'BUILTIN-PROMPT',
    }));

    await tool.execute({
      description: '单代理',
      prompt: '做点事',
      subagent_type: 'explore',
    });

    const runId = calls[0]?.engineAgentId ?? '';
    expect(runId).not.toBe('');
    expect((await getAgentRunStore().getRun(runId))?.descriptorSource).toBe(
      'builtin'
    );
  });

  test('getAgentStatus：内存台账命中 ⇒ source=memory', async () => {
    const tool = new AgentTool();
    const id = `o19-mem-${randomUUID().slice(0, 8)}`;
    getAgentRunLedger().register({ id, name: id, type: 'general' });

    const status = await tool.getAgentStatus(id);
    expect(status.status).toBe('running');
    expect(status.source).toBe('memory');
  });

  test('getAgentStatus：内存未命中 ⇒ 回退磁盘台账（含结算后）', async () => {
    const tool = new AgentTool();
    const id = `o19-store-${randomUUID().slice(0, 8)}`;
    await getAgentRunStore().startRun({
      toolCallId: id,
      agentId: id,
      name: 'disk-only',
      agentType: 'general',
      status: 'running',
    });

    const running = await tool.getAgentStatus(id);
    expect(running.status).toBe('running');
    expect(running.source).toBe('store');
    expect(running.duration).toBeGreaterThanOrEqual(0);

    await getAgentRunStore().settleRun(id, 'completed');
    const settled = await tool.getAgentStatus(id);
    expect(settled.status).toBe('completed');
    expect(settled.source).toBe('store');
  });

  test('getAgentStatus：两处都没有 ⇒ not_found', async () => {
    const tool = new AgentTool();

    const status = await tool.getAgentStatus(
      `o19-missing-${randomUUID().slice(0, 8)}`
    );
    expect(status.status).toBe('not_found');
    expect(status.source).toBeUndefined();
  });
});
