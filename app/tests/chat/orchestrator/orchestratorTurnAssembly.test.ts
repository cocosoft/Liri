// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * sendMessage 回合装配的特征化测试（T3 复杂度清理前置，2026-11-17）
 *
 * 目的：在 `sendMessage` 的 `mutex.run` 回调做**纯搬运式外移**（圈复杂度 79 → 阈值内）
 * 之前，用三条既有行为把待搬块钉住：
 *  ① 工具清单装配 —— `chatMode='creative'`（`no-shell`）过滤后的清单才进
 *     `buildToolDefinitions` / `recordToolsSnapshot`；
 *  ② 无工具回合终稿护栏 —— mermaid 整改后正文**同时**写回返回值与持久层；
 *  ③ 含 `tool_calls` —— 委托 TAOR **恰好一次**（种子调用按 JSON 解析），返回会话末条 assistant。
 *
 * 断言只依赖公开返回值与注入端口 ⇒ 外移前后必须同样通过（行为等价的可证伪依据）。
 */
import { describe, expect, it } from 'bun:test';

import { ChatOrchestrator } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { Message } from '@modules/session/types/message.js';
import type { ToolAwareClient } from '@modules/ai';

// ─── 假 TAOR 循环 ────────────────────────────────────────

interface SeededCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface FakeLoop {
  state: {
    resetCalls: number;
    runCalls: number;
    seeded: SeededCall[][];
  };
  reset(): void;
  seedPendingToolCalls(calls: SeededCall[]): void;
  abort(): Promise<void>;
  runCollect(input: unknown): Promise<{
    turnCount: number;
    totalTokens: number;
    stopReason: string;
  }>;
}

/** 假循环：runCollect 时按 TAOR 的"已持久化消息"语义往会话追加一条 assistant */
function makeFakeLoop(session: ChatSession): FakeLoop {
  const state = { resetCalls: 0, runCalls: 0, seeded: [] as SeededCall[][] };
  return {
    state,
    reset(): void {
      state.resetCalls += 1;
    },
    seedPendingToolCalls(calls: SeededCall[]): void {
      state.seeded.push(calls);
    },
    async abort(): Promise<void> {},
    async runCollect() {
      state.runCalls += 1;
      session.messages.push({
        id: 'a-taor',
        role: 'assistant',
        content: '工具跑完',
        metadata: {},
      } as unknown as Message);
      return { turnCount: 1, totalTokens: 2, stopReason: 'completed' };
    },
  };
}

// ─── 最小可用 host ───────────────────────────────────────

interface HostOptions {
  session: ChatSession;
  /** 第 N 次 `client.sendMessage` 的响应（默认无 tool_calls 的纯文本） */
  respond?: (callIndex: number) => Record<string, unknown>;
  /** 工具注册表返回的 schema（null ⇒ 无注册表） */
  toolSchemas?: Array<{ name: string }> | null;
  loop?: FakeLoop;
}

interface Captured {
  buildToolDefinitions: unknown[][];
  recordToolsSnapshot: unknown[][];
  updateMessageBlocks: Array<{ messageId: string; text?: string }>;
  appendStreamEvent: Array<{ type?: string }>;
}

