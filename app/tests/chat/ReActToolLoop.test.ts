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
    const toolCalls: Array<{ phase: string; toolName: string; id: string }> = [];
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
      onToolCall: (
        phase: string,
        toolName: string,
        id: string,
        detail?: {
          args?: Record<string, unknown>;
          ok?: boolean;
          message?: string;
          result?: unknown;
        }
      ) => {
        toolCalls.push({ phase, toolName, id, detail });
      },
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
    // P0-4：act() 执行工具前后同步触发 onToolCall（start 带完整参数对象 / end 带 ok/message/result）
    expect(toolCalls).toEqual([
      {
        phase: 'start',
        toolName: 'read',
        id: 'tc1',
        detail: { args: { path: 'a' } },
      },
      {
        phase: 'end',
        toolName: 'read',
        id: 'tc1',
        detail: {
          ok: true,
          message: expect.stringContaining('成功') as string,
          result: 'file content',
        },
      },
    ]);
  });

  it('对象/数组结果的工具 → tool_end 携带 JSON 序列化 output（遗漏 1）', async () => {
    const ctx = makeCtx({
      activeClient: {
        sendMessage: async () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [
              { id: 'tc1', name: 'grep', arguments: { pattern: 'x' } },
            ],
          }) as ChatResponse,
        getProviderId: () => 'mock',
      } as never,
      executeTool: async () => ({
        result: { files: ['a.ts', 'b.ts'], total: 2 },
        error: undefined,
      }),
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const events: ReActEvent[] = [];
    for await (const e of loop.run(makeInput())) {
      events.push(e);
      if (e.type === 'iteration_end') break;
    }
    const toolEnd = events.find((e) => e.type === 'tool_end');
    const result =
      toolEnd && toolEnd.type === 'tool_end' ? toolEnd.result : null;
    expect(result?.status).toBe('success');
    // 对象结果也下发（不再 undefined → 前端结果区空白）
    expect(result?.output).toBe(
      JSON.stringify({ files: ['a.ts', 'b.ts'], total: 2 })
    );
  });

  it('pendingApproval 工具 → onToolCall 仅 start，不触发 end（遗漏 2）', async () => {
    const toolCalls: Array<{ phase: string; toolName: string; id: string }> = [];
    const ctx = makeCtx({
      activeClient: {
        sendMessage: async () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [
              { id: 'tc1', name: 'bash', arguments: { command: 'rm' } },
            ],
          }) as ChatResponse,
        getProviderId: () => 'mock',
      } as never,
      executeTool: async () => ({
        result: { pendingApproval: true },
        error: undefined,
      }),
      onToolCall: (phase: string, toolName: string, id: string) => {
        toolCalls.push({ phase, toolName, id });
      },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const e of loop.run(makeInput())) {
      if (e.type === 'iteration_end') break;
    }
    // 审批等待：end 不触发，避免误报 "✅ Tool completed" / 聚合计数错误
    expect(toolCalls).toEqual([
      { phase: 'start', toolName: 'bash', id: 'tc1' },
    ]);
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
      {
        type: 'tool_start',
        callId: 'tc1',
        name: 'read',
        input: { file: 'src/a.ts' },
      },
      'sess-test'
    );
    expect(chunks[0].type).toBe('tool_call');
    expect(chunks[0].toolCall?.name).toBe('read');
    // P0-1：tool_start 携带参数 → 转换层下发 arguments（修复 M1 迁移后恒为空）
    expect(chunks[0].toolCall?.arguments).toEqual({ file: 'src/a.ts' });
    expect(chunks[0].toolCall?.status).toBe('running');

    const statusChunks = reactEventsToChunks(
      { type: 'reasoning_start' },
      'sess-test'
    );
    expect(statusChunks[0].type).toBe('status');
  });

  it('事件转换层：tool_end → 状态 completed/failed + 携带 result（P0-2）', () => {
    // 成功：output 注入 result，状态 completed
    const doneChunks = reactEventsToChunks(
      {
        type: 'tool_end',
        callId: 'tc1',
        result: {
          toolCallId: 'tc1',
          name: 'read',
          status: 'success',
          output: 'file content: hello',
        },
      },
      'sess-test'
    );
    expect(doneChunks[0].toolCall?.status).toBe('completed');
    expect(doneChunks[0].toolCall?.result).toEqual({
      success: true,
      data: 'file content: hello',
    });

    // 失败：状态 failed，附加 status 提示
    const errChunks = reactEventsToChunks(
      {
        type: 'tool_end',
        callId: 'tc1',
        result: {
          toolCallId: 'tc1',
          name: 'bash',
          status: 'error',
          error: 'command not found',
        },
      },
      'sess-test'
    );
    expect(errChunks[0].toolCall?.status).toBe('failed');
    expect(errChunks[1].type).toBe('status');
  });
});
