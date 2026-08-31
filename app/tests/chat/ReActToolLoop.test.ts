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

// expect 的 stringContaining 类型被 src/ink/ink/global.d.ts 的旧 bun:test 声明
// （expect(value: unknown): any）合并覆盖，运行时 bun 支持该匹配器，此处仅补类型
const stringContaining = (expect as unknown as {
  stringContaining: (str: string) => unknown;
}).stringContaining;

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
    const toolCalls: Array<{
      phase: string;
      toolName: string;
      id: string;
      detail?: {
        args?: Record<string, unknown>;
        ok?: boolean;
        message?: string;
        result?: unknown;
      };
    }> = [];
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
      }) => ({
        toolCallId: tc.id,
        toolName: tc.name,
        result: 'file content',
        error: undefined,
      }),
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
          message: stringContaining('成功') as string,
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
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        sessionId?: string;
      }) => ({
        toolCallId: tc.id,
        toolName: tc.name,
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
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        sessionId?: string;
      }) => ({
        toolCallId: tc.id,
        toolName: tc.name,
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
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        sessionId?: string;
      }) => ({
        toolCallId: tc.id,
        toolName: tc.name,
        result: undefined,
        error: 'boom',
      }),
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

  // ─── v3：交互链路（ask_user_question）───────────────────────────

  /** 交互工具 ctx：toolRegistry 返回 requiresUserInteraction 工具 + 捕获 executeTool 入参 */
  function makeInteractionCtx(capture?: { executedArgs?: Record<string, unknown> }) {
    return makeCtx({
      toolRegistry: {
        getTool: (name: string) =>
          name === 'ask_user_question'
            ? ({ requiresUserInteraction: () => true } as never)
            : undefined,
      },
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        sessionId?: string;
      }) => {
        if (capture) capture.executedArgs = tc.arguments;
        return {
          toolCallId: tc.id,
          toolName: tc.name,
          result: 'answered',
          error: undefined,
        };
      },
    });
  }

  /** 交互 LLM：首次产出 ask_user_question 调用，之后无工具正常结束 */
  function interactionLlm() {
    let calls = 0;
    return {
      sendMessage: async () => {
        calls++;
        if (calls === 1) {
          return {
            content: '请用户确认',
            stop_reason: 'tool_calls',
            tool_calls: [
              {
                id: 'tc1',
                name: 'ask_user_question',
                arguments: {
                  question: '请选择参与方式',
                  header: '确认',
                  options: [{ label: '是' }, { label: '否' }],
                },
              },
            ],
          } as ChatResponse;
        }
        return { content: '完成', stop_reason: 'stop' } as ChatResponse;
      },
      getProviderId: () => 'mock',
    } as never;
  }

  it('交互工具不阻塞：yield question + 注册 pendingInteraction + 恢复后继续执行（v3）', async () => {
    const capture: { executedArgs?: Record<string, unknown> } = {};
    const ctx = makeInteractionCtx(capture);
    const ctxWithLlm = makeCtx({
      ...ctx,
      activeClient: interactionLlm(),
    });
    const loop = new ReActToolLoop(ctxWithLlm, makeInput(), {
      maxIterations: 3,
    });
    const iter = loop.run(makeInput());
    const received: ReActEvent[] = [];
    let r = await iter.next();
    while (!r.done && r.value.type !== 'question') {
      received.push(r.value);
      r = await iter.next();
    }
    received.push(r.value as ReActEvent);
    // ① 首个事件应为 question，且 pendingInteractions 已注册
    expect(r.value.type).toBe('question');
    const entry = (
      ctxWithLlm.pendingInteractions as Map<
        string,
        { questionId: string; resolve: (a: string[]) => void }
      >
    ).get('sess-test');
    expect(entry).toBeTruthy();
    // ② 用户回答 → promise resolve → act 继续
    entry!.resolve(['是']);
    let final;
    while (true) {
      r = await iter.next();
      if (r.done) {
        final = r.value;
        break;
      }
      received.push(r.value);
    }
    // ③ 工具执行收到真实答案数组（非 generator 对象）
    expect(capture.executedArgs?._userAnswers).toEqual(['是']);
    expect(received.some((e) => e.type === 'question')).toBe(true);
    expect(
      received.find((e) => e.type === 'tool_end')
    ).toBeTruthy();
    expect(
      ctxWithLlm.pendingInteractions.has('sess-test')
    ).toBe(false);
    expect(final).toBeTruthy();
  });

  it('挂起期间持续产出 question_waiting 心跳（心跳间隔参数化缩短，v3）', async () => {
    const ctx = makeInteractionCtx();
    const ctxWithLlm = makeCtx({ ...ctx, activeClient: interactionLlm() });
    const loop = new ReActToolLoop(ctxWithLlm, makeInput(), {
      maxIterations: 3,
      interactionHeartbeatMs: 5,
    });
    const iter = loop.run(makeInput());
    const received: ReActEvent[] = [];
    let r = await iter.next();
    while (!r.done && r.value.type !== 'question') {
      received.push(r.value);
      r = await iter.next();
    }
    // 到达 question 后不 resolve，收集心跳
    let hbCount = 0;
    let guard = 0;
    while (guard++ < 30 && !r.done && hbCount === 0) {
      r = await iter.next();
      if (r.value.type === 'question_waiting') hbCount++;
    }
    // 结束挂起，避免测试悬挂
    const entry = (
      ctxWithLlm.pendingInteractions as Map<
        string,
        { resolve: (a: string[]) => void }
      >
    ).get('sess-test');
    entry?.resolve(['是']);
    while (true) {
      r = await iter.next();
      if (r.done) break;
    }
    expect(hbCount).toBeGreaterThan(0);
  });

  it('abortSignal 中止时清理 pendingInteraction 并正常退出（v3）', async () => {
    const controller = new AbortController();
    const ctx = makeInteractionCtx();
    const ctxWithLlm = makeCtx({
      ...ctx,
      abortSignal: controller.signal,
      activeClient: interactionLlm(),
    });
    const loop = new ReActToolLoop(ctxWithLlm, makeInput(), {
      maxIterations: 3,
    });
    const iter = loop.run(makeInput());
    let r = await iter.next();
    while (!r.done && r.value.type !== 'question') {
      r = await iter.next();
    }
    expect(r.value.type).toBe('question');
    // 触发 abort → act 的 race 命中 abort → 清理并退出
    controller.abort();
    while (true) {
      r = await iter.next();
      if (r.done) break;
    }
    expect(ctxWithLlm.pendingInteractions.has('sess-test')).toBe(false);
  });

  it('同轮多提问防护：已有 pending 交互时产出 error result（tool_end 闭环，v3）', async () => {
    const ctx = makeInteractionCtx();
    const ctxWithLlm = makeCtx({
      ...ctx,
      activeClient: {
        sendMessage: async () =>
          ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [
              {
                id: 'tc1',
                name: 'ask_user_question',
                arguments: {
                  question: '请确认',
                  header: '确认',
                  options: [{ label: '是' }],
                },
              },
            ],
          }) as ChatResponse,
        getProviderId: () => 'mock',
      } as never,
    });
    // 预塞一个挂起交互（模拟同轮已有 pending）：防护分支应在提问前拦截 tc1
    (
      ctxWithLlm.pendingInteractions as Map<string, unknown>
    ).set('sess-test', {
      questionId: 'q_existing',
      promise: new Promise(() => {}),
      resolve: () => {},
    });
    const loop = new ReActToolLoop(ctxWithLlm, makeInput(), {
      maxIterations: 3,
    });
    const iter = loop.run(makeInput());
    const received: ReActEvent[] = [];
    let r = await iter.next();
    while (!r.done) {
      received.push(r.value);
      r = await iter.next();
    }
    // 防护触发：不产出 question（未重复注册/提问）；tc1 产出 error result → tool_end 闭环（无悬挂卡片）
    expect(received.filter((e) => e.type === 'question').length).toBe(0);
    const tc1End = received.find(
      (e) => e.type === 'tool_end' && e.result.toolCallId === 'tc1'
    );
    expect(tc1End && tc1End.type === 'tool_end' ? tc1End.result.status : '').toBe(
      'error'
    );
    // 预塞的 entry 未被覆盖/误删
    expect(
      (ctxWithLlm.pendingInteractions as Map<string, { questionId: string }>).get(
        'sess-test'
      )?.questionId
    ).toBe('q_existing');
  });
});

