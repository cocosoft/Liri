/**
 * M3-T3.1 — propose_plan 在 ReActToolLoop 中的计划模式闭环
 *
 * 验收（对齐 openworker plan_approver）：
 *   ① AI 调 propose_plan → question 卡挂起（assistant/question 事件落盘，含计划内容）
 *   ② 用户批准（resolve(['批准'])）→ 工具返回 approved → AI 继续执行
 *   ③ 计划内容进 events.jsonl（appendStreamEvent 捕获含计划文本）
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';
import { ProposePlanTool } from '../../src/tools/ProposePlanTool/ProposePlanTool.js';
import type { ToolUseContext } from '../../src/tools/types/ToolUseContext.js';

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
      createToolResultMessage: (result: unknown) => ({
        id: 'tool-msg',
        content: String(result),
      }),
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
      streamMessage: async function* () {
        yield 'ok';
        return { content: '', stop_reason: 'stop' } as ChatResponse;
      },
      sendMessage: async () =>
        ({ content: '', stop_reason: 'stop' }) as ChatResponse,
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

describe('propose_plan 计划模式闭环（M3-T3.1）', () => {
  it('① 提交计划 → question 卡（计划内容落盘）→ 批准 → 工具返回 approved 继续执行', async () => {
    const planText = '计划：\n1. 扫描 downloads 目录\n2. 删除 30 天前的临时文件';
    const streamedEvents: Array<{ type: string; data?: Record<string, unknown> }> = [];
    let round = 0;
    const llmResponse = (): ChatResponse => {
      round++;
      if (round === 1) {
        return {
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            {
              id: 'p1',
              name: 'propose_plan',
              arguments: { header: '批量删除计划', question: planText },
            },
          ],
        } as ChatResponse;
      }
      return { content: 'done', stop_reason: 'stop' } as ChatResponse;
    };

    const planTool = new ProposePlanTool();
    let approvedSeen = false;
    const ctx = makeCtx({
      toolRegistry: {
        getTool: (name: string) =>
          name === 'propose_plan'
            ? { requiresUserInteraction: () => true }
            : undefined,
      },
      executeTool: async (tc: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }) => {
        const res = await planTool.execute(
          tc.arguments,
          { sessionId: 'sess-test' } as unknown as ToolUseContext
        );
        if (String(res.data).includes('"approved"')) approvedSeen = true;
        return {
          toolCallId: tc.id,
          toolName: tc.name,
          result: res.data,
          error: (res.data as { error?: string })?.error,
        };
      },
      appendStreamEvent: async (
        _sid: string,
        ev: { type: string; data?: unknown }
      ) => {
        streamedEvents.push(ev as { type: string; data?: Record<string, unknown> });
      },
      getStreamTailSeq: async () => 0,
      activeClient: {
        streamMessage: async function* () {
          yield 'ok';
          return llmResponse() as ChatResponse;
        },
        sendMessage: async () => llmResponse() as ChatResponse,
        getProviderId: () => 'mock',
      },
    });

    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });
    const questionSeen: string[] = [];
    for await (const e of loop.run(makeInput())) {
      if (e.type === 'question') {
        questionSeen.push(String((e as { questionData?: { question?: string } }).questionData?.question));
        // 模拟用户批准（在聊天卡上点击"批准"→ resolveInteraction）
        ctx.pendingInteractions.get('sess-test')?.resolve(['批准']);
      }
    }

    // ① question 卡产出（含计划内容）
    expect(questionSeen.length).toBe(1);
    expect(questionSeen[0]).toContain('删除 30 天前的临时文件');

    // ② 计划内容经 assistant/question 事件落盘（events.jsonl 可回放）
    const questionEvent = streamedEvents.find((e) => e.type === 'assistant/question');
    expect(questionEvent).toBeTruthy();
    expect(String(questionEvent?.data?.question)).toContain('删除 30 天前的临时文件');

    // ③ 批准后工具返回 approved，AI 进入第二轮（继续执行）
    expect(approvedSeen).toBe(true);
    expect(round).toBe(2);
  });
});
