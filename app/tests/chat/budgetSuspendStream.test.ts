// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Task 5（债二-预算挂起续跑）：流式链日预算耗尽 ⇒ 挂起落点。
//
// 门控：`FEATURE_BUDGET_SUSPEND_RESUME`（默认关）⇒ 关时零行为变更（不落标记、不登记）。
// 开关开：日预算耗尽 ⇒ `StreamingAutoCheckpoint.suspend` 落一条 `label='budget_suspend'`
// 检查点，并登记到 `BudgetSuspendCoordinator`（chain='stream'）。
// 既有语义不变：仍置 `budget_exhausted` 相位、仍走 finalize（不抛错）。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import { StreamingAutoCheckpoint } from '../../src/chat/services/StreamingAutoCheckpoint.js';
import { toStreamingCheckpointPort } from '../../src/chat/orchestrator/streamMessageToolLoopContext.js';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend';

const LIMIT = 100;
const PER_ROUND = 60;
const ROUNDS = 8;
const SESSION_ID = 'sess-budget-suspend-stream';
const FLAG = 'FEATURE_BUDGET_SUSPEND_RESUME';

interface Saved {
  label?: string;
  metadata?: Record<string, unknown>;
}

function makeCtx(
  counter: { calls: number },
  saved: Saved[],
  streamingCheckpointOverride?: unknown
): ToolLoopContext {
  const nextResponse = (): ChatResponse => {
    counter.calls++;
    if (counter.calls <= ROUNDS) {
      return {
        content: `执行第 ${counter.calls} 步`,
        stop_reason: 'tool_calls',
        tool_calls: [
          {
            id: `tc${counter.calls}`,
            name: 'todo_write',
            arguments: { round: counter.calls },
          },
        ],
      } as ChatResponse;
    }
    return { content: '完成', stop_reason: 'stop' } as ChatResponse;
  };

  // 记录 saveCheckpointWithData 调用：既覆盖 auto 增量，也用于断言 budget_suspend 落点
  const checkpointService = {
    saveCheckpointWithData: async (
      sessionId: string,
      _messages: unknown[],
      metadata: Record<string, unknown>,
      _state: unknown,
      label?: string
    ) => {
      saved.push({ label, metadata });
      return { id: `cp-${saved.length}`, label, sessionId };
    },
  };
  const streamingCheckpoint = new StreamingAutoCheckpoint(
    checkpointService as never,
    SESSION_ID
  );

  return {
    session: { id: SESSION_ID, messages: [], state: 'active' },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }) => {
      // 模拟"每轮工具执行即产生真实消耗"
      getDailyBudget().recordUsage(PER_ROUND);
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: 'ok',
        error: undefined,
      };
    },
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({
        id: 'tool-msg',
        content: String(result),
      }),
      createAssistantMessage: (content: string) => ({
        id: 'assistant-msg',
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService,
    streamingCheckpoint: streamingCheckpointOverride ?? streamingCheckpoint,
    activeClient: {
      streamMessage: async function* (): AsyncGenerator<string, ChatResponse> {
        yield '';
        return nextResponse();
      },
      sendMessage: async () => nextResponse(),
      getProviderId: () => 'mock',
    },
    unifiedTracker: {
      resetStreamTokens: () => {},
      updateBaselineForRound: () => {},
    },
    recordChatResponseUsage: () => {},
    toolResultRegistry: {
      storeResult: () => {},
      getCurrentRound: () => 0,
      nextRound: () => 1,
    },
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (m: Record<string, unknown>[]) => m,
    maxToolTurns: 30,
    estimateMessagesTokens: () => 0,
  } as unknown as ToolLoopContext;
}

function makeInput(): never {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never;
}

async function runLoop(
  saved: Saved[],
  streamingCheckpointOverride?: unknown
): Promise<{
  loop: ReActToolLoop;
  returned: unknown;
  stops: unknown[];
  warns: unknown[];
}> {
  const stops: unknown[] = [];
  const warns: unknown[] = [];
  const off = addLogHandler((entry) => {
    if (entry.message === 'reActLoop:daily_budget_exhausted') {
      stops.push(entry.data);
    }
    if (entry.message === 'reactToolLoop:budget_suspend_no_checkpoint') {
      warns.push(entry.data);
    }
  });
  try {
    const input = makeInput();
    const loop = new ReActToolLoop(
      makeCtx({ calls: 0 }, saved, streamingCheckpointOverride),
      input
    );
    const gen = loop.run(input);
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    return { loop, returned: step.value, stops, warns };
  } finally {
    off();
  }
}

