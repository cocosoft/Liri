// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`buildSwarmExecutor` 返回的 executor 的既有行为（P3-2 拆分前置）。
 *
 * 待外移的三段：描述符解析失败 fail-closed、worker 台账开启、空工具池 fail-closed。
 * 此处先锁住外部可观测结果（抛错文案、台账行、引擎入参、返回结构）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
  buildSwarmExecutor,
  type SwarmPathDeps,
  type SwarmTaskDescriptor,
} from '@openliri/tool-agent/AgentTool/swarmPath';
import {
  setAgentRunStoreForTest,
  type AgentRunStore,
} from '@openliri/tool-agent/AgentTool/AgentRunStore';
import type { Tool } from '../../../src/tools/types/Tool';

function fakeTool(name: string, category = 'misc'): Tool {
  return {
    name,
    getInfo: () => ({ name, description: `${category}`, params: [] }),
  } as unknown as Tool;
}

interface StartedRun {
  toolCallId: string;
  agentType?: string;
  status?: string;
  descriptorSource?: string;
}

interface SettledRun {
  id: string;
  status: string;
  opts: { error?: string };
}

function installFakeStore(): {
  started: StartedRun[];
  settled: SettledRun[];
} {
  const started: StartedRun[] = [];
  const settled: SettledRun[] = [];
  const store = {
    startRun: async (record: StartedRun) => {
      started.push(record);
    },
    settleRun: async (
      id: string,
      status: string,
      opts: { error?: string } = {}
    ) => {
      settled.push({ id, status, opts });
      return true;
    },
  };
  setAgentRunStoreForTest(store as unknown as AgentRunStore);
  return { started, settled };
}

interface EngineResult {
  output: string;
  completed: boolean;
  timedOut?: boolean;
  tokenUsage?: { totalTokens: number };
  attribution?: { rootCause?: string };
}

function makeDeps(opts: { pool?: Tool[]; engineResult?: EngineResult }): {
  deps: SwarmPathDeps;
  engineCalls: Array<Record<string, any>>;
} {
  const engineCalls: Array<Record<string, any>> = [];
  const deps = {
    toolName: 'agent',
    agentLedgerLifecycle:
      {} as unknown as SwarmPathDeps['agentLedgerLifecycle'],
    agentToolPool: {
      buildToolDefinitions: (
        _allowed: string[] | undefined,
        _denied: string[] | undefined,
        categoryPool: Tool[]
      ) =>
        categoryPool.map((t) => ({
          name: t.name,
          description: t.name,
          parameters: {},
        })),
      filterToolPool: (
        _allowed: string[] | undefined,
        _denied: string[] | undefined,
        categoryPool: Tool[]
      ) => categoryPool,
    } as unknown as SwarmPathDeps['agentToolPool'],
    engine: {
      execute: async (params: Record<string, any>) => {
        engineCalls.push(params);
        return (
          opts.engineResult ?? {
            output: 'worker 输出',
            completed: true,
            timedOut: false,
            tokenUsage: { totalTokens: 7 },
          }
        );
      },
    } as unknown as SwarmPathDeps['engine'],
    getInheritableToolPool: () => opts.pool ?? [fakeTool('custom_tool')],
    resolveSwarmTaskDescriptors: async () => new Map(),
  };
  return { deps, engineCalls };
}

const SIGNAL = new AbortController().signal;

function descriptors(
  taskKey: string,
  descriptor: SwarmTaskDescriptor
): Map<string, SwarmTaskDescriptor> {
  return new Map([[taskKey, descriptor]]);
}

