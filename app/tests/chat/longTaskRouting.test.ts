// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 长任务分流回归（2026-09-25，依据 `.trae/specs/long-task-routing.md`）
//
// 覆盖：
//  G1 文案单一来源与命令名正确性（命令名事实来源 = 命令注册表的 `/goal start`；
//     历史缺陷是两处硬编码了**不存在**的命令名 —— pdca 前缀 + start）
//  G3 长任务信号（客观状态量：未完成 todo 数 / 已耗轮次）+ 收尾时的可执行编排建议
//  G2 引导接线的触发判据（`isExecutionTaskIntent`，与 REPL 接线同源）
//
// 边界（如实）：G2 的「首次展示一次」由 `showHintIfNeeded` 既有契约（config 标记）保证，
// 未在此处做用例 —— 该函数会写真实 `~/.pyapp/config.json`（测试不应污染用户配置）；
// 接线本身由类型检查 + 代码审阅守护。

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import {
  HINT_METHODOLOGY_PDCA,
  PDCA_EXPLICIT_ENTRY,
} from '../../src/commands/builtin/onboard/OnboardHints.js';
import { isExecutionTaskIntent } from '../../src/chat/taskIntent.js';
import { shouldEscalateLongTask } from '../../src/chat/longTaskEscalation.js';

const BASE_TURNS = 6;