describe('Task 5：流式链日预算耗尽挂起', () => {
  let prevFlag: string | undefined;

  beforeEach(() => {
    prevFlag = process.env[FLAG];
    resetDailyBudgetForTest();
    getDailyBudget().setLimit(LIMIT);
    resetBudgetSuspendForTest();
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
    resetDailyBudgetForTest();
    resetBudgetSuspendForTest();
  });

  it('开关关：日预算耗尽 ⇒ 不落挂起检查点、不登记（零行为变更）', async () => {
    delete process.env[FLAG];
    const saved: Saved[] = [];

    await runLoop(saved);

    expect(saved.some((s) => s.label === 'budget_suspend')).toBe(false);
    expect(getBudgetSuspendCoordinator().isSuspended(SESSION_ID)).toBe(false);
    expect(getBudgetSuspendCoordinator().list().length).toBe(0);
  });

  it('开关开：日预算耗尽 ⇒ 落 label=budget_suspend 检查点 + 协调器登记 chain=stream', async () => {
    process.env[FLAG] = 'true';
    const saved: Saved[] = [];

    await runLoop(saved);

    const suspendSaves = saved.filter((s) => s.label === 'budget_suspend');
    expect(suspendSaves.length).toBe(1);
    expect(suspendSaves[0].metadata?.budgetSuspend).toBeDefined();

    const coordinator = getBudgetSuspendCoordinator();
    expect(coordinator.isSuspended(SESSION_ID)).toBe(true);
    const list = coordinator.list();
    expect(list.length).toBe(1);
    expect(list[0].chain).toBe('stream');
  });

  it('既有收尾不变：phase=budget_exhausted 且走 finalize、不抛错', async () => {
    process.env[FLAG] = 'true';
    const saved: Saved[] = [];

    const { loop, returned, stops } = await runLoop(saved);

    expect(loop.getTerminationReason()).toBe('budget_exhausted');
    expect(returned).toBeDefined();
    expect(stops.length).toBeGreaterThan(0);
  });

  it('恢复入口：经 toStreamingCheckpointPort 装配的端口含可用 suspend 且透传落盘', async () => {
    const saved: Saved[] = [];
    const checkpointService = {
      saveCheckpointWithData: async (
        _sid: string,
        _messages: unknown[],
        metadata: Record<string, unknown>,
        _state: unknown,
        label?: string
      ) => {
        saved.push({ label, metadata });
        return { id: `cp-${saved.length}`, label };
      },
    };
    const instance = new StreamingAutoCheckpoint(
      checkpointService as never,
      SESSION_ID
    );
    // 恢复路径（ChatManager.resumeStream）此前遗漏 suspend ⇒ 幽灵登记；
    // 现统一经此装配 ⇒ 端口必须含可调用的 suspend。
    const port = toStreamingCheckpointPort(instance);
    expect(typeof port.suspend).toBe('function');

    const cp = (await port.suspend('daily_budget_exhausted')) as {
      id?: string;
    };
    expect(cp?.id).toBeDefined();
    expect(saved.some((s) => s.label === 'budget_suspend')).toBe(true);
  });

  it('开关开：suspend 返回 undefined ⇒ 不登记且记 warn（幽灵态防护）', async () => {
    process.env[FLAG] = 'true';
    const saved: Saved[] = [];
    // 模拟"挂起未落成"：suspend 拿不到检查点 ⇒ 不得登记"已挂起但无检查点"。
    const stub = {
      onToolCompleted: async () => undefined,
      suspend: async () => undefined,
    };

    const { warns } = await runLoop(saved, stub);

    expect(getBudgetSuspendCoordinator().isSuspended(SESSION_ID)).toBe(false);
    expect(getBudgetSuspendCoordinator().list().length).toBe(0);
    expect(warns.length).toBeGreaterThan(0);
  });
});