function createHost(opts: HostOptions): {
  host: ChatOrchestratorHost;
  captured: Captured;
} {
  const { session } = opts;
  const captured: Captured = {
    buildToolDefinitions: [],
    recordToolsSnapshot: [],
    updateMessageBlocks: [],
    appendStreamEvent: [],
  };
  let callIndex = 0;
  const client = {
    sendMessage: async () => {
      const i = callIndex++;
      return (opts.respond?.(i) ?? {
        content: '好的',
        stop_reason: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'test-model',
      }) as never;
    },
    streamMessage: async function* (): AsyncGenerator<string> {
      yield '';
    },
    getProviderId: () => 'test-provider',
    getBaseUrl: () => 'http://localhost:test',
  } as unknown as ToolAwareClient;

  const host = {
    chatSessions: new Map([[session.id, session]]),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map(),
    currentSessionIdRef: { get: () => session.id },
    pendingInteractions: new Map(),
    toolRoundCount: 0,
    incrementToolRoundCount: () => {},
    executingPlan: false,
    withExecutingPlan: async <T>(_f: boolean, fn: () => Promise<T>) => fn(),
    ENABLE_TELEMETRY: false,
    ENABLE_PLAN_DRIVEN_LOOP: true,
    MAX_TOOL_TURNS: 30,
    messageService: {
      createUserMessage: (c: string) =>
        ({ id: 'u1', role: 'user', content: c }) as unknown as Message,
      createAssistantMessage: (c: string) =>
        ({
          id: 'a1',
          role: 'assistant',
          content: c,
          metadata: {},
        }) as unknown as Message,
      createToolResultMessage: () => ({}) as Message,
    } as unknown as ChatOrchestratorHost['messageService'],
    sessionLifecycle: {
      getOrLoadSession: async () => session,
    } as unknown as ChatOrchestratorHost['sessionLifecycle'],
    hookChainManager: {
      execute: async () => ({ before: [], after: [] }),
    } as unknown as ChatOrchestratorHost['hookChainManager'],
    unifiedTracker: {
      checkBeforeRequest: async () => ({
        decision: 'skip',
        snapshot: { tokens: 8, maxTokens: 200000, ratio: 0 },
      }),
    } as unknown as ChatOrchestratorHost['unifiedTracker'],
    imageContextService: {
      confirmedPaths: [],
      registerImagePaths: () => {},
    } as unknown as ChatOrchestratorHost['imageContextService'],
    checkpointService: {} as ChatOrchestratorHost['checkpointService'],
    memoryManager: null,
    summarizer: null,
    pdcaLauncher: null,
    loopDetector: {} as ChatOrchestratorHost['loopDetector'],
    getLLMClient: () => client,
    getClientForModel: () => client,
    getToolRegistry: () =>
      opts.toolSchemas === null || opts.toolSchemas === undefined
        ? null
        : {
            getToolSchemas: () => opts.toolSchemas,
          },
    buildToolDefinitions: (schemas: unknown[]) => {
      captured.buildToolDefinitions.push(schemas);
      return schemas as never;
    },
    recordToolsSnapshot: (_sid: string, schemas: unknown[]) => {
      captured.recordToolsSnapshot.push(schemas);
    },
    addAndPersistMessage: () => {},
    appendStreamEvent: async (_sid: string, ev: { type?: string }) => {
      captured.appendStreamEvent.push(ev);
      return { ok: true, tailSeq: 0 };
    },
    getStreamTailSeq: async () => 0,
    getStreamMaxTurn: async () => 0,
    getSessionMachine: () => ({ start: () => {}, finish: () => {} }),
    getOrAssembleSystemPrompt: async () => 'system prompt',
    extractFilePathsFromText: () => [],
    extractMemoryFromChat: async () => {},
    recordChatResponseUsage: () => {},
    sanitizeApiMessages: () => {},
    truncateApiMessages: async () => {},
    persistTurnSummary: () => {},
    flushPendingPersists: async () => {},
    shouldUseTAORLoop: () => true,
    getOrCreateTAORLoop: () => opts.loop ?? makeFakeLoop(session),
    buildTAORContext: () => ({}),
    consumePendingResumeIntent: () => false,
    executeTool: async () => ({ status: 'success', result: '' }),
    executeStepPrompt: async () => {},
    executePlanSteps: async () => {},
    triggerCouncilDebate: async () => {},
    sendMessageDowngradePath: async () => ({}) as Message,
    shouldTriggerCouncil: () => false,
    triggerCouncilDebateAsync: () => {},
    endTurnTelemetry: () => {},
    onTurnEnd: undefined,
    updateMessageBlocks: async (
      _sid: string,
      messageId: string,
      _blocks: unknown[],
      text?: string
    ) => {
      captured.updateMessageBlocks.push({ messageId, text });
    },
    applyVerifyRecipeForTurn: () => {},
  } as unknown as ChatOrchestratorHost;

  return { host, captured };
}

