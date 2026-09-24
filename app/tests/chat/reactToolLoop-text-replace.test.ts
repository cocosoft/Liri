/**
 * O2-4（2026-09-24「会话暴露问题分析与优化方案」§五，跨端修复）**生产侧**：
 * ① 回捞重试轮的首个正文 delta 携带 `replace`（前端据此取代前一轮正文）；
 * ② 正常单轮正文**不携带**该标记（防误清）。
 *
 * 「修复前必失败」：不置位时 `replace` 恒为 undefined，重复段落无法被前端消除。
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
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
    session: { id: 'sess-o24', messages: [], metadata: {}, state: {} },
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

function makeInput() {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    // 必须走流式路径：非流式不产出 reasoning_delta（本用例断言的对象）
    nonStreaming: false,
  } as never;
}

/** 收集本轮所有正文 delta 及其 replace 标记 */
async function collectTextDeltas(
  loop: ReActToolLoop
): Promise<Array<{ text: string; replace?: boolean }>> {
  const out: Array<{ text: string; replace?: boolean }> = [];
  for await (const e of loop.run(makeInput())) {
    if (e.type === 'reasoning_delta') {
      out.push({ text: e.text, replace: e.replace });
    }
  }
  return out;
}

describe('O2-4 正文取代标记（生产侧）', () => {
  it('空回复回捞 ⇒ 重试轮首个 delta 带 replace（前端据此取代，修复前必失败）', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        // 第 1 轮：空正文（无 tool_calls）⇒ 触发 empty 回捞
        () => ({ content: '', stop_reason: 'stop' }) as ChatResponse,
        // 第 2 轮（重试）：正常正文
        () =>
          ({ content: '我先定位这两个文件。', stop_reason: 'stop' }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    const deltas = await collectTextDeltas(loop);

    // 修复前：replace 为 undefined ⇒ 前端 append ⇒ 与落盘（整体替换）不同源
    expect(deltas).toEqual([{ text: '我先定位这两个文件。', replace: true }]);
  });

  it('正常单轮正文不带 replace（防误清既有正文）', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () => ({ content: '正常回答。', stop_reason: 'stop' }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });

    const deltas = await collectTextDeltas(loop);

    expect(deltas).toEqual([{ text: '正常回答。', replace: undefined }]);
  });
});
