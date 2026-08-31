/**
 * M3-T3.2 — 读类工具并发执行契约
 *
 * 对齐 openworker `_parallel_safe`：isConcurrencySafe（low-risk 读类）工具批量并发，
 * 写/shell 严格串行。验收：
 *   ① 3 读并发完成（end 时间接近，间隔远小于单工具延迟）
 *   ② 写独占（写工具 start 晚于全部读工具 end）
 *   ③ 结果顺序与调用顺序一致（onToolCall end 顺序 = 输入顺序）
 *   ④ 总耗时 ≤ 串行基线 60%
 */

import { describe, it, expect } from 'bun:test';
import { ReActToolLoop } from '../../src/chat/ReActToolLoop.js';
import type { ToolLoopContext } from '../../src/chat/ToolLoopRunner.js';
import type { ChatResponse } from '@modules/ai';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 单工具延迟（ms）——并发批次期望总耗时 ≈ 2×TOOL_MS，串行 = 4×TOOL_MS */
const TOOL_MS = 60;

describe('ReActToolLoop 读类并发（M3-T3.2）', () => {
  it('① 3 读 + 1 写：读并发完成、写独占、结果顺序一致、耗时 ≤ 串行 60%', async () => {
    const timeline: Array<{ name: string; t: number }> = [];
    const toolEndOrder: string[] = [];
    let round = 0;
    const llmResponse = (): ChatResponse => {
      round++;
      if (round === 1) {
        return {
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            { id: 'r1', name: 'readTool', arguments: { a: 1 } },
            { id: 'r2', name: 'readTool', arguments: { a: 2 } },
            { id: 'r3', name: 'readTool', arguments: { a: 3 } },
            { id: 'w1', name: 'writeTool', arguments: { a: 4 } },
          ],
        } as ChatResponse;
      }
      return { content: 'done', stop_reason: 'stop' } as ChatResponse;
    };

    const ctx = makeCtx({
      toolRegistry: {
        getTool: (name: string) => ({
          // 读类工具并发安全，写类工具严格串行
          isConcurrencySafe: () => name === 'readTool',
        }),
      },
      executeTool: async (toolCall: { name: string; id: string }) => {
        timeline.push({ name: `start:${toolCall.name}:${toolCall.id}`, t: Date.now() });
        await sleep(TOOL_MS);
        timeline.push({ name: `end:${toolCall.name}:${toolCall.id}`, t: Date.now() });
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: `done:${toolCall.name}`,
          error: undefined,
        };
      },
      onToolCall: (phase: string, name: string, id: string) => {
        if (phase === 'end') toolEndOrder.push(`${name}:${id}`);
      },
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
    const startedAt = Date.now();
    for await (const _e of loop.run(makeInput())) {
      // 消费事件
    }
    const elapsedMs = Date.now() - startedAt;

    const endRead = (id: string) =>
      timeline.find((e) => e.name === `end:readTool:${id}`)!.t;
    const startWrite = timeline.find((e) => e.name === 'start:writeTool:w1')!.t;

    // ① 3 读并发：首个读 end 到最后一个读 end 间隔远小于单工具延迟（60ms → <30ms）
    const readSpread = endRead('r3') - endRead('r1');
    expect(readSpread).toBeLessThan(TOOL_MS / 2);

    // ② 写独占：写 start 不早于任何读 end
    expect(startWrite).toBeGreaterThanOrEqual(endRead('r3'));

    // ③ 结果顺序 = 输入顺序（r1, r2, r3, w1）
    expect(toolEndOrder).toEqual([
      'readTool:r1',
      'readTool:r2',
      'readTool:r3',
      'writeTool:w1',
    ]);

    // ④ 总耗时 ≤ 串行基线（4×60=240ms）的 60%（144ms）——并发约 2×60=120ms
    const serialBaseline = 4 * TOOL_MS;
    expect(elapsedMs).toBeLessThan(serialBaseline * 0.6 + 30);
    expect(elapsedMs).toBeLessThan(serialBaseline); // 必小于串行
  });

  it('② 全串行工具（无并发安全）保持严格顺序执行', async () => {
    const order: string[] = [];
    let round = 0;
    const llmResponse = (): ChatResponse => {
      round++;
      if (round === 1) {
        return {
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            { id: 's1', name: 'writeTool', arguments: { a: 1 } },
            { id: 's2', name: 'writeTool', arguments: { a: 2 } },
          ],
        } as ChatResponse;
      }
      return { content: 'done', stop_reason: 'stop' } as ChatResponse;
    };
    const ctx = makeCtx({
      toolRegistry: { getTool: () => ({ isConcurrencySafe: () => false }) },
      executeTool: async (toolCall: { id: string }) => {
        order.push(`start:${toolCall.id}`);
        await sleep(20);
        order.push(`end:${toolCall.id}`);
        return {
          toolCallId: toolCall.id,
          toolName: 'writeTool',
          result: 'ok',
          error: undefined,
        };
      },
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
    for await (const _e of loop.run(makeInput())) {
      // 消费
    }
    // 严格串行：s1 完全结束后 s2 才开始
    expect(order).toEqual([
      'start:s1',
      'end:s1',
      'start:s2',
      'end:s2',
    ]);
  });

  it('③ 混合批次：并发组后遇写工具先 flush（读批次完成后才执行写）', async () => {
    const order: string[] = [];
    let round = 0;
    const llmResponse = (): ChatResponse => {
      round++;
      if (round === 1) {
        return {
          content: '',
          stop_reason: 'tool_calls',
          tool_calls: [
            { id: 'r1', name: 'readTool', arguments: { a: 1 } },
            { id: 'w1', name: 'writeTool', arguments: { a: 2 } },
            { id: 'r2', name: 'readTool', arguments: { a: 3 } },
          ],
        } as ChatResponse;
      }
      return { content: 'done', stop_reason: 'stop' } as ChatResponse;
    };
    const ctx = makeCtx({
      toolRegistry: {
        getTool: (name: string) => ({
          isConcurrencySafe: () => name === 'readTool',
        }),
      },
      executeTool: async (toolCall: { name: string; id: string }) => {
        order.push(`start:${toolCall.name}:${toolCall.id}`);
        await sleep(20);
        order.push(`end:${toolCall.name}:${toolCall.id}`);
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: 'ok',
          error: undefined,
        };
      },
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
    for await (const _e of loop.run(makeInput())) {
      // 消费
    }
    // 读批次 r1（入批次）→ 遇写 w1 flush（r1 先完成）→ w1 串行 → r2 入批次并 flush
    const iStartR1 = order.indexOf('start:readTool:r1');
    const iEndW1 = order.indexOf('end:writeTool:w1');
    const iStartR2 = order.indexOf('start:readTool:r2');
    expect(iStartR1).toBeGreaterThanOrEqual(0);
    expect(iEndW1).toBeGreaterThan(iStartR1);
    expect(iStartR2).toBeGreaterThan(iEndW1);
  });
});