/** 构造 ctx；`todoTasks` 非空时每轮工具结果携带 `_todoData`（未完成任务数 = 其长度） */
function makeCtx(params: {
  toolRounds: number;
  todoTasks?: Array<{ id: string; name: string; status: string }>;
}): ToolLoopContext {
  let callCount = 0;
  const nextResponse = (): ChatResponse => {
    callCount++;
    if (callCount <= params.toolRounds) {
      return {
        content: `执行第 ${callCount} 步`,
        stop_reason: 'tool_calls',
        tool_calls: [
          {
            id: `tc${callCount}`,
            name: 'file_read',
            arguments: { n: callCount },
          },
        ],
      } as ChatResponse;
    }
    return { content: '完成', stop_reason: 'stop' } as ChatResponse;
  };
  return {
    session: { id: 'sess-long-task', metadata: {} },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (tc: { id: string; name: string }) => ({
      toolCallId: tc.id,
      toolName: tc.name,
      result: 'ok',
      error: undefined,
      ...(params.todoTasks
        ? {
            metadata: {
              _todoData: {
                title: '长任务计划',
                phase: 'in_progress',
                tasks: params.todoTasks.map((t) => ({ ...t, dependsOn: [] })),
              },
            },
          }
        : {}),
    }),
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (r: unknown) => ({
        id: 'm',
        content: String(r),
      }),
      createAssistantMessage: (c: string) => ({
        id: 'a',
        content: c,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* () {
        yield 'thinking';
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
    maxToolTurns: BASE_TURNS,
    estimateMessagesTokens: () => 0,
  } as unknown as ToolLoopContext;
}

const makeInput = () =>
  ({
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  }) as never;

/** 跑到自然结束，然后把 iteration 顶到上限（模拟触顶）并取收尾提示 */
async function runThenForceMaxTurns(params: {
  toolRounds: number;
  todoTasks?: Array<{ id: string; name: string; status: string }>;
}): Promise<string> {
  const loop = new ReActToolLoop(makeCtx(params), makeInput()) as unknown as {
    state: { iteration: number };
    config: { maxIterations: number };
    getTerminationTip: () => string;
    run: (i: unknown) => AsyncGenerator<unknown>;
  };
  for await (const _e of loop.run(makeInput())) {
    void _e;
  }
  loop.state.iteration = loop.config.maxIterations;
  return loop.getTerminationTip();
}

describe('长任务分流（2026-09-25）', () => {
  it('G1：引导文案的命令名与单一来源一致（命令名事实来源 = 注册表的 goal 命令）', () => {
    // 命令名事实来源：`/goal start <描述>`（正例断言即排除了历史错误命令）
    expect(PDCA_EXPLICIT_ENTRY).toBe('/goal start <描述>');
    expect(HINT_METHODOLOGY_PDCA).toContain(PDCA_EXPLICIT_ENTRY);
  });

  it('G2：执行类长任务措辞命中引导判据（与 REPL 接线同源）', () => {
    expect(isExecutionTaskIntent('帮我做个记账 App，分步做完再检查')).toBe(
      true
    );
    // 纯闲聊不命中（避免误触发一次性提示）
    expect(isExecutionTaskIntent('今天天气怎么样')).toBe(false);
  });

  it('G3 短任务触顶：不给编排建议（无 todo 且未耗满基础档）', async () => {
    const tip = await runThenForceMaxTurns({ toolRounds: 1 });
    expect(tip).toContain('已达到最大工具轮次限制');
    expect(tip).not.toContain('/goal start');
  });

  it('G3 长任务触顶（已耗 ≥ 一个基础档）：给出可执行编排建议', async () => {
    const tip = await runThenForceMaxTurns({ toolRounds: BASE_TURNS });
    expect(tip).toContain('/goal start');
    // 与 G1 的单一来源一致（防第二处漂移）
    expect(tip).toContain(PDCA_EXPLICIT_ENTRY.split(' ')[0]);
  });

  it('G3 长任务信号之 todo 分支：未完成 ≥ 3 即触发（此时已耗未满基础档）', async () => {
    const tip = await runThenForceMaxTurns({
      toolRounds: 1,
      todoTasks: [
        { id: 't1', name: '步骤一', status: 'pending' },
        { id: 't2', name: '步骤二', status: 'in_progress' },
        { id: 't3', name: '步骤三', status: 'pending' },
      ],
    });
    expect(tip).toContain('/goal start');
  });

  it('G3 todo 分支边界：未完成 = 2 不触发（阈值 3）', async () => {
    const tip = await runThenForceMaxTurns({
      toolRounds: 1,
      todoTasks: [
        { id: 't1', name: '步骤一', status: 'pending' },
        { id: 't2', name: '步骤二', status: 'pending' },
      ],
    });
    expect(tip).not.toContain('/goal start');
  });
});

// ─── D3（2026-09-25）：运行中长任务信号 ⇒ 自动升级闸门（纯判定，与既有裸会话分支同口径）───
describe('D3 长任务信号 ⇒ 自动升级闸门', () => {
  const base = {
    longTask: true,
    hasProjectContext: false,
    codeMode: false,
    userMessageCount: 2,
  };

  it('裸会话 + ≥2 轮 + 非 Code Mode + 长任务 ⇒ 允许升级', () => {
    expect(shouldEscalateLongTask(base)).toBe(true);
  });

  it('已有项目/工作区归属 ⇒ 不接管（既有 goal 通道负责）', () => {
    expect(shouldEscalateLongTask({ ...base, hasProjectContext: true })).toBe(
      false
    );
  });

  it('轮次闸：仅 1 轮 ⇒ 不升级（防首条消息即被自动建项目 + 起编排）', () => {
    expect(shouldEscalateLongTask({ ...base, userMessageCount: 1 })).toBe(
      false
    );
  });

  it('Code Mode 互斥 ⇒ 不升级', () => {
    expect(shouldEscalateLongTask({ ...base, codeMode: true })).toBe(false);
  });

  it('无长任务信号 ⇒ 不升级', () => {
    expect(shouldEscalateLongTask({ ...base, longTask: false })).toBe(false);
  });

  it('loop.getLongTaskSignal() 公开读数与 G3 判定同源（宿主据此分流）', async () => {
    const loop = new ReActToolLoop(
      makeCtx({
        toolRounds: 1,
        todoTasks: [
          { id: 't1', name: '步骤一', status: 'pending' },
          { id: 't2', name: '步骤二', status: 'in_progress' },
          { id: 't3', name: '步骤三', status: 'pending' },
        ],
      }),
      makeInput()
    ) as unknown as {
      run: (i: unknown) => AsyncGenerator<unknown>;
      getLongTaskSignal: () => {
        isLongTask: boolean;
        pendingTodoCount: number;
        consumedTurns: number;
      };
    };
    for await (const _e of loop.run(makeInput())) {
      void _e;
    }
    const signal = loop.getLongTaskSignal();
    expect(signal.isLongTask).toBe(true);
    expect(signal.pendingTodoCount).toBe(3);
    expect(signal.consumedTurns).toBe(1);
  });
});
