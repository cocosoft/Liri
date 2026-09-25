// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// todo 扩容量跨 run 持久化回归（2026-09-25，依据 `.trae/specs/todo-expansion-persistence.md`）
//
// 覆盖：
//  1. 系统续跑（options.metadata.systemResume）⇒ 回填持久「未完成 todo 数」⇒ 续段仍拿到 todo 扩容
//  2. 用户消息 ⇒ 视为新任务：快照空 + 持久值归零
//  3. taskKey 不匹配 ⇒ 不复用旧任务计数
//  4. 段内覆盖 ⇒ 计数按最新快照（完成项使扩容下降）
//  5. 落盘节流 ⇒ todo 变化才写内存，落盘随既有检查点（不每轮写）
//
// 证据方式与既有用例一致：capture 日志 + 检查点 spy + 公开读数（`getLongTaskSignal()`），
// 断言的是**运行结果**（额度与持久投影），不是"分支存在"。

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';

const BASE_TURNS = 6;
const TASK_KEY = 'session-task';
/** 第 N 轮工具结果携带的 todo 快照（下标 0 = 第 1 轮） */
type TodoRound = {
  title: string;
  tasks: Array<{ id: string; name: string; status: string }>;
};

interface RestoreLog {
  taskKey: string;
  systemResume: boolean;
  restored: boolean;
  planCount: number;
  pendingTodoCount: number;
}

