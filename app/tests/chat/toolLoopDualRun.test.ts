/**
 * M1b 双跑对比：新类 ReActToolLoop vs 旧类 ToolLoopRunner
 *
 * 同一 mock 上下文 + 同一输入，分别跑新旧两条路径，对比：
 *  1. LLM 调用次数（语义一致性）
 *  2. 工具执行序列（语义一致性）
 *  3. 最终助手消息（差异报告——M1a 简化未维护 assistantMessage，如实记录）
 * 产出《双跑一致性报告》供 M1 细化参考。
 */

import { describe, it, expect } from 'bun:test';
import { ToolLoopRunner } from '../../src/chat/ToolLoopRunner.js';
import type { ToolLoopContext, ToolLoopInput } from '../../src/chat/ToolLoopRunner.js';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ChatResponse, ChatMessage } from '@modules/ai';

interface RunTrace {
  llmCalls: string[][]; // 每次 LLM 调用收到的消息 role 列表
  toolExecutions: string[]; // 工具执行序列
  finalContent: string; // 最终助手消息内容
}

/** 构造双跑共享 mock 上下文：记录 LLM 调用与工具执行 */
function makeDualCtx(): { ctx: ToolLoopContext; trace: RunTrace } {
  const trace: RunTrace = { llmCalls: [], toolExecutions: [], finalContent: '' };
  let llmCallNo = 0;

  // 预设 LLM 响应：第 1 次工具调用，第 2 次结束
  function nextResponse(messages: ChatMessage[]): ChatResponse {
    llmCallNo++;
    trace.llmCalls.push(messages.map((m) => m.role));
    if (llmCallNo === 1) {
      return {
        content: '我需要读取文件',
        model: 'mock',
        stop_reason: 'tool_calls',
        tool_calls: [{ id: 'tc-1', name: 'read', arguments: { path: 'a.txt' } }],
      } as ChatResponse;
    }
    return {
      content: '文件已读取完成',
      model: 'mock',
      stop_reason: 'stop',
    } as ChatResponse;
  }

  const ctx = {
    session: { id: 'sess-dual', messages: [] },
    options: {},
    abortSignal: new AbortController().signal,
    executeTool: async (toolCall: {
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      sessionId?: string;
    }) => {
      trace.toolExecutions.push(toolCall.name);
      return { result: 'file content', error: undefined };
    },
    pendingInteractions: new Map(),
    loopDetector: {
      detect: () => ({ stuck: false }),
      recordToolCallOutcome: () => {},
      recordTurn: () => {},
    },
    messageService: {
      createToolResultMessage: (result: unknown) => ({
        id: 'tool-msg',
        content: String(result),
        role: 'tool',
      }),
      createAssistantMessage: (content: string) => ({
        id: `assistant-${llmCallNo}`,
        content,
        role: 'assistant',
      }),
    },
    addAndPersistMessage: () => {},
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        messages: ChatMessage[],
        _options: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        const resp = nextResponse(messages);
        if (resp.content) yield resp.content;
        return resp;
      },
      sendMessage: async (messages: ChatMessage[]) => nextResponse(messages),
      getProviderId: () => 'mock',
    },
    unifiedTracker: { resetStreamTokens: () => {}, updateBaselineForRound: () => {} },
    recordChatResponseUsage: () => {},
    onToolUsage: () => {},
    toolResultRegistry: {
      storeResult: () => {},
      getCurrentRound: () => 0,
      nextRound: () => 1,
    },
    toolRegistry: { getTool: () => undefined },
    toolDefinitions: [],
    buildToolRoundMessages: (
      currentMessages: Record<string, unknown>[],
      _assistantMsg: unknown,
      currentToolCalls: Array<{ name: string }>,
      processedResults: unknown[]
    ) => [
      ...currentMessages,
      { role: 'assistant', content: `tool-round:${currentToolCalls.map((t) => t.name).join(',')}` },
      { role: 'tool', content: JSON.stringify(processedResults) },
    ],
    maxToolTurns: 3,
    estimateMessagesTokens: () => 0,
  } as unknown as ToolLoopContext;

  return { ctx, trace };
}

function makeInput(): ToolLoopInput {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
    needsInitialLlmCall: true,
  };
}

/** 跑旧类 ToolLoopRunner，返回轨迹 */
async function runLegacy(
  ctx: ToolLoopContext,
  trace: RunTrace
): Promise<{ chunks: unknown[]; final: string }> {
  const runner = new ToolLoopRunner(ctx, makeInput());
  const chunks: unknown[] = [];
  for await (const c of runner.run()) {
    chunks.push(c);
  }
  const final = runner.getFinalAssistantMessage();
  trace.finalContent = final?.content ?? '';
  return { chunks, final: trace.finalContent };
}

/** 跑新类 ReActToolLoop，返回轨迹 */
async function runModern(
  ctx: ToolLoopContext,
  trace: RunTrace
): Promise<{ events: unknown[]; final: string }> {
  const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
  const events: unknown[] = [];
  for await (const e of loop.run(makeInput())) {
    events.push(e);
  }
  const final = loop.getAssistantMessage();
  trace.finalContent = final?.content ?? '';
  return { events, final: trace.finalContent };
}

describe('M1b 双跑对比（ReActToolLoop vs ToolLoopRunner）', () => {
  it('语义一致性：LLM 调用次数与工具执行序列一致', async () => {
    const legacyTrace: RunTrace = { llmCalls: [], toolExecutions: [], finalContent: '' };
    const legacyCtx = makeDualCtx();
    const legacy = await runLegacy(legacyCtx.ctx, legacyTrace);

    const modernTrace: RunTrace = { llmCalls: [], toolExecutions: [], finalContent: '' };
    const modernCtx = makeDualCtx();
    const modern = await runModern(modernCtx.ctx, modernTrace);

    // 一致性报告（console 输出，供《双跑一致性报告》引用）
    console.log('[双跑报告] 旧类 LLM 调用次数:', legacyCtx.trace.llmCalls.length);
    console.log('[双跑报告] 新类 LLM 调用次数:', modernCtx.trace.llmCalls.length);
    console.log('[双跑报告] 旧类工具执行序列:', JSON.stringify(legacyCtx.trace.toolExecutions));
    console.log('[双跑报告] 新类工具执行序列:', JSON.stringify(modernCtx.trace.toolExecutions));
    console.log('[双跑报告] 旧类最终消息:', JSON.stringify(legacy.final));
    console.log('[双跑报告] 新类最终消息:', JSON.stringify(modern.final));
    console.log('[双跑报告] 旧类 chunk 数:', legacy.chunks.length, '新类事件数:', modern.events.length);

    // 核心语义断言（硬门槛）：工具执行序列 + LLM 调用次数一致
    expect(modernCtx.trace.toolExecutions).toEqual(legacyCtx.trace.toolExecutions);
    expect(modernCtx.trace.llmCalls.length).toBe(legacyCtx.trace.llmCalls.length);

    // 最终消息内容对比：如实断言（M1a 未维护 assistantMessage，预期可能不一致——见报告）
    // 此处不硬断言相等，仅记录差异（M1 细化的待补项）
    const finalMatch = modern.final === legacy.final;
    console.log('[双跑报告] 最终消息一致:', finalMatch);
    expect(finalMatch).toBe(true); // 作为 M1 细化验收——当前 M1a 若不一致，此断言揭示差距
  });
});
