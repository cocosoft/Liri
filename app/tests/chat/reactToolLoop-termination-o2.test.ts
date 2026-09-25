/**
 * 二期 O2-1（2026-09-24「会话暴露问题分析与优化方案」§五）：
 *  ① `error` 大杂烩细分 —— 5 个产出点各自专用相位，判别器/文案/metadata/目标层**同源可分辨**；
 *  ② "真·无进展"（no_progress / circuit_breaker）⇒ Goal 走 `turn_error`（**推进** no_progress_streak），
 *     其余细分成员走"只记录"；
 *  ③ 中止来源区分 —— `system_aborted`（断线 / 会话清理）≠ `aborted`（用户主动放弃）。
 *
 * 每个用例均为「修复前必失败」。
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import {
  SYSTEM_ABORT_REASON,
  createSystemAbortReason,
} from '../../src/query/ReActLoop.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

function makeCtx(
  overrides: Partial<ToolLoopContext> & {
    llmSequence?: Array<() => ChatResponse>;
  } = {}
): { ctx: ToolLoopContext } {
  const seq = overrides.llmSequence ?? [
    () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
  ];
  let callNo = 0;
  const ctx = {
    session: { id: 'sess-o2', messages: [], metadata: {}, state: {} },
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
        const r = seq[Math.min(callNo++, seq.length - 1)]();
        if (r.content) yield r.content;
        return r;
      },
      sendMessage: async () =>
        seq[Math.min(callNo++, seq.length - 1)]() as ChatResponse,
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

type LoopInternals = {
  state: { phase: string; lastError?: string; iteration: number };
  mapTerminationToGoalReason: (r: string) => string | null;
};

function internals(loop: ReActToolLoop): LoopInternals {
  return loop as unknown as LoopInternals;
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

function finalMeta(loop: ReActToolLoop): Record<string, unknown> {
  const msg = loop.getAssistantMessage() as unknown as {
    metadata?: Record<string, unknown>;
  };
  return msg.metadata ?? {};
}

/** `error` 细分后的 5 个相位 → 期望的终止原因（同名） */
const ERROR_FAMILY = [
  'reasoning_error',
  'no_progress',
  'exploration_fatigue',
  'circuit_breaker',
  'internal_error',
] as const;