/** 构造 ctx：`toolRounds` 轮工具调用后返回 stop；`todoRounds[i]` 决定第 i+1 轮的 todo 快照 */
function makeCtx(params: {
  metadata: Record<string, unknown>;
  toolRounds: number;
  todoRounds?: TodoRound[];
  checkpointMetadataSeen?: Array<Record<string, unknown>>;
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
  let toolCallCount = 0;
  return {
    session: { id: 'sess-todo-expansion', metadata: params.metadata },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (tc: { id: string; name: string }) => {
      toolCallCount++;
      const todo = params.todoRounds?.[toolCallCount - 1];
      return {
        toolCallId: tc.id,
        toolName: tc.name,
        result: 'ok',
        error: undefined,
        ...(todo
          ? {
              metadata: {
                _todoData: {
                  title: todo.title,
                  phase: 'executing',
                  tasks: todo.tasks.map((t) => ({ ...t, dependsOn: [] })),
                },
              },
            }
          : {}),
      };
    },
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
    checkpointService: {
      saveCheckpointWithData: async (
        _sid: string,
        _msgs: unknown[],
        metadata: unknown
      ) => {
        // 深一层的浅拷贝：`session.metadata` 是同一个活对象，直接推引用会被后续轮次改写
        const snap = metadata as Record<string, unknown>;
        params.checkpointMetadataSeen?.push({
          ...snap,
          ...(snap.todoExpansion
            ? {
                todoExpansion: {
                  ...(snap.todoExpansion as object),
                  plans: {
                    ...((snap.todoExpansion as { plans?: object }).plans ?? {}),
                  },
                },
              }
            : {}),
        });
        return undefined;
      },
    },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* () {
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
}

const makeInput = () =>
  ({
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  }) as never;

/** 跑一段（可注入 `options.metadata` 区分续跑/用户消息），返回额度 + 持久投影 + 埋点 */
async function runSegment(params: {
  metadata: Record<string, unknown>;
  toolRounds?: number;
  todoRounds?: TodoRound[];
  loopOptionsMeta?: Record<string, unknown>;
  checkpointMetadataSeen?: Array<Record<string, unknown>>;
}): Promise<{
  maxIterations: number;
  pendingTodoCount: number;
  plans: Record<string, number> | undefined;
  restoreLogs: RestoreLog[];
}> {
  const restoreLogs: RestoreLog[] = [];
  const off = addLogHandler((entry) => {
    if (entry.message !== 'reactToolLoop:todo_expansion_restored') return;
    const data = entry.data as unknown as RestoreLog | undefined;
    if (data) restoreLogs.push(data);
  });
  try {
    const ctx = makeCtx({
      metadata: params.metadata,
      toolRounds: params.toolRounds ?? 0,
      todoRounds: params.todoRounds,
      checkpointMetadataSeen: params.checkpointMetadataSeen,
    });
    if (params.loopOptionsMeta) {
      ctx.options = { metadata: params.loopOptionsMeta } as Record<
        string,
        unknown
      >;
    }
    const loop = new ReActToolLoop(ctx, makeInput());
    for await (const _event of loop.run(makeInput())) {
      void _event;
    }
    const internals = loop as unknown as { config: { maxIterations: number } };
    const stored = params.metadata.todoExpansion as
      | { plans?: Record<string, number> }
      | undefined;
    return {
      maxIterations: internals.config.maxIterations,
      pendingTodoCount: loop.getLongTaskSignal().pendingTodoCount,
      plans: stored?.plans,
      restoreLogs,
    };
  } finally {
    off();
  }
}

describe('todo 扩容量跨 run 持久化（2026-09-25）', () => {
  it('系统续跑：回填持久未完成数 ⇒ 续段仍拿到 todo 扩容（修复前恒为 base）', async () => {
    const metadata: Record<string, unknown> = {
      todoExpansion: {
        taskKey: TASK_KEY,
        plans: { 长任务计划: 3 },
        updatedAt: 1,
      },
    };
    const res = await runSegment({
      metadata,
      loopOptionsMeta: { systemResume: true },
    });

    expect(res.restoreLogs).toHaveLength(1);
    expect(res.restoreLogs[0]).toMatchObject({
      taskKey: TASK_KEY,
      systemResume: true,
      restored: true,
      planCount: 1,
      pendingTodoCount: 3,
    });
    // 额度 = base + 未完成数 × 5 + renewal(基线 0) = 6 + 15
    expect(res.maxIterations).toBe(BASE_TURNS + 15);
    expect(res.pendingTodoCount).toBe(3);
  });

  it('用户消息：不继承并把持久值归零（新任务不带上一任务的未完成数）', async () => {
    const metadata: Record<string, unknown> = {
      todoExpansion: {
        taskKey: TASK_KEY,
        plans: { 长任务计划: 3 },
        updatedAt: 1,
      },
    };
    // 无 systemResume ⇒ 用户消息
    const res = await runSegment({ metadata });

    expect(res.restoreLogs[0]).toMatchObject({
      systemResume: false,
      restored: false,
      pendingTodoCount: 0,
    });
    expect(res.maxIterations).toBe(BASE_TURNS);
    expect(res.plans).toEqual({});
  });

  it('taskKey 不匹配：不复用旧任务计数（视为新任务）', async () => {
    const metadata: Record<string, unknown> = {
      todoExpansion: {
        taskKey: 'goal-other',
        plans: { 长任务计划: 3 },
        updatedAt: 1,
      },
    };
    const res = await runSegment({
      metadata,
      loopOptionsMeta: { systemResume: true, goalId: 'goal-A' },
    });

    expect(res.restoreLogs[0]).toMatchObject({
      taskKey: 'goal-A',
      restored: false,
      pendingTodoCount: 0,
    });
    expect(res.maxIterations).toBe(BASE_TURNS);
    expect(res.plans).toEqual({});
  });

  it('端到端两段：段 1 写 todo ⇒ 段 2（新实例+续跑）仍按未完成数扩容', async () => {
    const metadata: Record<string, unknown> = {};
    const first = await runSegment({
      metadata,
      toolRounds: 1,
      todoRounds: [
        {
          title: '长任务计划',
          tasks: [
            { id: 't1', name: '已完成项', status: 'completed' },
            { id: 't2', name: '进行中项', status: 'in_progress' },
            { id: 't3', name: '待办项', status: 'pending' },
          ],
        },
      ],
    });
    // 段 1：只有 2 个未完成 ⇒ 6 + 10
    expect(first.maxIterations).toBe(BASE_TURNS + 10);
    expect(first.plans).toEqual({ 长任务计划: 2 });

    // 段 2：**新 loop 实例**（生产路径每段新建）+ 系统续跑
    const second = await runSegment({
      metadata,
      loopOptionsMeta: { systemResume: true },
    });
    expect(second.restoreLogs[0]).toMatchObject({
      restored: true,
      pendingTodoCount: 2,
    });
    // 预算基线 = 段 1 已消耗 1（未过 base/2 ⇒ renewal 0）⇒ 6 + 10
    expect(second.maxIterations).toBe(BASE_TURNS + 10);
    expect(second.pendingTodoCount).toBe(2);
  });

  it('段内覆盖：同一计划再次写入（全部完成）⇒ 计数按最新快照下降', async () => {
    const metadata: Record<string, unknown> = {};
    const res = await runSegment({
      metadata,
      toolRounds: 2,
      todoRounds: [
        {
          title: '长任务计划',
          tasks: [
            { id: 't1', name: '进行中项', status: 'in_progress' },
            { id: 't2', name: '待办项', status: 'pending' },
          ],
        },
        {
          title: '长任务计划',
          tasks: [
            { id: 't1', name: '进行中项', status: 'completed' },
            { id: 't2', name: '待办项', status: 'completed' },
          ],
        },
      ],
    });

    // 覆盖语义（非累加）：最终 = 0 未完成
    expect(res.plans).toEqual({ 长任务计划: 0 });
    expect(res.pendingTodoCount).toBe(0);
  });

  it('落盘节流：todo 变化才写内存，落盘随既有检查点（第 5/10 轮）且无每轮改写', async () => {
    const metadata: Record<string, unknown> = {};
    const seen: Array<Record<string, unknown>> = [];
    const res = await runSegment({
      metadata,
      toolRounds: 10,
      todoRounds: [
        {
          title: '长任务计划',
          tasks: [
            { id: 't1', name: '待办 A', status: 'pending' },
            { id: 't2', name: '待办 B', status: 'pending' },
          ],
        },
      ],
      checkpointMetadataSeen: seen,
    });

    expect(res.pendingTodoCount).toBe(2);
    expect(seen).toHaveLength(2); // 第 5 / 10 轮
    const planSeries = seen.map(
      (m) => (m.todoExpansion as { plans: Record<string, number> }).plans
    );
    expect(planSeries).toEqual([{ 长任务计划: 2 }, { 长任务计划: 2 }]);
    // 只在变化时写：两次落盘携带的 updatedAt 相同（无每轮改写）
    const stamps = seen.map(
      (m) => (m.todoExpansion as { updatedAt: number }).updatedAt
    );
    expect(new Set(stamps).size).toBe(1);
  });
});
