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
 * F2 回归（2026-10-12，任务 `budget-suspend-resume` Task 3）：TAOR 循环注册表接线 +「真再跑」。
 *
 * 修复前的缺陷（实证）：
 *  - `registerTAORLoop`（`infrastructure/http/handlers/checkpoint-handlers.ts:54`）**全仓零调用**
 *    ⇒ `activeLoops` 恒空 ⇒ `handleResumeCheckpoint` 恒 **404**（batch 手动恢复不可达）；
 *  - 即使可达，`TAORLoop.resumeFromCheckpoint` **只恢复内存状态、不触发执行**
 *    （既有唯一调用者 `bootstrap.resumePendingSessions` 也只 resume + `injectSteering`）
 *    ⇒ 故 `ChatManager.resumeSuspendedSession` 必须在 resume 后**触发既有执行入口**（真再跑）。
 *
 * 本文件锁定两件事：
 *  ① `_getOrCreateTAORLoop` 后注册表**含该 sessionId**（经既有 handler 行为断言，不新增查询面）；
 *  ② `resumeSuspendedSession(sid, 'taor')` 会 resume 并**恰好调用一次既有执行入口**
 *     （`ChatOrchestrator.sendMessage`，即 TAOR 委托路径；不新增执行路径）。
 */
import { describe, expect, it } from 'bun:test';
import type http from 'http';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import {
  handleListCheckpoints,
  handleResumeCheckpoint,
} from '../../src/infrastructure/http/handlers/checkpoint-handlers';
import type { TAORLoop } from '../../src/query/TAORLoop.js';
import { ChatOrchestrator } from '../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatOrchestratorHost } from '../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatSession } from '@modules/session/types/session.js';
import type { Message } from '@modules/session/types/message.js';
import type { ToolAwareClient } from '@modules/ai';

/** 私有成员访问（TS `private` 仅编译期约束；此处为回归内部语义所必需） */
type ChatManagerInternals = {
  _getOrCreateTAORLoop(sessionId: string): TAORLoop;
  markResumeIntent(sessionId: string): void;
  consumePendingResumeIntent(sessionId: string): boolean;
  chatOrchestrator: {
    sendMessage(content: string, options?: unknown): Promise<unknown>;
  };
};

const internals = (cm: ChatManagerImpl): ChatManagerInternals =>
  cm as unknown as ChatManagerInternals;

/** 最小 req：`handleListCheckpoints`/`handleResumeCheckpoint` 只读 `url`/`method` */
function makeReq(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

/** 最小 res：仅需 `writeHead`/`end`（`sendJson` 用） */
function makeRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    headersSent: false,
    writeHead: (code: number) => {
      out.status = code;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({
      status: out.status,
      body: out.body ? (JSON.parse(out.body) as Record<string, unknown>) : {},
    }),
  };
}

describe('TAOR 循环注册表接线（F2）', () => {
  it('_getOrCreateTAORLoop 后该 sessionId 进入注册表（handler 可取到该 loop 的端口）', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-wiring-1';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    // 桩端口两方法：断言 handler 取到的端口确为**本实例**的转发
    const sentinel = [{ id: 'cp-1' }];
    loop.getCheckpointsForSession = async () => sentinel as never;
    loop.resumeFromCheckpoint = async () => true;

    const { res, read } = makeRes();
    await handleListCheckpoints(
      makeReq(`/v1/sessions/${sid}/checkpoints`),
      res
    );

    expect(read()).toEqual({ status: 200, body: { checkpoints: sentinel } });
  });

  it('未注册会话仍 404（对照：F2 修复前"恒 404"的症状）', async () => {
    const { res, read } = makeRes();
    await handleResumeCheckpoint(
      makeReq('/v1/sessions/not-registered/checkpoints/cp-9/resume', 'POST'),
      res
    );

    expect(read().status).toBe(404);
  });
});

describe('resumeSuspendedSession「真再跑」（F2 / D7）', () => {
  it("chain='taor'：resumeFromCheckpoint 后调用一次既有执行入口", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-1';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    let resumeCalls = 0;
    loop.getCheckpointsForSession = async () => [{ id: 'cp-latest' }] as never;
    loop.resumeFromCheckpoint = async () => {
      resumeCalls += 1;
      return true;
    };

    let execCalls = 0;
    let execOptions: { sessionId?: string } | undefined;
    internals(cm).chatOrchestrator.sendMessage = async (_content, options) => {
      execCalls += 1;
      execOptions = options as { sessionId?: string };
      return {} as never;
    };

    const resumed = await cm.resumeSuspendedSession(sid, 'taor');

    expect(resumed).toBe(true);
    expect(resumeCalls).toBe(1);
    expect(execCalls).toBe(1);
    expect(execOptions?.sessionId).toBe(sid);
  });

  it("chain='taor'：无检查点（resume 失败）⇒ 不触发执行，返回 false", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-2';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => null;
    loop.resumeFromCheckpoint = async () => false;

    let execCalls = 0;
    internals(cm).chatOrchestrator.sendMessage = async () => {
      execCalls += 1;
      return {} as never;
    };

    const resumed = await cm.resumeSuspendedSession(sid, 'taor');

    expect(resumed).toBe(false);
    expect(execCalls).toBe(0);
  });

  it("chain='taor' 续跑前登记一次性意图（供委托路径跳过 reset）", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-intent-1';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => [{ id: 'cp-latest' }] as never;
    loop.resumeFromCheckpoint = async () => true;
    internals(cm).chatOrchestrator.sendMessage = async () => ({} as never);

    await cm.resumeSuspendedSession(sid, 'taor');

    // 意图在触发执行入口**之前**登记 ⇒ 委托路径可消费
    expect(internals(cm).consumePendingResumeIntent(sid)).toBe(true);
    // 一次性：再消费即 false
    expect(internals(cm).consumePendingResumeIntent(sid)).toBe(false);
  });
});

