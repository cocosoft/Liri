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
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import {
  AgentTool,
  setAgentToolManager,
} from '../../../src/tools/AgentTool/AgentTool';
import { ToolExecutionStatus } from '../../../src/tools/types/ToolResult';
import type { Tool } from '../../../src/tools/types/Tool';
import { getAgentRunStore } from '../../../src/tools/AgentTool/AgentRunStore';
import { getAgentRunLedger } from '../../../src/tools/AgentTool/AgentRunLedger';
import {
  TaskGoalStore,
  setTaskGoalStoreForTest,
} from '../../../src/tasks/goal/TaskGoalStore';
import {
  IDLE_CONTINUE_DELAY_SEC,
  IDLE_CONTINUE_TASK_PREFIX,
  setIdleContinuationSchedulerForTest,
} from '../../../src/tasks/goal/goalIdleContinuation';

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
  produce: (call: EngineCall) => {
    output: string;
    completed?: boolean;
    /** M-8 用例用：真实引擎的 token 用量聚合（未提供 ⇒ executor 记 0，不估算） */
    tokenUsage?: { totalTokens: number };
  }
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
        tokenUsage: res.tokenUsage,
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
): Promise<
  Array<{ status: string; agentType: string; error?: string | null }>
> {
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
    const calls = installEngine(tool, () => ({
      output: 'out-a',
      completed: true,
    }));
    installResolver(tool, () => ({
      ok: true,
      source: 'role-store',
      systemPrompt: 'ROLE-ARCHITECT',
      model: 'role-model',
    }));

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '分析需求 A', prompt: 'p1', subagent_type: 'architect' },
      ],
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
    const calls = installEngine(tool, () => ({
      output: 'never',
      completed: true,
    }));
    installResolver(tool, () => ({
      ok: false,
      error: '未知的 subagent_type "foo"。可用值：…',
    }));

    const result = await tool.execute({
      description: '并行 A',
      prompt: '总任务',
      tasks: [
        { description: '分析需求 A', prompt: 'p1', subagent_type: 'foo' },
      ],
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
    const calls = installEngine(tool, () => ({
      output: 'out-a',
      completed: true,
    }));
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
    const calls = installEngine(tool, () => ({
      output: 'out-a',
      completed: true,
    }));
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
      tasks: [
        { description: '分析需求 A', prompt: 'p1', subagent_type: 'architect' },
      ],
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
    const calls = installEngine(tool, () => ({
      output: 'out-a',
      completed: true,
    }));

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
        ? {
            output: JSON.stringify({ pass: true, feedback: '通过' }),
            completed: true,
          }
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
    expect(worker?.toolNames.length ?? 0).toBeGreaterThan(0);
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

    const batchId = String(
      (result.metadata as Record<string, unknown>)['agentId']
    );
    const rows = (await getAgentRunStore().listRuns()).filter(
      (r) => r.batchId === batchId
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].descriptorSource).toBe('role-store');
  });

  test('单代理路径：解析成功 ⇒ 该 run 行记录来源', async () => {
    const tool = new AgentTool();
    const calls = installEngine(tool, () => ({
      output: 'ok',
      completed: true,
    }));
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

/**
 * M-5（P0-8，2026-09-22）：**结算即通知** —— 通知收敛为单一入口。
 *
 * 修复前 7 处 `settleRun` 调用点里只有 3 处手工补了通知：
 * **单代理前台结算**（`execute()` 末尾）与 **descriptor fail-closed** 两条路径漏掉
 * ⇒ 其上的 yield 等待永不收敛（"子代理结算"是该等待唯一的恢复触发源）。
 * 修复后通知由 `settleRun()` 统一发出（`sessionId` 取自台账归属），并**删除**了
 * 3 处手工调用（避免同一结算重复通知）。
 *
 * 说明：用例用实例级包装替换真实通知方法 —— 只验证"是否被调用 / 传入了什么"，
 * **不触碰真实 `app.db` 的 outbox**（真实通知的端到端行为由 `tests/chat` 覆盖）。
 */
describe('M-5：结算通知收敛为单一入口', () => {
  function captureNotifications(tool: AgentTool): Array<string | undefined> {
    const notified: Array<string | undefined> = [];
    Reflect.set(tool, 'notifyYieldSettlement', async (sessionId?: string) => {
      notified.push(sessionId);
    });
    return notified;
  }

  test('单代理路径结算 ⇒ 发出通知且 `sessionId` 取自台账归属（修复前漏发）', async () => {
    const tool = new AgentTool();
    installEngine(tool, () => ({ output: 'ok', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));
    const notified = captureNotifications(tool);

    await tool.execute(
      { description: '单代理', prompt: '做点事', subagent_type: 'explore' },
      { sessionId: 'sess-m5' } as unknown as Parameters<AgentTool['execute']>[1]
    );

    // 修复前单代理路径**没有任何通知调用** ⇒ 此处为空数组
    expect(notified).toEqual(['sess-m5']);
  });

  test('并行批次路径 ⇒ 通知**恰好一次**（手工调用已删除，不重复）', async () => {
    const tool = new AgentTool();
    installEngine(tool, () => ({ output: 'out-a', completed: true }));
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));
    const notified = captureNotifications(tool);

    await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '子任务 A', prompt: 'p1' }],
      },
      { sessionId: 'sess-m5-batch' } as unknown as Parameters<
        AgentTool['execute']
      >[1]
    );

    expect(notified).toEqual(['sess-m5-batch']);
  });

  /**
   * M-5b（2026-09-25）：**真实引擎会先结算** —— 通知/落盘不得被 `settle()` 的返回值短路。
   *
   * 真实时序：`SubAgentEngine.execute()` 在返回**之前**调 `endRun()` → `ledger.settle()`
   * （`SubAgentEngine.ts:461/729`），而 `AgentTool.settleRun()` 在 `runWithEngine()` 返回
   * **之后**才执行 ⇒ 后者拿到的 `settle()` 恒为 `false`。修复前该分支 `return`，
   * 于是磁盘行永久停在 `running`、yield 通知永不发出（"唯一入口"被运行时守卫短路）。
   * 本用例的 stub 引擎**如实模拟**该先行结算顺序（修复前必失败）。
   */
  test('引擎先行 settle ⇒ 仍须落盘终态并发出通知（修复前被 `!settled` 短路）', async () => {
    const tool = new AgentTool();
    installEngine(tool, (call) => {
      // 模拟真实引擎出口的 `endRun`：先于 `AgentTool.settleRun` 落内存终态
      getAgentRunLedger().settle(call.engineAgentId, 'completed');
      return { output: 'ok', completed: true };
    });
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));
    const notified = captureNotifications(tool);
    const before = await getAgentRunStore().listRuns();

    const result = await tool.execute(
      { description: '单代理', prompt: '做点事', subagent_type: 'explore' },
      { sessionId: 'sess-engine-settled' } as unknown as Parameters<
        AgentTool['execute']
      >[1]
    );
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);

    // ① 通知必须发出（修复前为空数组 —— 提前 return 跳过了 `notifyYieldSettlement`）
    expect(notified).toEqual(['sess-engine-settled']);

    // ② 磁盘行必须落到终态（修复前永久 `running`；`AgentRunStore` 的终态守卫对
    //    重复写安全，故本断言测的是"是否被写入"，不是"是否只写一次"）
    const added = (await getAgentRunStore().listRuns()).filter(
      (r) => !before.some((b) => b.toolCallId === r.toolCallId)
    );
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('completed');
  });

  /**
   * M-9b（2026-09-25）：**后台路径的额度预留不得提前释放**。
   *
   * 修复前 `execute()` 的 `finally` 无条件 `reservation.release()`：后台工具在
   * `runBackgroundPath` 返回时即交回，而 run 仍在 `.then/.catch` 里跑 ⇒ ① 并发槽位提前
   * 回收（`liveCount()` 失真）② `release()` 委托的 `settle()` 把条目**提前写成 `failed`**
   * ⇒ 回调按真实结果结算时被终态幂等拒绝（磁盘停 `running`、通知不发）。
   */
  test('后台路径：run 运行期**真实占额**，终态与通知在回调中落定（修复前槽位已提前释放）', async () => {
    const tool = new AgentTool();
    let engineAgentId = '';
    let signalStarted: () => void = () => {};
    const engineStarted = new Promise<void>((r) => {
      signalStarted = r;
    });
    let openEngineGate: () => void = () => {};
    const engineGate = new Promise<void>((r) => {
      openEngineGate = r;
    });
    // 通知即"回调已结算"的确定性信号（避免用 sleep 等竞态）
    const notified: Array<string | undefined> = [];
    let signalSettled: () => void = () => {};
    const settlementNotified = new Promise<void>((r) => {
      signalSettled = r;
    });
    Reflect.set(tool, 'notifyYieldSettlement', async (sessionId?: string) => {
      notified.push(sessionId);
      signalSettled();
    });
    Reflect.set(tool, 'engine', {
      execute: async (params: { agentId?: string }) => {
        engineAgentId = params.agentId ?? '';
        signalStarted();
        await engineGate;
        return { output: 'bg-ok', completed: true, timedOut: false };
      },
    });
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));
    const liveBefore = getAgentRunLedger().liveCount();
    const before = await getAgentRunStore().listRuns();

    const result = await tool.execute(
      {
        description: '后台',
        prompt: '做点事',
        subagent_type: 'explore',
        run_in_background: true,
      },
      { sessionId: 'sess-bg' } as unknown as Parameters<AgentTool['execute']>[1]
    );
    // 工具已交回（后台语义），而 run 仍在引擎里跑
    expect(result.status).toBe(ToolExecutionStatus.SUCCESS);
    await engineStarted;

    // ① 运行期仍占额且状态为 `running`（修复前此处已是 0 / `failed`）
    expect(engineAgentId).not.toBe('');
    expect(getAgentRunLedger().view(engineAgentId)?.status).toBe('running');
    expect(getAgentRunLedger().liveCount()).toBe(liveBefore + 1);

    openEngineGate();
    await settlementNotified;

    // ② 结算后：通知归属正确、槽位释放、终态正确
    expect(notified).toEqual(['sess-bg']);
    expect(getAgentRunLedger().liveCount()).toBe(liveBefore);
    expect(getAgentRunLedger().view(engineAgentId)?.status).toBe('completed');
    const added = (await getAgentRunStore().listRuns()).filter(
      (r) => !before.some((b) => b.toolCallId === r.toolCallId)
    );
    expect(added).toHaveLength(1);
    expect(added[0].status).toBe('completed');
  });
});