// M1-INV②（2026-08-31）：孤儿补偿锁定——B-2 finally 补发契约回归保护。
// 契约：已写 tool_call 事件（toolCallSeqMap 有记录）但未完成的工具，循环结束时
// 必有 tool/canceled 终态（回放不悬挂）；正常完成/失败的工具不补发。
describe('ReActToolLoop 孤儿补偿（M1-INV②）', () => {
  function makeOrphanCtx(
    toolResult: { result: unknown; error?: string },
    overrides: Partial<Record<string, unknown>> = {}
  ) {
    const capturedEvents: Array<{
      type: string;
      data: Record<string, unknown>;
    }> = [];
    let reasonRound = 0;
    const llmResponse = (): ChatResponse =>
      reasonRound++ === 0
        ? ({
            content: '',
            stop_reason: 'tool_calls',
            tool_calls: [
              {
                id: 'tc-pending',
                name: 'ask_user_question',
                arguments: { question: '请确认', header: '确认' },
              },
            ],
          }) as ChatResponse
        : ({ content: 'done', stop_reason: 'stop' }) as ChatResponse;
    const ctx = makeCtx({
      appendStreamEvent: async (
        _sid: string,
        ev: { type: string; data: Record<string, unknown> }
      ) => {
        capturedEvents.push(ev);
      },
      getStreamTailSeq: async () => 0,
      // 预填：模拟 streamMessageFlow 已在 tool_start 时写入 assistant/tool_call 事件
      toolCallSeqMap: new Map([['tc-pending', 42]]),
      executeTool: async () => ({
        toolCallId: 'tc-pending',
        toolName: 'ask_user_question',
        ...toolResult,
      }),
      activeClient: {
        sendMessage: async () => llmResponse(),
        streamMessage: async function* () {
          yield 'ok';
          return llmResponse() as ChatResponse;
        },
        getProviderId: () => 'mock',
      },
      ...overrides,
    } as Partial<ToolLoopContext>);
    return { ctx, capturedEvents };
  }

  it('挂起的审批/提问工具未恢复 → 循环结束补发 tool/canceled（callSeq 闭环）', async () => {
    // 模拟审批/提问挂起等待：工具返回 pendingApproval=true 且永不恢复
    const { ctx, capturedEvents } = makeOrphanCtx({
      result: { pendingApproval: true },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const _e of loop.run(makeInput())) {
      // 消费事件流至结束
    }
    const canceled = capturedEvents.find((e) => e.type === 'tool/canceled');
    expect(canceled).toBeTruthy();
    expect(canceled?.data.toolCallId).toBe('tc-pending');
    expect(canceled?.data.callSeq).toBe(42);
  });

  it('正常完成的工具 → 不补发 tool/canceled', async () => {
    const { ctx, capturedEvents } = makeOrphanCtx({
      result: { output: 'done' },
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const _e of loop.run(makeInput())) {
      // 消费事件流至结束
    }
    expect(capturedEvents.find((e) => e.type === 'tool/canceled')).toBe(
      undefined
    );
  });

  it('失败的工具（status=error 也是终态）→ 不补发 tool/canceled', async () => {
    const { ctx, capturedEvents } = makeOrphanCtx({
      result: { output: null },
      error: 'boom',
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    for await (const _e of loop.run(makeInput())) {
      // 消费事件流至结束
    }
    expect(capturedEvents.find((e) => e.type === 'tool/canceled')).toBe(
      undefined
    );
  });
});
