/**
 * 流式预算**记账量纲**回归（2026-09-26 根因修复的守卫）。
 *
 * 缺陷（`app.log` 实测证据）：`_chargeStreamBudget` 原用
 * `ctx.estimateMessagesTokens(loopState.messages)` 记账，与 provider 真实用量相差 **6.4 倍**
 * （同一轮：真实 `prompt_tokens` **29,143** vs 记账 **185,195 / 200,000 = 93%**），
 * 且该值在真实会话里**单调不降**（压缩零回落）⇒ 对称记账的"退款"分支永不触发
 * ⇒ 长任务在第 **114 / 190** 轮被误杀（本地 2026-09-26 23:06，用户质问"又出现了…根因找不到吗？"）。
 *
 * 修法：改用 provider 返回的真实 `prompt_tokens`（即"当前上下文占用"的 ground truth）；
 * 无 usage 时**不记账**（fail-open：宁可少一道兜底，也不误杀）。
 *
 * 本用例锁住两条契约：
 *  ① 有 usage ⇒ 记账值 **恒等于** `usage.prompt_tokens`（**不经过**估算器）；
 *  ② 无 usage ⇒ **一次都不记账**，且不抛错。
 * 估算器被刻意桩成"离谱值"（999,999）：实现一旦回退到估算记账，① 立即转红。
 */
import { describe, expect, it } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';

function makeCtx(responses: Array<() => ChatResponse>): ToolLoopContext {
  let callNo = 0;
  return {
    session: { id: 'sess-budget', messages: [], metadata: {}, state: {} },
    options: { model: 'deepseek-v4-flash' },
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
      createAssistantMessage: (content: string, options?: { id?: string }) => ({
        id: options?.id ?? 'a-gen',
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* () {
        return responses[Math.min(callNo++, responses.length - 1)]();
      },
      sendMessage: async () =>
        responses[Math.min(callNo++, responses.length - 1)]() as ChatResponse,
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
    // 关键桩：估算值与真实量纲相差极大 ⇒ 用它记账必被下方断言抓到
    estimateMessagesTokens: () => 999_999,
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (m: Record<string, unknown>[]) => m,
    maxToolTurns: 3,
  } as unknown as ToolLoopContext;
}

/** 假预算：记录每次 charge 的入参 */
function makeBudget(): { charged: number[]; budget: never } {
  const charged: number[] = [];
  const budget = {
    canExecute: () => true,
    needsGraceCall: () => false,
    chargeContextEstimate: (tokens: number) => charged.push(tokens),
  } as never;
  return { charged, budget };
}

function makeInput(): never {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never;
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

describe('流式预算记账量纲：provider 真实 prompt_tokens', () => {
  it('有 usage ⇒ 记账 == usage.prompt_tokens（不走估算器）', async () => {
    const { charged, budget } = makeBudget();
    const ctx = makeCtx([
      () =>
        ({
          content: 'done',
          stop_reason: 'stop',
          usage: { prompt_tokens: 29143, completion_tokens: 878 },
        }) as unknown as ChatResponse,
    ]);

    await drain(
      new ReActToolLoop(ctx, makeInput(), { maxIterations: 2, budget })
    );

    expect(charged).toEqual([29143]);
    expect(charged).not.toContain(999_999);
  });

  it('无 usage ⇒ 不记账（fail-open，不误杀长任务）', async () => {
    const { charged, budget } = makeBudget();
    const ctx = makeCtx([
      () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
    ]);

    await drain(
      new ReActToolLoop(ctx, makeInput(), { maxIterations: 2, budget })
    );

    expect(charged).toEqual([]);
  });
});
