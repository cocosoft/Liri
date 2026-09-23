/**
 * 二期 F2-1 / F2-2 / F2-0 / F2-4（2026-09-23 修复计划 §六）：终止原因一等公民（接线既有判别器）
 *
 * 背景：主聊天路径 `ReActToolLoop` **从未接入**既有 A2 判别器（`ReActLoop.getTerminationReason()`），
 * 且 `ReActLoop.run()` 在出口**提前写死** `phase='completed'` ⇒ 判别器被污染（超时/截断被折叠成
 * "正常完成"）。同时 `shouldContinue` 与 `onIncompleteTurn` 对同一事实采用**相反判据**，导致
 * 已产出的 tool_calls 被静默丢弃。
 *
 * 本文件锁定二期四项修复，**每个用例均为「修复前必失败」**：
 *  - F2-1：终止原因取自判别器（超时不再被折叠成 completed）
 *  - F2-2：超时**显式终止**（置 phase + 如实交代被丢弃的工具调用）
 *  - F2-0：两处对立判据统一（丢弃必须留痕，进而在收尾文案中可见）
 *  - F2-4：`_incompleteRetries` 改 **run 级归零**（此前任务级终身一次）
 *
 * 参照 plan：dev_docs/error_repairs/BUG修复计划-未返回信息即终止-20260923.md §六 二期
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

function makeCtx(
  overrides: Partial<ToolLoopContext> & {
    llmSequence?: Array<() => ChatResponse>;
    onLlmCall?: () => void;
  } = {}
): { ctx: ToolLoopContext } {
  const seq = overrides.llmSequence ?? [
    () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
  ];
  let callNo = 0;
  const onLlmCall = overrides.onLlmCall ?? (() => {});
  const ctx = {
    session: { id: 'sess-phase2', messages: [], metadata: {}, state: {} },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async () => ({ result: 'ok', error: undefined }),
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({
        id: 't',
        content: String(result),
      }),
      createAssistantMessage: (
        content: string,
        options?: { sessionId?: string; id?: string }
      ) => ({ id: options?.id ?? 'a-gen', content, role: 'assistant' }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        _m: ChatMessage[],
        _o: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        onLlmCall();
        const r = seq[Math.min(callNo++, seq.length - 1)]();
        if (r.content) yield r.content;
        return r;
      },
      sendMessage: async () => {
        onLlmCall();
        return seq[Math.min(callNo++, seq.length - 1)]();
      },
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
    maxToolTurns: 3,
    estimateMessagesTokens: () => 0,
    ...overrides,
  } as unknown as ToolLoopContext;
  return { ctx };
}

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
    ...overrides,
  } as never;
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

/** 把"会话开始时间"回拨到超过会话级总时长上限（默认 3 小时） */
function rewindStartedAt(loop: ReActToolLoop, msAgo: number): void {
  (loop as unknown as { startedAt: number }).startedAt = Date.now() - msAgo;
}

describe('ReActToolLoop 终止原因（二期 F2-0/F2-1/F2-2/F2-4）', () => {
  it('F2-1/F2-2/F2-0：超时 ⇒ 判别器给 timeout（不再折叠成 completed）+ 收尾如实交代被丢弃的工具调用', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
    // 让 shouldContinue 的总时长判据命中（超时）
    rewindStartedAt(loop, 4 * 60 * 60 * 1000);
    await drain(loop);

    // 修复前：判别器返回 'completed'（phase 被 run() 出口写死）⇒ 失败
    expect(loop.getTerminationReason()).toBe('timeout');

    const final = loop.getAssistantMessage();
    const content = String(final.content);
    // 修复前：无任何超时提示（被当作正常完成）⇒ 失败
    expect(content).toContain('已达会话总时长上限');
    // F2-0：被丢弃的 tool_calls 必须**显式告知**（修复前静默消失）⇒ 失败
    expect(content).toContain('工具调用随之作废');
  });

  it('F2-4：`_incompleteRetries` 为 run 级归零 —— 同一实例连续两次 run 各自都能领到回捞额度', async () => {
    let calls = 0;
    const { ctx } = makeCtx({
      // 恒为"空回复"：每轮 run 都需一次 onIncompleteTurn 回捞
      llmSequence: [() => ({ content: '', stop_reason: 'stop' }) as ChatResponse],
      onLlmCall: () => {
        calls += 1;
      },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    await drain(loop);
    const firstRunCalls = calls;
    await drain(loop);
    const secondRunCalls = calls - firstRunCalls;

    // 首轮：空回复 → 回捞一次（再问）⇒ 2 次 LLM 调用
    expect(firstRunCalls).toBe(2);
    // 修复前：额度是"任务级终身一次"，第二轮直接放行 ⇒ 仅 1 次调用（断言失败）
    expect(secondRunCalls).toBe(2);
  });

  it('F2-3：终止副作用幂等 —— 反复取最终消息（每轮 ≥2 次 finalize）只落一次 Goal', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
      ],
      loopDetector: {
        detect: () => ({
          stuck: true,
          level: 'critical',
          detector: 'file_io',
          message: '重复读写',
        }),
        recordToolCallOutcome: () => {},
        recordTurn: () => {},
      } as never,
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });

    // 实例级替换（不改原型，避免跨用例泄漏）：统计副作用调用次数
    const inst = loop as unknown as {
      settleGoalForTurnDetached: (reason: string) => void;
    };
    const original = inst.settleGoalForTurnDetached.bind(loop);
    let settleCalls = 0;
    inst.settleGoalForTurnDetached = (reason: string) => {
      settleCalls += 1;
      return original(reason);
    };

    await drain(loop); // run() 的 return 值 ⇒ finalize #1
    loop.getAssistantMessage(); // ⇒ finalize #2
    loop.getAssistantMessage(); // ⇒ finalize #3

    // 修复前：每次 finalize 都直接发副作用 ⇒ 3（且每次推进 no_progress_streak）
    expect(settleCalls).toBe(1);
    expect(loop.getTerminationReason()).toBe('loop_detected');
  });
});
