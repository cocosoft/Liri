// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 工具轮次预算跨 run 持久化回归（2026-09-25，依据 `.trae/specs/tool-turn-budget-persistence.md`）
//
// 覆盖：
//  1. 系统续跑（options.metadata.systemResume）⇒ 以持久 consumed 为基线（续期斜坡不回退）
//  2. 用户消息 ⇒ 视为新任务：基线 0 且持久值清零
//  3. taskKey 不匹配 ⇒ 不复用旧计数
//  4. 任务级触顶（累计 = MAX_DYNAMIC_TOOL_TURNS_CAP）⇒ 本段额度 0 + WARN + 走既有收尾（不抛错）
//  5. 落盘节流：计数每轮内存更新、**仅每 5 轮**随检查点落盘（断言检查点 metadata 的 consumed 序列）
//
// 证据方式与既有用例一致：capture 日志 + 检查点 spy（运行级证据，而非仅断言分支存在）。

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import { addLogHandler } from '../../src/monitoring/logs/Logger.js';

const BASE_TURNS = 6;
const CAP = 500;
const TASK_KEY = 'session-task';

interface BudgetLog {
  taskKey: string;
  systemResume: boolean;
  baseline: number;
}

/** 构造 ctx：`toolRounds` 轮工具调用后返回 stop（循环自然结束） */
function makeCtx(params: {
  metadata: Record<string, unknown>;
  toolRounds: number;
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
  return {
    session: { id: 'sess-budget', metadata: params.metadata },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (tc: { id: string; name: string }) => ({
      toolCallId: tc.id,
      toolName: tc.name,
      result: 'ok',
      error: undefined,
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
    checkpointService: {
      saveCheckpointWithData: async (
        _sid: string,
        _msgs: unknown[],
        metadata: unknown
      ) => {
        // 快照（深一层的浅拷贝）：`session.metadata` 是**同一个活对象**，
        // 直接 push 引用会让后续轮次的更新改写已采集的值（测不出"当时的计数"）
        const snap = metadata as Record<string, unknown>;
        params.checkpointMetadataSeen?.push({
          ...snap,
          ...(snap.toolTurnBudget
            ? { toolTurnBudget: { ...(snap.toolTurnBudget as object) } }
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

/** 跑一次 loop（可注入 options.metadata 区分续跑/用户消息），返回终止提示与内部状态 */
async function runOnce(params: {
  metadata: Record<string, unknown>;
  toolRounds?: number;
  loopOptionsMeta?: Record<string, unknown>;
  checkpointMetadataSeen?: Array<Record<string, unknown>>;
}): Promise<{
  tip: string;
  maxIterations: number;
  budget: { taskKey: string; consumed: number } | undefined;
  budgetLogs: BudgetLog[];
}> {
  const budgetLogs: BudgetLog[] = [];
  const off = addLogHandler((entry) => {
    if (entry.message !== 'reactToolLoop:tool_turn_budget_inherited') return;
    const data = entry.data as unknown as BudgetLog | undefined;
    if (data) budgetLogs.push(data);
  });
  try {
    const ctx = makeCtx({
      metadata: params.metadata,
      toolRounds: params.toolRounds ?? 0,
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
    return {
      tip: loop.getTerminationTip(),
      maxIterations: internals.config.maxIterations,
      budget: params.metadata.toolTurnBudget as
        | { taskKey: string; consumed: number }
        | undefined,
      budgetLogs,
    };
  } finally {
    off();
  }
}

describe('工具轮次预算跨 run 持久化（2026-09-25）', () => {
  it('系统续跑：以持久 consumed 为基线（额度 = 任务级 grant，续段不回退斜坡）', async () => {
    const metadata: Record<string, unknown> = {
      toolTurnBudget: { taskKey: TASK_KEY, consumed: 25, updatedAt: 1 },
    };
    const res = await runOnce({
      metadata,
      loopOptionsMeta: { systemResume: true },
    });

    expect(res.budgetLogs).toHaveLength(1);
    expect(res.budgetLogs[0]).toMatchObject({
      taskKey: TASK_KEY,
      systemResume: true,
      baseline: 25,
    });
    // spec §3.5 最小变体：额度 = grant = min(base + base×ceil(25/base), CAP) = 6 + 30 = 36
    // （续段按任务累计续期 ⇒ 不回退到 base=6；单段运行下 base 才是起始额度）
    expect(res.maxIterations).toBe(36);
  });

  it('用户消息：不继承并把持久值清零（新任务）', async () => {
    const metadata: Record<string, unknown> = {
      toolTurnBudget: { taskKey: TASK_KEY, consumed: 25, updatedAt: 1 },
    };
    // 无 systemResume ⇒ 用户消息
    const res = await runOnce({ metadata });

    expect(res.budgetLogs[0]).toMatchObject({
      systemResume: false,
      baseline: 0,
    });
    // 起始额度 = base（未过扩容阈值）
    expect(res.maxIterations).toBe(BASE_TURNS);
    expect(res.budget?.consumed).toBe(0);
  });

  it('taskKey 不匹配：不复用旧任务计数（视为新任务）', async () => {
    const metadata: Record<string, unknown> = {
      toolTurnBudget: { taskKey: 'goal-other', consumed: 25, updatedAt: 1 },
    };
    const res = await runOnce({
      metadata,
      loopOptionsMeta: { systemResume: true, goalId: 'goal-A' },
    });

    expect(res.budgetLogs[0]).toMatchObject({
      taskKey: 'goal-A',
      systemResume: true,
      baseline: 0,
    });
    expect(res.maxIterations).toBe(BASE_TURNS);
  });

  it('任务累计已达 CAP：本段仍获 CAP 额度（长任务可持续推进，不空转）', async () => {
    const metadata: Record<string, unknown> = {
      toolTurnBudget: { taskKey: TASK_KEY, consumed: CAP, updatedAt: 1 },
    };
    const warns: string[] = [];
    const off = addLogHandler((entry) => {
      if (entry.message === 'reactToolLoop:tool_turn_budget_exhausted') {
        warns.push(entry.message);
      }
    });
    let res: Awaited<ReturnType<typeof runOnce>>;
    try {
      res = await runOnce({
        metadata,
        toolRounds: 2,
        loopOptionsMeta: { systemResume: true },
      });
    } finally {
      off();
    }

    // 累计 = CAP ⇒ grant = min(base + base×ceil(CAP/base), CAP) = CAP
    expect(res.maxIterations).toBe(CAP);
    // 不计入"预算耗尽"（无任务级总量上限）⇒ 无该 WARN
    expect(warns).toHaveLength(0);
    // 本段正常推进（2 轮工具 + 计数继续累计）
    expect(res.budget?.consumed).toBe(CAP + 2);
    expect(res.tip).not.toContain('已达到最大工具轮次限制');
  });

  it('落盘节流：计数每轮内存更新，检查点仅在每 5 轮携带（consumed 序列 = 5,10）', async () => {
    const metadata: Record<string, unknown> = {};
    const seen: Array<Record<string, unknown>> = [];
    const res = await runOnce({
      metadata,
      toolRounds: 10,
      checkpointMetadataSeen: seen,
    });

    // 内存：10 轮全部计入
    expect(res.budget?.consumed).toBe(10);
    // 落盘节流：只有第 5/10 轮（2 次），且各自携带当时计数
    const consumedSeries = seen.map(
      (m) => (m.toolTurnBudget as { consumed: number }).consumed
    );
    expect(consumedSeries).toEqual([5, 10]);
  });
});