describe('buildSwarmExecutor 既有行为', () => {
  afterEach(() => {
    setAgentRunStoreForTest(null);
  });

  it('描述符解析失败 ⇒ 不执行、台账 running → failed、抛出原始原因', async () => {
    const { started, settled } = installFakeStore();
    const { deps, engineCalls } = makeDeps({});
    const executor = buildSwarmExecutor(
      {
        signal: SIGNAL,
        batchId: 'batch-1',
        taskDescriptors: descriptors('t1', { error: '角色不存在' }),
      },
      deps
    );

    await expect(
      executor({
        systemPrompt: 'BASE',
        userPrompt: 'P',
        taskKey: 't1',
        agentType: 'verification',
        tools: ['misc'],
      })
    ).rejects.toThrow('角色不存在');

    expect(engineCalls).toHaveLength(0);
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      toolCallId: 'batch-1::t1',
      agentType: 'verification',
      status: 'running',
    });
    expect(settled).toHaveLength(1);
    expect(settled[0]).toMatchObject({
      id: 'batch-1::t1',
      status: 'failed',
      opts: { error: '角色不存在' },
    });
  });

  it('非 worker 调用（无 taskKey）⇒ 不写台账、不注入工具、正常返回', async () => {
    const { started, settled } = installFakeStore();
    const { deps, engineCalls } = makeDeps({});
    const executor = buildSwarmExecutor(
      { signal: SIGNAL, batchId: 'batch-1' },
      deps
    );

    const result = await executor({ systemPrompt: 'BASE', userPrompt: 'P' });

    expect(result.ok).toBe(true);
    expect(started).toHaveLength(0);
    expect(settled).toHaveLength(0);
    expect(engineCalls[0].tools).toEqual([]);
    expect(engineCalls[0].toolInstances?.size).toBe(0);
    expect(String(engineCalls[0].agentId).startsWith('swarm-')).toBe(true);
  });

  it('worker 工具池为空 ⇒ 台账 failed、抛错含类别与白名单信息', async () => {
    const { started, settled } = installFakeStore();
    // 池里只有 misc 类工具，而 worker 声明 search 类 ⇒ 交集为空
    const { deps, engineCalls } = makeDeps({ pool: [fakeTool('other_tool')] });
    const executor = buildSwarmExecutor(
      {
        signal: SIGNAL,
        batchId: 'batch-2',
        allowedTools: ['file_write', 'bash'],
      },
      deps
    );

    await expect(
      executor({
        systemPrompt: 'BASE',
        userPrompt: 'P',
        taskKey: 't2',
        agentType: 'general',
        tools: ['search'],
      })
    ).rejects.toThrow('worker 工具池为空：类别池与 allowedTools 无交集');

    expect(engineCalls).toHaveLength(0);
    expect(started).toHaveLength(1);
    expect(settled).toHaveLength(1);
    expect(settled[0].status).toBe('failed');
    expect(String(settled[0].opts.error)).toContain(
      'declaredCategories=[search]'
    );
  });

  it('正常 worker ⇒ 角色提示词前置、模型优先级、工具注入、台账 completed', async () => {
    const { started, settled } = installFakeStore();
    const { deps, engineCalls } = makeDeps({});
    const executor = buildSwarmExecutor(
      {
        signal: SIGNAL,
        batchId: 'batch-3',
        context: { sessionId: 's1', subagentDepth: 2 } as never,
        taskDescriptors: descriptors('t3', {
          systemPrompt: 'ROLE',
          model: 'role-model',
          source: 'db',
        }),
      },
      deps
    );

    const result = await executor({
      systemPrompt: 'BASE',
      userPrompt: 'P',
      taskKey: 't3',
      agentType: 'verification',
      tools: ['misc'],
    });

    expect(result).toEqual({
      output: 'worker 输出',
      ok: true,
      timedOut: false,
      tokens: 7,
    });
    expect(started[0]).toMatchObject({
      toolCallId: 'batch-3::t3',
      agentType: 'verification',
      descriptorSource: 'db',
    });
    expect(settled[0]).toMatchObject({
      id: 'batch-3::t3',
      status: 'completed',
    });

    const call = engineCalls[0];
    expect(call.agentId).toBe('batch-3::t3');
    expect(call.systemPrompt).toBe('ROLE\n\nBASE');
    expect(call.model).toBe('role-model');
    expect(call.assignedRole).toBe('verification');
    expect(
      call.tools.map((t: { function: { name: string } }) => t.function.name)
    ).toEqual(['custom_tool']);
    expect([...call.toolInstances.keys()]).toEqual(['custom_tool']);
    expect(call.toolContext.subagentDepth).toBe(3);

    // 批次显式模型优先于角色推荐模型
    const second = buildSwarmExecutor(
      {
        signal: SIGNAL,
        batchId: 'batch-3',
        model: 'batch-model',
        taskDescriptors: descriptors('t3', { model: 'role-model' }),
      },
      deps
    );
    await second({
      systemPrompt: 'BASE',
      userPrompt: 'P',
      taskKey: 't3',
      agentType: 'verification',
      tools: ['misc'],
    });
    expect(engineCalls[1].model).toBe('batch-model');
  });

  it('worker 执行失败 ⇒ ok=false、tokens 透传、台账 failed', async () => {
    const { settled } = installFakeStore();
    const { deps } = makeDeps({
      engineResult: {
        output: '部分产出',
        completed: false,
        timedOut: true,
        tokenUsage: { totalTokens: 12 },
        attribution: { rootCause: 'timeout' },
      },
    });
    const executor = buildSwarmExecutor(
      { signal: SIGNAL, batchId: 'batch-4' },
      deps
    );

    const result = await executor({
      systemPrompt: 'BASE',
      userPrompt: 'P',
      taskKey: 't4',
      agentType: 'general',
      tools: ['misc'],
    });

    expect(result).toMatchObject({ ok: false, timedOut: true, tokens: 12 });
    expect(settled[0].status).toBe('failed');
    expect(settled[0].opts).toMatchObject({
      attribution: { rootCause: 'timeout' },
    });
  });
});