/**
 * M-8（2026-09-22）：**预算触顶的收尾指令注入 LLM 输入**。
 *
 * 修复前：`settleGoalForRun` 产出的 `closingInstruction` **只记 warn 日志** ——
 * 模型永远不知道"预算已耗尽、应停止新工作并盘点"（方案 §15.12 未做项 1）。
 * 修复后：指令追加到批次 tool result 的 `result` 文本尾部 —— `TAORLoop` 会把
 * `result` 序列化为 `role:'tool'` 消息（`TAORLoop.ts:1059-1074`）⇒ 模型下一轮必然读到。
 * 通道**复用既有 tool result**，未触顶路径输出逐字不变。
 *
 * 注意：worker 工具池空集时 `AgentTool` 会 **fail-closed 不执行引擎**（`AgentTool.ts:1457`）
 * ⇒ 不会产生 token 用量。故本组用例必须注入非空工具池（与 O12-1 组同法）。
 */
describe('M-8：预算触顶收尾指令注入 LLM 输入', () => {
  let store: TaskGoalStore | undefined;
  let dbPath = '';

  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    setTaskGoalStoreForTest(null);
    store?.close();
    store = undefined;
    if (dbPath) {
      try {
        unlinkSync(dbPath);
      } catch {
        // @ignore-catch — 清理临时库失败不影响断言
      }
      dbPath = '';
    }
  });

  /** 临时库注入（**不污染真实 `app.db`**） */
  function installStore(): TaskGoalStore {
    dbPath = join(tmpdir(), `agent-tool-goal-${randomUUID().slice(0, 8)}.db`);
    store = new TaskGoalStore(dbPath);
    setTaskGoalStoreForTest(store);
    return store;
  }

  /** 跑一次真实的并行批次路径，返回 tool result 文本（= 模型下一轮读到的内容） */
  async function runBatch(
    produce: Parameters<typeof installEngine>[1],
    sessionId: string
  ): Promise<string> {
    const tool = new AgentTool();
    installEngine(tool, produce);
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));
    const res = await tool.execute(
      {
        description: '并行 A',
        prompt: '总任务',
        tasks: [{ description: '子任务 A', prompt: 'p1' }],
      },
      { sessionId } as unknown as Parameters<AgentTool['execute']>[1]
    );
    return String(res.result ?? res.output ?? '');
  }

  const overBudget = (): {
    output: string;
    completed: boolean;
    tokenUsage: { totalTokens: number };
  } => ({
    output: 'worker out',
    completed: true,
    tokenUsage: { totalTokens: 150 },
  });

  test('触顶 ⇒ tool result 携带收尾指令（修复前只有日志，用例必失败）', async () => {
    const goalStore = installStore();
    await goalStore.create({
      objective: '长期目标',
      sessionId: 'sess-m8-over',
      tokenBudget: 100,
    });

    const text = await runBatch(overBudget, 'sess-m8-over');

    expect(text).toContain('[SYSTEM]');
    expect(text).toContain('(150/100)');
    expect(text).toContain('Stop starting new work now');
  });

  test('未触顶 ⇒ 输出不含收尾指令（零回归）', async () => {
    const goalStore = installStore();
    await goalStore.create({
      objective: '长期目标',
      sessionId: 'sess-m8-under',
      tokenBudget: 10000,
    });

    const text = await runBatch(overBudget, 'sess-m8-under');

    expect(text).not.toContain('[SYSTEM]');
  });

  test('该会话无目标 ⇒ 输出不含收尾指令（不建行、不注入）', async () => {
    const goalStore = installStore();

    const text = await runBatch(overBudget, 'sess-m8-none');

    expect(text).not.toContain('[SYSTEM]');
    expect(await goalStore.listBySession('sess-m8-none')).toEqual([]);
  });
});

