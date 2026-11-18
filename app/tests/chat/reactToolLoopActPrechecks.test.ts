// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 特征化测试：`ReActToolLoop.act()` 的**本轮前置检查**（P3-2 外移前置，2026-11-17）
 *
 * 目的：在把 `act()` 的「循环检测预检 + PathGuard 按调用粒度跳过」两段原样外移到私有方法
 * **之前**，先用测试钉住当前行为：critical 卡死 ⇒ 本轮零执行；路径命中 ⇒ 只跳过该次调用、
 * 同批其余照常执行。外移后本文件必须**逐字不变、全绿**。
 *
 * 覆盖面界定（如实）：只覆盖 `act()` 的预检段；DecisionGate / 交互恢复 / 并发批次的既有
 * 行为由 `react-tool-loop-parallel.test.ts` / `awaitingApprovalStop.test.ts` 等既有测试兜底。
 */

import { describe, expect, it } from 'bun:test';

import type { ChatMessage, ChatResponse } from '@modules/ai';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ReActEvent } from '@modules/query/ReActLoop.js';

function makeCtx(
  overrides: Partial<ToolLoopContext>,
  llmResponse: () => ChatResponse
): ToolLoopContext {
  return {
    session: { id: 'sess-act-precheck' },
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
    checkpointService: { saveCheckpointWithData: async () => undefined },
    streamingCheckpoint: { onToolCompleted: async () => undefined },
    activeClient: {
      streamMessage: async function* (
        _messages: ChatMessage[],
        _options: Record<string, unknown>
      ): AsyncGenerator<string, ChatResponse> {
        yield 'ok';
        return llmResponse();
      },
      sendMessage: async () => llmResponse(),
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
}

function makeInput() {
  return {
    apiMessages: [{ role: 'user', content: 'hi' }],
    currentToolCalls: [],
    assistantMessage: null,
    nonStreaming: true,
  } as never;
}

async function collectEvents(
  loop: ReActToolLoop,
  stopAfter?: (e: ReActEvent) => boolean
): Promise<ReActEvent[]> {
  const events: ReActEvent[] = [];
  for await (const e of loop.run(makeInput())) {
    events.push(e);
    if (stopAfter?.(e)) break;
  }
  return events;
}

describe('ReActToolLoop.act() · 本轮前置检查（特征化）', () => {
  it('PathGuard 命中：只跳过该次调用，同批其余照常执行', async () => {
    const executed: string[] = [];
    let round = 0;
    const llmResponse = (): ChatResponse => {
      round++;
      if (round > 1) {
        return { content: 'done', stop_reason: 'stop' } as ChatResponse;
      }
      return {
        content: '',
        stop_reason: 'tool_calls',
        tool_calls: [
          { id: 'tc_env', name: 'file_read', arguments: { file_path: '.env' } },
          {
            id: 'tc_ok',
            name: 'file_read',
            arguments: { file_path: 'ok.txt' },
          },
        ],
      } as ChatResponse;
    };
    const ctx = makeCtx(
      {
        executeTool: async (tc: {
          name: string;
          arguments: Record<string, unknown>;
        }) => {
          executed.push(String(tc.arguments.file_path ?? ''));
          return { toolCallId: 'x', toolName: tc.name, result: 'ok' };
        },
      },
      llmResponse
    );
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });

    const events = await collectEvents(loop, (e) => e.type === 'iteration_end');

    // 只执行未被护栏命中的那一条
    expect(executed).toEqual(['ok.txt']);
    // 被跳过的那条以「失败结果」回填（PAIR-FILL），成功那条为 success
    const ended = events
      .filter((e) => e.type === 'tool_end')
      .map(
        (e) =>
          e as { callId?: string; result?: { status?: string; error?: string } }
      );
    expect(ended.map((e) => e.callId)).toEqual(['tc_env', 'tc_ok']);
    expect(ended[0].result?.status).toBe('error');
    expect(ended[0].result?.error).toContain('路径被安全护栏拦截');
    expect(ended[1].result?.status).toBe('success');
  });

  it('循环检测 critical：本轮零执行，且不产出工具事件', async () => {
    const executed: string[] = [];
    const ctx = makeCtx(
      {
        executeTool: async (tc: { name: string }) => {
          executed.push(tc.name);
          return { toolCallId: 'x', toolName: tc.name, result: 'ok' };
        },
        loopDetector: {
          detect: () => ({
            stuck: true,
            level: 'critical',
            detector: 'test-detector',
            message: '重复调用',
          }),
          recordToolCallOutcome: () => {},
          recordTurn: () => {},
        },
      },
      () =>
        ({
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            {
              id: 'tc1',
              name: 'file_read',
              arguments: { file_path: 'ok.txt' },
            },
          ],
        }) as ChatResponse
    );
    const loop = new ReActToolLoop(ctx, makeInput(), { maxIterations: 3 });

    const events = await collectEvents(loop, (e) => e.type === 'iteration_end');

    expect(executed).toEqual([]);
    // 未执行 ⇒ 不产出工具「结束」事件（起始事件由上层按 tool_calls 产生，不作为判据）
    expect(events.some((e) => e.type === 'tool_end')).toBe(false);
  });
});
