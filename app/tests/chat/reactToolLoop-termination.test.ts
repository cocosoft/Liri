/**
 * 一期 F1-1 / F1-2 / F1-3（2026-09-23 修复计划）：「未返回信息即终止」止血
 *
 * 背景：BUG「执行任务过程中未返回信息即终止」——多数终止路径在架构上没有第二次
 * 开口的机会，用户看到静默空白（会话实测：3 个用户轮只换回 3 条文本，第 1 轮零文本）。
 *
 * 本文件锁定一期三项修复，**每个用例均为「修复前必失败」**（断言修复后才成立的行为）：
 *  - F1-1：终止输出文案**单一来源** + 「正文为空」为唯一真判据（兜底非空）
 *  - F1-2：`finishReason` 不再被「有 tool_calls」覆盖（截断信号不销毁）
 *  - F1-3：用户主动停止必须有非空文本（此前落盘空消息）
 *
 * 参照 plan：dev_docs/error_repairs/BUG修复计划-未返回信息即终止-20260923.md §六 一期
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
    session: { id: 'sess-termination', messages: [], metadata: {}, state: {} },
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
      // 保留 options.id（一期 F1-1：finalize 复用既有消息 id，防前端气泡错位）
      createAssistantMessage: (
        content: string,
        options?: { sessionId?: string; id?: string }
      ) => ({
        id: options?.id ?? 'a-gen',
        content,
        role: 'assistant',
      }),
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

/** 消费整个循环（事件本身不参与断言，只取终局状态） */
async function drain(loop: ReActToolLoop): Promise<void> {
  for await (const _e of loop.run(makeInput())) {
    /* consume */
  }
}

describe('ReActToolLoop 终止收尾（一期 F1-1/F1-2/F1-3）', () => {
  it('F1-1：正常结束但正文为空 ⇒ 最终消息给出非空兜底，且与流式补发提示逐字相等', async () => {
    const { ctx } = makeCtx({
      // 连续两轮空回复：首轮触发 onIncompleteTurn 回捞，第二轮额度耗尽 ⇒
      // shouldContinue=false → phase='completed' → 旧实现落空消息（静默空白）
      llmSequence: [
        () => ({ content: '', stop_reason: 'stop' }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 5 });
    await drain(loop);

    const final = loop.getAssistantMessage();
    const tip = loop.getTerminationTip();

    // 修复前：tip === '' 且 content === '' ⇒ 两条断言同时失败
    expect(tip.length).toBeGreaterThan(0);
    expect(String(final.content)).toContain('本次未能生成回复');
    // 文案单一来源：流式补发通道与落库正文必须逐字一致（④ 修不彻底的物理原因）
    expect(String(final.content)).toBe(tip);
  });

  it('F1-2：截断 + 有 tool_calls ⇒ finishReason 保留 max_tokens（不再被覆盖），rawFinishReason 并存', async () => {
    const { ctx } = makeCtx({
      llmSequence: [
        () =>
          ({
            content: '',
            stop_reason: 'max_tokens',
            tool_calls: [{ id: 'tc1', name: 'bash', arguments: {} }],
          }) as ChatResponse,
      ],
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 1 });
    const seen: Array<{ finishReason?: string; rawFinishReason?: string }> = [];
    for await (const ev of loop.run(makeInput())) {
      if (ev.type === 'reasoning_end') {
        seen.push(ev.result as never);
      }
    }

    expect(seen.length).toBeGreaterThan(0);
    // 修复前：三元表达式把真实原因改写成 'tool_calls' ⇒ 截断信号被吃掉
    expect(seen[0].finishReason).toBe('max_tokens');
    expect(seen[0].rawFinishReason).toBe('max_tokens');
  });

  it('F1-3：用户主动停止且尚无正文 ⇒ 最终消息非空（此前兜底为 lastError ?? ""）', async () => {
    const { ctx } = makeCtx();
    const loop = new ReActToolLoop(
      { ...ctx, abortSignal: AbortSignal.abort() } as never,
      makeInput(),
      { maxIterations: 3 }
    );
    await drain(loop);

    const final = loop.getAssistantMessage();
    // 修复前：content === ''（无 aborted 分支）⇒ 失败
    expect(String(final.content).trim().length).toBeGreaterThan(0);
    expect(String(final.content)).toContain('已按你的请求停止');
  });

  it('F1-1：error 终止（lastError）时补发通道与落库正文逐字相等（此前补发返回空串）', async () => {
    const { ctx } = makeCtx({
      activeClient: {
        sendMessage: async () => {
          throw new Error('boom');
        },
        getProviderId: () => 'mock',
      } as never,
    });
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    await drain(loop);

    const final = loop.getAssistantMessage();
    const tip = loop.getTerminationTip();

    // 修复前：getTerminationTip() 只认 max_turns/loop_detected ⇒ 返回 '' ⇒ 用户看不到原因
    expect(tip).toContain('boom');
    expect(String(final.content)).toContain('boom');
    expect(String(final.content)).toBe(tip);
  });
});