/**
 * M-7 接线（2026-09-22）：**`blocked` 结算 ⇒ 登记一次空闲续接**。
 *
 * 只测**接线**（是否登记 / `taskId` 与 `streak` 是否正确 / 是否只在 `blocked` 时登记）；
 * 登记与可续性判定本身由 `tests/tasks/goal/goalIdleContinuation.test.ts` 覆盖。
 *
 * 必须经 `setIdleContinuationSchedulerForTest` 注入假调度器 —— 生产默认取 CG3 单例，
 * 测试环境为 `null` ⇒ `enqueueIdleContinuation` 恒返回 false，**接线断了也会"看起来正常"**
 *（正是今天在 route-table 注册线上踩过的同类漏挂坑）。
 */
describe('M-7：blocked 结算 ⇒ 登记空闲续接', () => {
  let store: TaskGoalStore | undefined;
  let dbPath = '';
  const scheduled: Array<{
    sessionId: string;
    taskId: string;
    seconds: number;
  }> = [];

  beforeEach(() => {
    setAgentToolManager(() =>
      [...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].map(fakeTool)
    );
    setIdleContinuationSchedulerForTest({
      sleepFor: async (sessionId, taskId, seconds) => {
        scheduled.push({ sessionId, taskId, seconds });
        return { id: `wake-${scheduled.length}` };
      },
    });
  });

  afterEach(() => {
    setAgentToolManager(() => []);
    setIdleContinuationSchedulerForTest(undefined);
    setTaskGoalStoreForTest(null);
    scheduled.length = 0;
    store?.close();
    store = undefined;
    if (dbPath) {
      try {
        unlinkSync(dbPath);
      } catch {
        // @ignore-catch — 清理临时库失败不影响断言
      }
      dbPath = '';
    }
  });

  function installStore(): TaskGoalStore {
    dbPath = join(tmpdir(), `agent-tool-idle-${randomUUID().slice(0, 8)}.db`);
    store = new TaskGoalStore(dbPath);
    setTaskGoalStoreForTest(store);
    return store;
  }

  /** 跑 2 个任务的批次；`failSecond` ⇒ 第 2 个 worker 失败（得到"部分成功"= blocked） */
  async function runTwoTaskBatch(
    sessionId: string,
    failSecond: boolean
  ): Promise<void> {
    const tool = new AgentTool();
    let call = 0;
    installEngine(tool, () => {
      call += 1;
      return { output: `out-${call}`, completed: !(failSecond && call === 2) };
    });
    installResolver(tool, () => ({
      ok: true,
      source: 'builtin',
      systemPrompt: 'P',
    }));

    await tool.execute(
      {
        description: '并行',
        prompt: '总任务',
        tasks: [
          { description: '子任务 A', prompt: 'p1' },
          { description: '子任务 B', prompt: 'p2' },
        ],
      },
      { sessionId } as unknown as Parameters<AgentTool['execute']>[1]
    );
  }

  test('部分成功 ⇒ 落 blocked 且登记一次（taskId 编码 streak=1）', async () => {
    const goalStore = installStore();
    const goal = await goalStore.create({
      objective: '慢目标',
      sessionId: 'sess-idle-blocked',
    });

    await runTwoTaskBatch('sess-idle-blocked', true);

    expect((await goalStore.get(goal.id))?.status).toBe('blocked');
    expect(scheduled).toEqual([
      {
        sessionId: 'sess-idle-blocked',
        taskId: `${IDLE_CONTINUE_TASK_PREFIX}${goal.id}:1`,
        seconds: IDLE_CONTINUE_DELAY_SEC,
      },
    ]);
  });

  test('全部通过 ⇒ 落 completed 且**不登记**（只有 blocked 才登记）', async () => {
    const goalStore = installStore();
    const goal = await goalStore.create({
      objective: '一次过',
      sessionId: 'sess-idle-done',
    });

    await runTwoTaskBatch('sess-idle-done', false);

    expect((await goalStore.get(goal.id))?.status).toBe('completed');
    expect(scheduled).toEqual([]);
  });
});