// ─── G-T3-1：TAOR 续跑状态不被委托路径的 reset() 抹除 ────────────────────────

/** 假 TAORLoop：reset() 会清游标/steering（复刻 `TAORLoop.reset` 的抹除语义） */
function makeFakeLoop(): {
  state: {
    turnCount: number;
    steeringQueue: number[];
    resetCalls: number;
    seedCalls: number;
    runCalls: number;
  };
  reset(): void;
  seedPendingToolCalls(): void;
  runCollect(): Promise<{
    turnCount: number;
    totalTokens: number;
    stopReason: string;
  }>;
} {
  const state = {
    turnCount: 5,
    steeringQueue: [1],
    resetCalls: 0,
    seedCalls: 0,
    runCalls: 0,
  };
  return {
    state,
    reset(): void {
      state.resetCalls += 1;
      state.turnCount = 0;
      state.steeringQueue = [];
    },
    seedPendingToolCalls(): void {
      state.seedCalls += 1;
    },
    async runCollect() {
      state.runCalls += 1;
      return {
        turnCount: state.turnCount,
        totalTokens: 0,
        stopReason: 'completed',
      };
    },
  };
}

/**
 * sendMessage 最小可用 host：走到 TAOR 委托路径（`tool_calls` + `shouldUseTAORLoop`），
 * 用于断言 reset 调用点的**条件化**行为。`consumeIntent` = host 的 `consumePendingResumeIntent` 返回。
 */
function createSendMessageHost(opts: {
  sessionId: string;
  loop: ReturnType<typeof makeFakeLoop>;
  consumeIntent: boolean;
}): ChatOrchestratorHost {
  const session = {
    id: opts.sessionId,
    messages: [],
    metadata: {},
    state: {},
  } as unknown as ChatSession;
  const client = {
    sendMessage: async () => ({
      content: '好的',
      stop_reason: 'tool_calls',
      tool_calls: [{ id: 'tc1', name: 'noop_tool', arguments: '{}' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    }),
    getProviderId: () => 'test-provider',
    streamMessage: async function* (): AsyncGenerator<string> {
      yield '';
    },
  } as unknown as ToolAwareClient;
  return {
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
        ({ id: 'a1', role: 'assistant', content: c, metadata: {} }) as unknown as Message,
    } as unknown as ChatOrchestratorHost['messageService'],
    sessionLifecycle: {
      getOrLoadSession: async () => session,
    } as unknown as ChatOrchestratorHost['sessionLifecycle'],
    hookChainManager: {
      execute: async () => ({ before: [], after: [] }),
    } as unknown as ChatOrchestratorHost['hookChainManager'],
    unifiedTracker: {} as ChatOrchestratorHost['unifiedTracker'],
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
    getToolRegistry: () => null,
    buildToolDefinitions: (schemas: unknown[]) => schemas as never,
    recordToolsSnapshot: () => {},
    addAndPersistMessage: () => {},
    appendStreamEvent: async () => ({ ok: true, tailSeq: 0 }),
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
    getOrCreateTAORLoop: () => opts.loop,
    buildTAORContext: () => ({}),
    executeTool: async () => ({ status: 'success', result: '' }),
    executeStepPrompt: async () => {},
    executePlanSteps: async () => {},
    triggerCouncilDebate: async () => {},
    sendMessageDowngradePath: async () => ({}) as Message,
    shouldTriggerCouncil: () => false,
    triggerCouncilDebateAsync: () => {},
    endTurnTelemetry: () => {},
    onTurnEnd: undefined,
    updateMessageBlocks: async () => {},
    consumePendingResumeIntent: () => opts.consumeIntent,
  } as unknown as ChatOrchestratorHost;
}

describe('G-T3-1：委托路径的 reset() 条件化（续跑不被抹除）', () => {
  it('① 设了续跑意图 ⇒ reset() 不被调用，恢复的游标/steering 存活到执行入口', async () => {
    const loop = makeFakeLoop();
    const host = createSendMessageHost({
      sessionId: 'g-1',
      loop,
      consumeIntent: true,
    });
    const orch = new ChatOrchestrator({ host });

    await orch.sendMessage('hi', { sessionId: 'g-1' });

    expect(loop.state.resetCalls).toBe(0); // reset 未被调用
    expect(loop.state.runCalls).toBe(1); // 执行入口确实跑了
    expect(loop.state.turnCount).toBe(5); // 恢复的游标存活
    expect(loop.state.steeringQueue).toEqual([1]); // 恢复的 steering 存活
  });

  it('② 未设意图 ⇒ reset() 照常调用（既有行为不变）', async () => {
    const loop = makeFakeLoop();
    const host = createSendMessageHost({
      sessionId: 'g-2',
      loop,
      consumeIntent: false,
    });
    const orch = new ChatOrchestrator({ host });

    await orch.sendMessage('hi', { sessionId: 'g-2' });

    expect(loop.state.resetCalls).toBe(1);
    expect(loop.state.turnCount).toBe(0); // 被 reset 清零
    expect(loop.state.steeringQueue).toEqual([]);
  });

  it('③ 意图是一次性的（连调两次：第一次 true、第二次 false）', () => {
    const cm = new ChatManagerImpl();
    internals(cm).markResumeIntent('g-one-shot');

    expect(internals(cm).consumePendingResumeIntent('g-one-shot')).toBe(true);
    expect(internals(cm).consumePendingResumeIntent('g-one-shot')).toBe(false);
  });
});
