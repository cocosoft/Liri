// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 动态工具轮次扩容回归（2026-09-25，缺陷 A / 缺陷 C 修复）
//
// 缺陷 A（结构性撞线）：修复前探索续期是 `expansion += floor(toolTurnCount / 2)` ——
//   每消耗 1 轮只回收 0.5 轮，净余量以 0.5 轮/轮 衰减 ⇒ 数学上必然撞线（base=30 时约 59 轮）。
//   断言口径：扩容时 `expanded - toolTurn >= base`（剩余额度不再衰减到 0）。
// 缺陷 C（todo 扩容失效）：修复前扩容读的 `pendingTodos` 是"取走即清空"的消费队列，
//   消费侧（streamMessageFlow）每轮取走 ⇒ 扩容的 todo 项恒为 0。
//   断言口径：模拟消费侧取走后，扩容日志的 `pendingTodoCount > 0`。
//
// 证据方式：捕获 `reactToolLoop:dynamic_max_turns_expanded` 日志的 `data.expansionBreakdown`
//   （运行级证据，而非仅断言分支存在）。

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';

/** 基础轮次上限（测试用短基数，扩容判据按 base 续期） */
const BASE_TURNS = 6;
/** 预置的工具轮次数（其后返回 stop ⇒ 循环自然结束） */
const TOOL_ROUNDS = 8;

interface Breakdown {
  pendingTodoCount: number;
  todo: number;
  fetch: number;
  renewal: number;
}

interface ExpansionLog {
  base: number;
  expanded: number;
  toolTurn: number;
  expansionBreakdown: Breakdown;
}

function makeCtx(): ToolLoopContext {
  let callCount = 0;
  /** 预置响应：前 TOOL_ROUNDS 轮返回工具调用，其后 stop（循环自然结束） */
  const nextResponse = (): ChatResponse => {
    callCount++;
    if (callCount <= TOOL_ROUNDS) {
      return {
        // 正文非空：空正文触发"不完整回合"守卫（本用例要跑满工具轮次）
        content: `执行第 ${callCount} 步`,
        stop_reason: 'tool_calls',
        tool_calls: [
          {
            // 参数逐轮不同：避免"同工具同参数"纠偏提前收尾
            id: `tc${callCount}`,
            name: 'todo_write',
            arguments: { round: callCount },
          },
        ],
      } as ChatResponse;
    }
    return { content: '完成', stop_reason: 'stop' } as ChatResponse;
  };
  const ctx = {
    session: { id: 'sess-dyn-turns' },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      sessionId?: string;
    }) => ({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: 'todo updated',
      error: undefined,
      // extractTodoData 读 metadata._todoData（ChatHelper.ts）
      metadata: {
        _todoData: {
          title: '长程计划',
          phase: 'in_progress',
          tasks: [
            { id: 't1', name: '步骤一', status: 'pending', dependsOn: [] },
            { id: 't2', name: '步骤二', status: 'in_progress', dependsOn: [] },
          ],
        },
      },
    }),
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
      streamMessage: async function* (
        _messages: ChatMessage[],
        _options: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        yield 'thinking';
        return nextResponse();
      },
      // 本用例走非流式路径（input.nonStreaming）⇒ 实际消费 sendMessage
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
    maxToolTurns: BASE_TURNS,
    estimateMessagesTokens: () => 0,
  } as unknown as ToolLoopContext;
  return ctx;
}

function makeInput() {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never;
}

/** 运行循环，**模拟消费侧**在每轮 tool_end 后取走 todo（取走即清空），返回扩容日志 */
async function runAndCollectExpansions(): Promise<ExpansionLog[]> {
  const expansions: ExpansionLog[] = [];
  const off = addLogHandler((entry) => {
    if (entry.message !== 'reactToolLoop:dynamic_max_turns_expanded') return;
    const data = entry.data as unknown as ExpansionLog | undefined;
    if (data) expansions.push(data);
  });
  try {
    const loop = new ReActToolLoop(makeCtx(), makeInput());
    for await (const event of loop.run(makeInput())) {
      // 对齐 streamMessageFlow：tool_end 后取走 todo（含"清空"语义）
      if (event.type === 'tool_end') loop.getPendingTodos();
    }
  } finally {
    off();
  }
  return expansions;
}

describe('动态轮次扩容回归（缺陷 A / C，2026-09-25）', () => {
  it('缺陷 C：消费侧取走 todo 后，扩容仍按快照计入 todo 项（修复前恒为 0）', async () => {
    const expansions = await runAndCollectExpansions();
    expect(expansions.length).toBeGreaterThan(0);
    const last = expansions[expansions.length - 1];
    // 2 个未完成任务（pending + in_progress）
    expect(last.expansionBreakdown.pendingTodoCount).toBe(2);
    expect(last.expansionBreakdown.todo).toBe(2 * 5);
  });

  it('缺陷 A：续期与消耗 1:1 —— 扩容时剩余额度不衰减到 0（修复前约 2×base 即撞线）', async () => {
    const expansions = await runAndCollectExpansions();
    const renewed = expansions.filter((e) => e.expansionBreakdown.renewal > 0);
    expect(renewed.length).toBeGreaterThan(0);
    for (const e of renewed) {
      // 修复前该差值单调趋零（floor(t/2) 增速不足）；修复后恒 ≥ base
      expect(e.expanded - e.toolTurn).toBeGreaterThanOrEqual(BASE_TURNS);
      // 续期量 = base × ceil(consumed / base)
      expect(e.expansionBreakdown.renewal % BASE_TURNS).toBe(0);
    }
  });
});
