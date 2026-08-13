/**
 * ReActToolLoop M1 细化测试：循环检测 / 残缺工具重试 / 交互恢复 / maxTurns
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

function makeCtx(
  overrides: Partial<ToolLoopContext> & {
    llmSequence?: Array<() => ChatResponse>;
  } = {}
): { ctx: ToolLoopContext; executed: Array<Record<string, unknown>> } {
  const executed: Array<Record<string, unknown>> = [];
  const seq = overrides.llmSequence ?? [
    () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
  ];
  let callNo = 0;
  const ctx = {
    session: { id: 'sess-m1', messages: [], metadata: {}, state: {} },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (tc: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      sessionId?: string;
    }) => {
      executed.push({ name: tc.name, args: tc.arguments });
      return { result: 'ok', error: undefined };
    },
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({ id: 't', content: String(result) }),
      createAssistantMessage: (content: string) => ({ id: 'a', content, role: 'assistant' }),
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
      sendMessage: async () => seq[Math.min(callNo++, seq.length - 1)](),
      getProviderId: () => 'mock',
    },
    unifiedTracker: { resetStreamTokens: () => {}, updateBaselineForRound: () => {} },
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
  return { ctx, executed };
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

describe('ReActToolLoop M1 细化', () => {
  it('循环检测：critical 触发后停止循环，最终消息含循环提示，不再调 LLM', async () => {
    const calls: string[] = [];
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
        detect: () => ({ stuck: true, level: 'critical', detector: 'file_io', message: '重复读写' }),
        recordToolCallOutcome: () => {},
        recordTurn: () => {},
      } as never,
      activeClient: {
        sendMessage: async () => {
          calls.push('llm');
          return {
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          } as ChatResponse;
        },
        getProviderId: () => 'mock',
      } as never,
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const _e of loop.run(makeInput())) {
      /* consume */
    }
    const final = loop.getAssistantMessage();
    expect(final.content).toContain('检测到工具调用循环');
    // 循环检测后 reason 不再调 LLM（llmCalls = 初始 1 次）
    expect(calls.length).toBe(1);
  });

  it('残缺工具重试：尾部残缺标签无 tool_calls → 重试一次后成功', async () => {
    const { ctx, executed } = makeCtx({
      llmSequence: [
        () =>
          ({ content: '读取中<invoke>', stop_reason: 'stop' }) as ChatResponse,
        () =>
          ({
            content: '完成',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'read', arguments: { path: 'a' } }],
          }) as ChatResponse,
        () => ({ content: '完成', stop_reason: 'stop' }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const _e of loop.run(makeInput())) {
      /* consume */
    }
    // 残缺重试后成功执行 read
    expect(executed.some((e) => e.name === 'read')).toBe(true);
  });

  it('交互恢复：requiresUserInteraction 工具等待答案后执行', async () => {
    const { ctx, executed } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'ask_user', arguments: {} }],
          }) as ChatResponse,
        () => ({ content: 'ok', stop_reason: 'stop' }) as ChatResponse,
      ],
      toolRegistry: {
        getTool: (name: string) =>
          name === 'ask_user'
            ? { requiresUserInteraction: () => true }
            : undefined,
      } as never,
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const runPromise = (async () => {
      for await (const _e of loop.run(makeInput())) {
        /* consume */
      }
    })();
    // 等待 pendingInteractions 注册后注入答案
    await new Promise((r) => setTimeout(r, 10));
    const entry = ctx.pendingInteractions.get('sess-m1');
    expect(entry).toBeTruthy();
    entry.resolve(['用户选择 A']);
    await runPromise;
    expect(executed[0]?.name).toBe('ask_user');
    expect((executed[0]?.args as Record<string, unknown>)?._userAnswers).toEqual([
      '用户选择 A',
    ]);
  });

  it('maxTurns：超过最大轮次后最终消息含提示', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc2', name: 'bash', arguments: {} }],
          }) as ChatResponse,
        () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc3', name: 'bash', arguments: {} }],
          }) as ChatResponse,
        () => ({ content: 'done', stop_reason: 'stop' }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 2 });
    for await (const _e of loop.run(makeInput())) {
      /* consume */
    }
    const final = loop.getAssistantMessage();
    expect(final.content).toContain('最大工具轮次限制');
  });
});
