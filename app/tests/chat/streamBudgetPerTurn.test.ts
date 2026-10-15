// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// G-1 根因回归（2026-10-11）：流式工具循环**逐轮**复检日预算。
//
// 背景（Spec `daily-budget-over-limit-ux.md` §1.2 G-1）：日预算闸门原先只在**请求开始**判定
// 一次（`streamMessageFlow` 的 `preSendContextProtection` 调用点全仓唯一），进入工具循环后
// 每轮只 `settleFor` **记账**、不再判定 ⇒ 一次进入即可把额度跑穿（实测 180%）。
//
// 断言口径（运行级证据）：每轮模型响应对应一次 `recordChatResponseUsage`（按实际用量记账）。
//   修复前：循环跑满 8 轮 ⇒ 记账 8 次、模型请求 8 次（额度被跑穿）。
//   修复后：额度耗尽即收束 ⇒ 模型请求 ≤ 2 次，且发出 `reActLoop:daily_budget_exhausted`。

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';
import {
  getDailyBudget,
  resetDailyBudgetForTest,
} from '../../src/query/DailyBudgetManager';

/** 日预算上限（测试用极小值，便于 2 轮内耗尽） */
const LIMIT = 100;
/** 每轮模型响应的**实际**用量（2026-10-15：改为**金额口径 USD** —— 档位只由 USD 产出） */
const PER_ROUND = 60;
/** 预置的工具轮次数（若无闸门，循环会跑满这么多轮） */
const ROUNDS = 8;

function makeCtx(counter: { calls: number }): ToolLoopContext {
  const nextResponse = (): ChatResponse => {
    counter.calls++;
    if (counter.calls <= ROUNDS) {
      return {
        // 正文非空：避免"空正文不完整回合"守卫提前收尾
        content: `执行第 ${counter.calls} 步`,
        stop_reason: 'tool_calls',
        tool_calls: [
          {
            // 参数逐轮不同：避免"同工具同参数"纠偏提前收尾
            id: `tc${counter.calls}`,
            name: 'todo_write',
            arguments: { round: counter.calls },
          },
        ],
      } as ChatResponse;
    }
    return { content: '完成', stop_reason: 'stop' } as ChatResponse;
  };
  return {
    session: { id: 'sess-budget-turn' },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
    }) => {
      // 模拟"每轮工具执行即产生真实消耗"：直接记入日预算（不绕 streamingLlm 的 usage 上报，
      // 以便本用例聚焦**闸门**而非用量归因；也避免触碰真实成本库）。
      getDailyBudget().recordUsdUsage(PER_ROUND);
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
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
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
    // 用量归因不在本用例范围（消耗已在 `executeTool` 内模拟记账）
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

describe('G-1：流式工具循环逐轮复检日预算', () => {
  beforeEach(() => {
    resetDailyBudgetForTest();
    getDailyBudget().setLimitUsd(LIMIT);
  });
  afterEach(() => {
    resetDailyBudgetForTest();
  });

  it('多轮工具循环中途耗尽日预算 ⇒ 停止且不再发起模型请求（不抛错）', async () => {
    const counter = { calls: 0 };
    const stops: unknown[] = [];
    const off = addLogHandler((entry) => {
      if (entry.message === 'reActLoop:daily_budget_exhausted') {
        stops.push(entry.data);
      }
    });

    let returned: unknown;
    try {
      const loop = new ReActToolLoop(makeCtx(counter), makeInput());
      const gen = loop.run(makeInput());
      let step = await gen.next();
      while (!step.done) step = await gen.next();
      returned = step.value;
    } finally {
      off();
    }

    // 修复前：跑满 ROUNDS(=8) 轮 ⇒ 8 次模型请求、用量 480 远超上限 100
    expect(counter.calls).toBe(2);
    // 收束发生在第 3 轮**之前**的复检 ⇒ 已记账量为前两轮实际用量（**主口径 = USD**）
    expect(getDailyBudget().getMode().used).toBe(PER_ROUND * 2);
    expect(stops.length).toBeGreaterThan(0);
    expect(returned).toBeDefined();
  });
});