describe('ReActToolLoop 终止语义（二期 O2-1）', () => {
  it('`error` 细分：5 个产出点的终止原因与 metadata.finishReason **两两不同**', () => {
    const seen = new Set<string>();
    for (const phase of ERROR_FAMILY) {
      const { ctx } = makeCtx();
      const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
      const inst = internals(loop);
      inst.state.phase = phase;
      inst.state.lastError = `msg-${phase}`;

      // 修复前：只有 'error'（5 类无法分辨）⇒ 失败
      expect(loop.getTerminationReason()).toBe(phase);
      const meta = finalMeta(loop);
      expect(meta.finishReason).toBe(phase);
      seen.add(String(meta.finishReason));
      // 正文仍透传各产出点自己的 lastError（文案零回归）
      expect(String(loop.getAssistantMessage().content)).toContain(
        `msg-${phase}`
      );
    }
    // 修复前：seen.size === 1 ⇒ 失败
    expect(seen.size).toBe(ERROR_FAMILY.length);
  });

  it('`error` 细分：判别先于 max_turns（不被"恰好到上限"遮蔽）', () => {
    const { ctx } = makeCtx();
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 1 });
    const inst = internals(loop);
    inst.state.phase = 'no_progress';
    inst.state.iteration = 1; // ≥ maxIterations(1)

    // 修复前：'error'（细分值缺失）⇒ 失败
    expect(loop.getTerminationReason()).toBe('no_progress');
  });

  it('目标层映射：真·无进展 ⇒ turn_error（推进计数），其余 ⇒ 只记录', () => {
    const { ctx } = makeCtx();
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
    const map = internals(loop).mapTerminationToGoalReason;

    // 修复前：'no_progress'/'circuit_breaker' 不在判别器值域（穷尽断言抛错）⇒ 失败
    expect(map('no_progress')).toBe('turn_error');
    expect(map('circuit_breaker')).toBe('turn_error');
    expect(map('reasoning_error')).toBe('turn_interrupted');
    expect(map('exploration_fatigue')).toBe('turn_interrupted');
    expect(map('internal_error')).toBe('turn_interrupted');
    // 既有语义不变
    expect(map('loop_detected')).toBe('turn_error');
    expect(map('timeout')).toBe('turn_timeout');
    expect(map('aborted')).toBe('user_aborted');
  });

  it('中止来源：系统中止（带标记）⇒ system_aborted，且文案不谎称"按你的请求停止"', () => {
    const ac = new AbortController();
    const { ctx } = makeCtx({ abortSignal: ac.signal });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    // 模拟 ChatManager.abortSessionStream（req.on('close')）与 SessionLifecycleManager 的清理性中止
    ac.abort(SYSTEM_ABORT_REASON);

    // 修复前：'aborted'（一律记成用户主动放弃）⇒ 失败
    expect(loop.getTerminationReason()).toBe('system_aborted');
    const content = String(loop.getAssistantMessage().content);
    expect(content).toContain('本轮生成已中止');
    expect(content).not.toContain('已按你的请求停止');
    expect(finalMeta(loop).finishReason).toBe('system_aborted');
  });

  it('中止来源：**Error 形态**系统标记（② 加固）⇒ 仍为 system_aborted', () => {
    const ac = new AbortController();
    const { ctx } = makeCtx({ abortSignal: ac.signal });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    // ② 加固后两处写入点（ChatManager / SessionLifecycleManager）改传 Error 形态（带真实栈）
    // ⇒ 判定已收敛到 `isSystemAbortReason()`，结果必须仍是 system（否则 Goal 会错落 user_aborted）
    ac.abort(createSystemAbortReason());

    expect(loop.getTerminationReason()).toBe('system_aborted');
    expect(finalMeta(loop).finishReason).toBe('system_aborted');
  });

  it('中止来源：**用户** AbortError（非系统标记）⇒ 仍为 aborted（狭义判据不得越界）', () => {
    const ac = new AbortController();
    const { ctx } = makeCtx({ abortSignal: ac.signal });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    // 用户停止常为 DOMException AbortError：**广义**判据（预期中断）命中，但**狭义**判据必须不命中
    ac.abort(new DOMException('user stopped', 'AbortError'));

    expect(loop.getTerminationReason()).toBe('aborted');
  });

  it('中止来源：用户主动 stop / 无标记的外部中止 ⇒ aborted（既有语义不变）', () => {
    // 用户主动停止（loop.abort()）
    const { ctx: ctx1 } = makeCtx();
    const loop1 = new ReActToolLoop(ctx1, makeInput(), { maxIterations: 5 });
    loop1.abort();
    expect(loop1.getTerminationReason()).toBe('aborted');
    expect(String(loop1.getAssistantMessage().content)).toContain(
      '已按你的请求停止'
    );

    // 外部信号中止但**未带**系统标记 ⇒ 仍按用户语义（零回归）
    const ac = new AbortController();
    const { ctx: ctx2 } = makeCtx({ abortSignal: ac.signal });
    const loop2 = new ReActToolLoop(ctx2, makeInput(), { maxIterations: 5 });
    ac.abort();
    expect(loop2.getTerminationReason()).toBe('aborted');
  });

  it('O2-2：`compaction_stalled` 的落盘被登记进 _terminalSettle ⇒ flush 能 await 到它', async () => {
    const { ctx } = makeCtx({
      // 截断（max_tokens）+ 无正文 ⇒ kind='truncated'
      llmSequence: [
        () => ({ content: '', stop_reason: 'max_tokens' }) as ChatResponse,
      ],
    });
    // maxIterations 取大值：避免触发"接近上限"的强制收尾（那会先短路本路径）
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 20 });
    (
      loop as unknown as { isCompactionStalled: () => boolean }
    ).isCompactionStalled = () => true;

    const calls: string[] = [];
    let finished = false;
    (
      loop as unknown as {
        settleGoalForTurnNow: (reason: string) => Promise<void>;
      }
    ).settleGoalForTurnNow = async (reason: string) => {
      calls.push(reason);
      await new Promise((r) => setTimeout(r, 50));
      finished = true;
    };

    await drain(loop);
    expect(loop.getTerminationReason()).toBe('compaction_failed');
    expect(calls).toEqual(['compaction_stalled']);
    // 修复前：`void this.settleGoalForTurnNow(...)` 显式 detach 且未登记
    // ⇒ _terminalSettle 只含"无 goalReason"的空 IIFE ⇒ 此处仍是 false（失败）
    expect(finished).toBe(false);
    await loop.flushTerminalSettlement();
    expect(finished).toBe(true);
  });
});
