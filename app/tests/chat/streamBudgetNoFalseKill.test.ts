/**
 * 「长任务被误杀」**端到端（loop 级）**回归 —— 2026-09-26 根因修复的闭环守卫。
 *
 * 复刻真实事故形态（本地 2026-09-26 23:06：`iteration 114 / maxIterations 190` 被掐断）：
 *  - **估算器**给出膨胀值（实测与真实差 6.4×：真实 29,143 vs 估算 185,195）；
 *  - 而**每轮真实请求量**始终只有 ~29k（远低于窗口的 92% 阈值）。
 *
 * 旧实现（用估算记账）⇒ 第 2 轮起即触顶 ⇒ `budget_exhausted`（**本用例会红**）；
 * 现实现（用 provider 真实 `prompt_tokens`）⇒ 长跑不终止 ⇒ 绿。
 *
 * 与 `streamBudgetRealUsage.test.ts`（单轮量纲）配套：本文件锁的是**长期行为**——不被误杀。
 * 注意本用例用的是**生产同款** `createStreamBudget`（真实 `TokenBudgetController` + 真实窗口）。
 */
import { describe, expect, it } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop';
import { createStreamBudget } from '../../src/chat/createAgentLoop';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';

const MODEL = 'deepseek-v4-flash';
/** 事故中该会话的**真实**单轮输入量（`app.log`：`inputTokens: 29143`） */
const REAL_PROMPT_TOKENS = 29143;
/** 事故中池胀后的估算值（`tokenBudget:checkBudget`：`spent: 185195`）——刻意取得更大，确保旧实现必触顶 */
const INFLATED_ESTIMATE = 300_000;

interface BudgetChargeRecorder {
  loop: ReActToolLoop;
  rounds: () => number;
}

function makeHarness(): BudgetChargeRecorder {
  let round = 0;
  const ctx = {
    session: {
      id: 'sess-no-false-kill',
      messages: [],
      metadata: {},
      state: {},
    },
    options: { model: MODEL },
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
        return { content: 'done', stop_reason: 'stop' } as ChatResponse;
      },
      // 每轮：真实用量恒定在 29k（安全区），同时给出**膨胀的估算**（复刻事故）
      sendMessage: async () => {
        round++;
        return {
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            {
              id: `t${round}`,
              name: 'file_read',
              arguments: { file_path: `src/f${round}.ts` },
            },
          ],
          usage: {
            prompt_tokens: REAL_PROMPT_TOKENS,
            completion_tokens: 50,
          },
        } as unknown as ChatResponse;
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
    // 关键桩：估算值膨胀到 300k（旧实现据此记账 ⇒ 必被 92% 阈值误杀）
    estimateMessagesTokens: () => INFLATED_ESTIMATE,
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (m: Record<string, unknown>[]) => m,
    maxToolTurns: 60,
  } as unknown as ToolLoopContext;

  const loop = new ReActToolLoop(
    ctx,
    {
      apiMessages: [{ role: 'user', content: 'hi' }],
      currentToolCalls: [],
      assistantMessage: null,
      nonStreaming: true,
    } as never,
    { maxIterations: 60, budget: createStreamBudget(MODEL) as never }
  );
  return { loop, rounds: () => round };
}

async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run({
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never)) {
    /* consume */
  }
}

describe('长任务端到端：不得因预算被误杀（真实用量安全 + 估算膨胀）', () => {
  it('估算膨胀到 300k 但真实仅 29k ⇒ 长跑不因预算终止', async () => {
    const { loop, rounds } = makeHarness();

    await drain(loop);

    // 旧实现（用估算记账）：第 2 轮即 `budget_exhausted` ⇒ 本断言转红
    expect(loop.getTerminationReason()).not.toBe('budget_exhausted');
    // 且确实跑了多轮（证明"长任务活下来了"，而非立刻以别的理由结束）
    expect(rounds()).toBeGreaterThanOrEqual(5);
  });
});
