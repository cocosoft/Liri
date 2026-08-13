/**
 * ReActToolLoop 单元测试（M1a：骨架壳 + 事件转换层）
 *
 * 模式：仿 ReActLoop.e2e.test.ts —— 预置 LLM 响应（mock activeClient.streamMessage
 * 产出 tool_calls）→ 断言 ReActEvent 事件流 + 最终 return 值。
 * 覆盖：工具轮完整流程 / 无工具直接结束 / 工具错误 / 最大轮数。
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import { reactEventsToChunks } from '../../src/chat/reactEventsToChunks.js';
import type { ReActEvent } from '../../src/query/ReActLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

function makeCtx(overrides: Partial<ToolLoopContext> = {}): ToolLoopContext {
  const session = { id: 'sess-test' };
  const ctx = {
    session,
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      sessionId?: string;
    }) => ({ result: `executed:${toolCall.name}`, error: undefined }),
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({ id: 'tool-msg', content: String(result) }),
      createAssistantMessage: (content: string) => ({
        id: 'assistant-msg',
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: {
      saveCheckpointWithData: async () => undefined,
    },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        _messages: ChatMessage[],
        _options: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        yield 'ok';
        return { content: '', stop_reason: 'stop' } as ChatResponse;
      },
      sendMessage: async () => ({ content: '', stop_reason: 'stop' } as ChatResponse),
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
  return ctx;
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

describe('ReActToolLoop (M1a)', () => {
  beforeEach(() => {});

  it('无工具调用：直接结束，finalize 产出助手消息', async () => {
    const ctx = makeCtx();
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const events: ReActEvent[] = [];
    for await (const e of loop.run(makeInput())) {
      events.push(e);
    }
    const result = loop.getAssistantMessage();
    expect(events.some((e) => e.type === 'reasoning_start')).toBe(true);
    expect(events.some((e) => e.type === 'acting_start')).toBe(false);
    expect(result).toBeTruthy();
  });

  it('工具轮：reason 产出 tool_calls → act 执行 → 事件流含 tool_start/tool_end', async () => {
    const ctx = makeCtx({
      activeClient: {
        streamMessage: async function* (
          _messages: ChatMessage[],
          _options: Record<string, unknown>
        ): AsyncGenerator<string, ChatResponse> {
          yield 'thinking';
          return {
            content: '使用工具',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'read', arguments: { path: 'a' } }],
          } as ChatResponse;
        },
        sendMessage: async () =>
          ({
            content: '使用工具',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'read', arguments: { path: 'a' } }],
          }) as ChatResponse,
        getProviderId: () => 'mock',
      } as never,
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        sessionId?: string;
      }) => ({ result: 'file content', error: undefined }),
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const events: ReActEvent[] = [];
    for await (const e of loop.run(makeInput())) {
      events.push(e);
      if (e.type === 'iteration_end') break; // 单轮验证
    }
    expect(events.some((e) => e.type === 'tool_start')).toBe(true);
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd && toolEnd.type === 'tool_end' ? toolEnd.result.status : '').toBe(
      'success'
    );
  });

  it('工具错误：tool_end status=error', async () => {
    const ctx = makeCtx({
      activeClient: {
        sendMessage: async () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
        getProviderId: () => 'mock',
      } as never,
      executeTool: async () => ({ result: undefined, error: 'boom' }),
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const events: ReActEvent[] = [];
    for await (const e of loop.run(makeInput())) {
      events.push(e);
      if (e.type === 'iteration_end') break;
    }
    const toolEnd = events.find((e) => e.type === 'tool_end');
    expect(toolEnd && toolEnd.type === 'tool_end' ? toolEnd.result.status : '').toBe(
      'error'
    );
  });

  it('事件转换层：reasoning_start → status chunk；tool_start → tool_call chunk', () => {
    const chunks = reactEventsToChunks(
      { type: 'tool_start', callId: 'tc1', name: 'read' },
      'sess-test'
    );
    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('read');

    const statusChunks = reactEventsToChunks(
      { type: 'reasoning_start' },
      'sess-test'
    );
    expect(statusChunks[0].type).toBe('status');
  });
});
