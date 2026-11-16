// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 流式工具轮主体特征化（P3-2，2026-11-16）
//
// `runStreamToolLoop` 的复杂度来自「单个 ReAct 事件 → 多条副作用链」：
// 落盘 assistant/tool_call、acting_start 状态入轨、todo 落盘与产出、心跳节流、收尾补偿。
// 判错只表现为「事件顺序/条数错」「心跳缺失或重复」（不报错）⇒ 外移前先按事件逐条钉住。
//
// 测试策略同 `streamMessageFlow-p5-todo.test.ts`：spyOn 统一循环工厂返回脚本化假 loop，
// 经 `runStreamMessage` 入口驱动（工具轮门控由含 tool_calls 的响应满足）。
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createTestHost } from './helpers';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatResponse, ToolAwareClient } from '@modules/ai';
import * as createAgentLoopModule from '../../../src/chat/createAgentLoop.js';

type ScriptedEvent = Record<string, unknown> & { type: string };

interface FakeLoopScript {
  events?: ScriptedEvent[];
  /** 首次 getPendingTodos 返回该 todo，其后为空（模拟「取走即清空」） */
  todoOnce?: Record<string, unknown>;
  heartbeat?: {
    completedToolNames: string[];
    totalCompletedToolCount: number;
  };
  terminationReason?: string;
  terminationTip?: string | null;
  longTaskSignal?: {
    isLongTask: boolean;
    pendingTodoCount: number;
    consumedTurns: number;
  };
  throwOnRun?: Error;
}

/** 脚本化假 loop：run() 顺序吐事件，其余端口按脚本返回固定值 */
function makeFakeLoop(script: FakeLoopScript): Record<string, unknown> {
  let todoTaken = false;
  return {
    async *run(): AsyncGenerator<ScriptedEvent, void, unknown> {
      if (script.throwOnRun) throw script.throwOnRun;
      for (const event of script.events ?? []) yield event;
    },
    getHeartbeatData: () =>
      script.heartbeat ?? {
        completedToolNames: [],
        totalCompletedToolCount: 0,
      },
    getPendingTodos: () => {
      if (!todoTaken && script.todoOnce) {
        todoTaken = true;
        return [script.todoOnce];
      }
      return [];
    },
    getAssistantMessage: () => ({ id: 'm', content: '', metadata: {} }),
    getTerminationTip: () => script.terminationTip ?? null,
    getTerminationReason: () => script.terminationReason,
    getLongTaskSignal: () =>
      script.longTaskSignal ?? {
        isLongTask: false,
        pendingTodoCount: 0,
        consumedTurns: 0,
      },
    flushTerminalSettlement: async () => {},
  };
}

let restoreLoop: (() => void) | undefined;
let script: FakeLoopScript;
let longTaskCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  script = {};
  longTaskCalls = [];
  restoreLoop = spyOn(
    createAgentLoopModule,
    'createChatAgentLoop'
  ).mockImplementation(() => makeFakeLoop(script) as never);
});
afterEach(() => {
  restoreLoop?.();
  restoreLoop = undefined;
});

const { runStreamMessage } =
  await import('../../../src/chat/orchestrator/streamMessageFlow.js');

/** 收集 appendStreamEvent 写入的事件 */
function collectEvents(
  host: ChatOrchestratorHost
): Array<{ type: string; data: unknown }> {
  const events: Array<{ type: string; data: unknown }> = [];
  (host as { appendStreamEvent: unknown }).appendStreamEvent = async (
    _sid: string,
    ev: { type: string; data: unknown }
  ) => {
    events.push({ type: ev.type, data: ev.data });
    return { ok: true, tailSeq: events.length };
  };
  return events;
}

/** 含 tool_calls 的响应：满足工具轮门控 */
function createToolCallClient(): ToolAwareClient {
  return {
    streamMessage: () =>
      (async function* (): AsyncGenerator<never, ChatResponse, unknown> {
        return {
          content: '',
          role: 'assistant',
          id: '',
          tool_calls: [{ id: 'tc1', name: 'file_read', arguments: {} }],
        } as unknown as ChatResponse;
      })(),
    sendMessage: async () =>
      ({ content: '', role: 'assistant', id: '' }) as unknown as ChatResponse,
    getProviderId: () => 'test-provider',
    getBaseUrl: () => 'http://localhost:test',
  } as unknown as ToolAwareClient;
}

async function runWith(host: ChatOrchestratorHost): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of runStreamMessage(host, '测试', {})) {
    chunks.push(chunk);
  }
  return chunks;
}

function makeHost(): ChatOrchestratorHost {
  const llmClient = createToolCallClient();
  return createTestHost({
    getLLMClient: () => llmClient,
    getClientForModel: () => llmClient,
    startRollbackRound: async () => {},
    endRollbackRound: async () => {},
    persistSessionMetadata: async () => {},
    onLongTaskSignal: (async (
      _session: unknown,
      signal: Record<string, unknown>
    ) => {
      longTaskCalls.push(signal);
    }) as never,
  });
}

const phaseChunks = (chunks: unknown[]) =>
  chunks.filter((c) => (c as { type?: string }).type === 'execution_phase');