function createSession(metadata: Record<string, unknown> = {}): ChatSession {
  return {
    id: 'sess-send',
    messages: [],
    metadata,
    state: {},
  } as unknown as ChatSession;
}

// ─── 特征化断言 ──────────────────────────────────────────

describe('sendMessage 回合装配（特征化）', () => {
  it('① creative 模式：过滤后的工具清单才装配 / 落盘', async () => {
    const session = createSession({ chatMode: 'creative' });
    const { host, captured } = createHost({
      session,
      toolSchemas: [{ name: 'code_run' }, { name: 'read_file' }],
    });

    const result = await new ChatOrchestrator({ host }).sendMessage('画个图', {
      sessionId: session.id,
      model: 'test-model',
    });

    expect(result.content).toBe('好的');
    // no-shell：执行类工具（code_run）被滤掉，其余保留
    expect(captured.buildToolDefinitions).toEqual([[{ name: 'read_file' }]]);
    expect(captured.recordToolsSnapshot).toEqual([[{ name: 'read_file' }]]);
  });

  it('② 无工具回合：终稿护栏修复后正文同时写回返回值与持久层', async () => {
    const session = createSession();
    const invalid = '这是图：\n```mermaid\nnotadiagram\n```';
    const loop = makeFakeLoop(session);
    const { host, captured } = createHost({
      session,
      loop,
      respond: (i) =>
        i === 0
          ? {
              content: invalid,
              stop_reason: 'stop',
              usage: { prompt_tokens: 1, completion_tokens: 1 },
              model: 'test-model',
            }
          : {
              content: '已修复的正文',
              stop_reason: 'stop',
              usage: { prompt_tokens: 1, completion_tokens: 1 },
              model: 'test-model',
            },
    });
    const result = await new ChatOrchestrator({ host }).sendMessage('画个图', {
      sessionId: session.id,
      model: 'test-model',
    });

    // 修复产出替换返回值 + 持久层（同一文本，两处同源）
    expect(result.content).toBe('已修复的正文');
    expect(captured.updateMessageBlocks).toHaveLength(1);
    expect(captured.updateMessageBlocks[0].text).toBe('已修复的正文');
    // §1.6：先落 validation/injected 再注入修复
    expect(
      captured.appendStreamEvent.some((e) => e.type === 'validation/injected')
    ).toBe(true);
    // 无 tool_calls ⇒ 不进 TAOR
    expect(loop.state.runCalls).toBe(0);
  });

  it('③ 含 tool_calls：委托 TAOR 一次并返回会话末条 assistant', async () => {
    const session = createSession();
    const loop = makeFakeLoop(session);
    const { host } = createHost({
      session,
      loop,
      respond: () => ({
        content: '',
        stop_reason: 'tool_calls',
        tool_calls: [{ id: 'tc1', name: 'noop_tool', arguments: '{"a":1}' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'test-model',
      }),
    });

    const result = await new ChatOrchestrator({ host }).sendMessage(
      '跑个工具',
      {
        sessionId: session.id,
        model: 'test-model',
      }
    );

    expect(loop.state.resetCalls).toBe(1);
    expect(loop.state.runCalls).toBe(1);
    // N-42：首轮工具调用按 JSON 解析后作为种子 ACT
    expect(loop.state.seeded).toEqual([
      [{ id: 'tc1', name: 'noop_tool', input: { a: 1 } }],
    ]);
    // TAOR 已持久化的末条 assistant 即返回值
    expect(result.id).toBe('a-taor');
    expect(result.content).toBe('工具跑完');
  });
});