describe('工具轮事件：tool_start 落盘与心跳', () => {
  it('tool_start ⇒ assistant/tool_call 事件（callSeq 交由 append 分配）+ 心跳步骤', async () => {
    script = {
      events: [{ type: 'tool_start', callId: 'tc1', name: 'read_file' }],
      heartbeat: {
        completedToolNames: ['read_file'],
        totalCompletedToolCount: 1,
      },
    };
    const host = makeHost();
    const events = collectEvents(host);
    const chunks = await runWith(host);

    const toolCallEvents = events.filter(
      (e) => e.type === 'assistant/tool_call'
    );
    expect(toolCallEvents.length).toBe(1);
    expect(toolCallEvents[0].data).toMatchObject({
      toolCallId: 'tc1',
      name: 'read_file',
      args: {},
      callSeq: 0,
    });

    // 首个 tool_start 前 heartbeatAt=0 ⇒ 必然产出一次执行阶段心跳
    const phases = phaseChunks(chunks);
    expect(phases.length).toBe(1);
    const phase = phases[0] as {
      content: string;
      executionPhase: {
        phase: string;
        progress: number;
        steps: Array<{ name: string; status: string }>;
        totalSteps: number;
        truncated: boolean;
        currentStep: string;
      };
    };
    expect(phase.content).toBe('正在执行 read_file');
    expect(phase.executionPhase.phase).toBe('implementing');
    expect(phase.executionPhase.progress).toBe(1);
    expect(phase.executionPhase.currentStep).toBe('read_file');
    expect(phase.executionPhase.totalSteps).toBe(1);
    expect(phase.executionPhase.truncated).toBe(false);
  });

  it('5s 内的 tool_end 不重复产出心跳（节流）', async () => {
    script = {
      events: [
        { type: 'tool_start', callId: 'tc1', name: 'read_file' },
        { type: 'tool_end', callId: 'tc1', name: 'read_file' },
      ],
    };
    const chunks = await runWith(makeHost());
    expect(phaseChunks(chunks).length).toBe(1);
  });
});

describe('工具轮事件：acting_start 与 todo', () => {
  it('acting_start ⇒ assistant/status 事件（执行 N 个工具调用）', async () => {
    script = { events: [{ type: 'acting_start', toolCount: 2 }] };
    const host = makeHost();
    const events = collectEvents(host);
    await runWith(host);
    const statusEvents = events.filter((e) => e.type === 'assistant/status');
    expect(statusEvents.length).toBe(1);
    expect(statusEvents[0].data).toEqual({ content: '执行 2 个工具调用' });
  });

  it('循环内待消费 todo ⇒ assistant/todo 落盘 + todo chunk', async () => {
    script = {
      events: [{ type: 'acting_start', toolCount: 1 }],
      todoOnce: {
        title: 't',
        phase: 'pending',
        tasks: [{ id: 't1', name: 'n', status: 'todo', dependsOn: [] }],
      },
    };
    const host = makeHost();
    const events = collectEvents(host);
    const chunks = await runWith(host);

    const todoEvents = events.filter((e) => e.type === 'assistant/todo');
    expect(todoEvents.length).toBe(1);
    const data = todoEvents[0].data as {
      action: string;
      taskCard: { title: string };
    };
    expect(data.action).toBe('write');
    expect(data.taskCard.title).toBe('t');

    const todoChunks = chunks.filter(
      (c) => (c as { type?: string }).type === 'todo'
    );
    expect(todoChunks.length).toBe(1);
    const todoChunk = todoChunks[0] as { content: string; todoData: unknown };
    expect(JSON.parse(todoChunk.content)).toMatchObject({ title: 't' });
  });

  it('终止提示 ⇒ 补发 text chunk', async () => {
    script = { terminationTip: '已达工具轮上限' };
    const chunks = await runWith(makeHost());
    const texts = chunks.filter(
      (c) => (c as { type?: string }).type === 'text'
    ) as Array<{ content: string }>;
    expect(texts.some((t) => t.content === '已达工具轮上限')).toBe(true);
  });
});

describe('工具轮收尾：长任务信号与异常', () => {
  it('长任务信号照常上抛（非等待审批）', async () => {
    script = {
      terminationReason: 'end_turn',
      longTaskSignal: {
        isLongTask: true,
        pendingTodoCount: 3,
        consumedTurns: 7,
      },
    };
    await runWith(makeHost());
    expect(longTaskCalls).toEqual([{ pendingTodoCount: 3, consumedTurns: 7 }]);
  });

  it('等待审批收尾 ⇒ 不上抛长任务信号', async () => {
    script = {
      terminationReason: 'awaiting_approval',
      longTaskSignal: {
        isLongTask: true,
        pendingTodoCount: 3,
        consumedTurns: 7,
      },
    };
    await runWith(makeHost());
    expect(longTaskCalls).toEqual([]);
  });

  it('工具循环抛错 ⇒ error chunk + system/error 落盘', async () => {
    script = { throwOnRun: new Error('tool exploded') };
    const host = makeHost();
    const events = collectEvents(host);
    const chunks = await runWith(host);

    const errorChunks = chunks.filter(
      (c) => (c as { type?: string }).type === 'error'
    ) as Array<{ content: string }>;
    expect(errorChunks.length).toBe(1);
    expect(errorChunks[0].content.startsWith('工具执行环节出错: ')).toBe(true);

    const errorEvents = events.filter((e) => e.type === 'system/error');
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].data).toMatchObject({ module: 'chat:ChatManager' });
  });
});
