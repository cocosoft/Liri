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
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';

import { ChatManagerImpl } from '../../src/chat/ChatManager.js';
import {
  getBudgetSuspendCoordinator,
  resetBudgetSuspendForTest,
} from '../../src/query/budgetSuspend.js';
import {
  handleListCheckpoints,
  handleResumeCheckpoint,
  registerTAORLoop,
  MAX_TAOR_LOOP_REGISTRY,
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

/** Fix round 2：覆写无关的 yield 恢复器装配（隔离，避免测试触真实库） */
type YieldInstallInternals = {
  _ensureYieldResumerInstalled: () => void;
};

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
    internals(cm).chatOrchestrator.sendMessage = async () => ({}) as never;

    await cm.resumeSuspendedSession(sid, 'taor');

    // 意图在触发执行入口**之前**登记 ⇒ 委托路径可消费
    expect(internals(cm).consumePendingResumeIntent(sid)).toBe(true);
    // 一次性：再消费即 false
    expect(internals(cm).consumePendingResumeIntent(sid)).toBe(false);
  });

  it("I4：chain='taor' 的续跑 steering 消费 pendingToolCalls 清单", async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-i4';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () =>
      [
        {
          id: 'cp-i4',
          pendingToolCalls: [
            { toolCallId: 'tc-1', toolName: 'bash', args: { command: 'ls' } },
            { toolCallId: 'tc-2', toolName: 'grep', args: { pattern: 'todo' } },
          ],
        },
      ] as never;
    loop.resumeFromCheckpoint = async () => true;
    let steeringText = '';
    loop.injectSteering = ((text: string) => {
      steeringText = text;
    }) as never;
    internals(cm).chatOrchestrator.sendMessage = async () => ({}) as never;

    await cm.resumeSuspendedSession(sid, 'taor');

    expect(steeringText).toContain('bash');
    expect(steeringText).toContain('grep');
  });

  it('I4：无 pendingToolCalls ⇒ 续跑 steering 退化为通用提示（不报错）', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'taor-resume-i4-empty';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => [{ id: 'cp-latest' }] as never;
    loop.resumeFromCheckpoint = async () => true;
    let steeringText = '';
    loop.injectSteering = ((text: string) => {
      steeringText = text;
    }) as never;
    internals(cm).chatOrchestrator.sendMessage = async () => ({}) as never;

    await cm.resumeSuspendedSession(sid, 'taor');

    expect(steeringText).toContain('预算挂起点恢复');
    expect(steeringText).not.toContain('尚未完成');
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
  /** 固定布尔，或按 sessionId 求值（Important-1 回归把消费委托给真实 ChatManager） */
  consumeIntent: boolean | ((sessionId: string) => boolean);
  /** 可覆盖的 LLM 响应（默认含 tool_calls；Important-1 回归用「无 tool_calls」轮） */
  clientResponse?: () => Record<string, unknown>;
}): ChatOrchestratorHost {
  const session = {
    id: opts.sessionId,
    messages: [],
    metadata: {},
    state: {},
  } as unknown as ChatSession;
  const client = {
    sendMessage: async () =>
      opts.clientResponse?.() ?? {
        content: '好的',
        stop_reason: 'tool_calls',
        tool_calls: [{ id: 'tc1', name: 'noop_tool', arguments: '{}' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: 'test-model',
      },
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
        ({
          id: 'a1',
          role: 'assistant',
          content: c,
          metadata: {},
        }) as unknown as Message,
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
    consumePendingResumeIntent: (sid: string) =>
      typeof opts.consumeIntent === 'function'
        ? opts.consumeIntent(sid)
        : opts.consumeIntent,
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

// ─── Fix round 2 · Important-1：续跑意图生命周期收敛为「紧接着那一次执行」─────────
//
// 缺陷：`resumeSuspendedSession`（taor）在触发执行入口**前**登记意图，而消费点在
// `ChatOrchestrator` 的 TAOR 分支**内部**（`tool_calls` + `shouldUseTAORLoop` 两层）。
// 若续跑轮未进入该分支（响应无 `tool_calls`），意图**永不清除** ⇒ 此后任意一次普通含工具
// 轮次都会命中并 `return true` ⇒ 误跳过 `taorLoop.reset()`，把上一次循环残留的游标/steering
// 带进全新一轮。修复：`ChatManager.sendMessage` 入口无条件清空该会话的残留意图。

describe('Fix round 2 · Important-1：残留续跑意图不泄漏到下一次普通轮', () => {
  it('续跑轮未进入 TAOR reset 分支 ⇒ 下一次普通含 tool_calls 的轮照常 reset()', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'leak-regression';
    const loop = makeFakeLoop();

    // 可控响应：续跑轮 → 无 tool_calls（不进 TAOR 分支）；随后的普通轮 → 含 tool_calls
    let response: Record<string, unknown> = {
      content: '续跑完成（无工具）',
      stop_reason: 'stop',
    };
    const host = createSendMessageHost({
      sessionId: sid,
      loop,
      // 消费委托给**真实 ChatManager** ⇒ 与生产同一来源、同一份意图
      consumeIntent: (s) => cm.consumePendingResumeIntent(s),
      clientResponse: () => response,
    });
    const orch = new ChatOrchestrator({ host });
    // `ChatManager.sendMessage` 委托到本 orchestrator（模拟同一实例的委托路径）
    internals(cm).chatOrchestrator.sendMessage = (c, o) =>
      orch.sendMessage(c as string, o as never);
    // 隔离无关的 yield 装配（避免触真实库）
    (cm as unknown as YieldInstallInternals)._ensureYieldResumerInstalled =
      () => {};

    // 续跑轮：登记意图后**绕过 ChatManager 入口**直接委托（与 resumeSuspendedSession 同法）
    cm.markResumeIntent(sid);
    await orch.sendMessage('resume', { sessionId: sid });

    // 响应无 tool_calls ⇒ 未进入 reset 分支、意图**未被消费**（缺陷现场）
    expect(loop.state.resetCalls).toBe(0);
    expect(cm.consumePendingResumeIntent(sid)).toBe(true); // 意图确已滞留
    cm.markResumeIntent(sid); // 复原滞留态（上一步探测已消费）

    // 下一次普通含 tool_calls 的轮：必经 ChatManager 入口 ⇒ 清残留意图 + 照常 reset()
    response = {
      content: '普通轮',
      stop_reason: 'tool_calls',
      tool_calls: [{ id: 'tc9', name: 'noop_tool', arguments: '{}' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'test-model',
    };
    await cm.sendMessage('normal', { sessionId: sid });

    // 修复前：残留意图被误命中 ⇒ reset 恒被跳过（0）；修复后：照常 reset（1）
    expect(loop.state.resetCalls).toBe(1);
  });
});

// ─── Fix round 2 · Important-2：唤醒端口惰性装配（至多一次 · 丢弃实例不劫持）──────
//
// 缺陷：`_installBudgetSuspendResume()` 原在**构造器末尾**调用，而 `createChatManager()`
// 每次 `new ChatManagerImpl()`（命令处理器常见，且从不 `cleanup()`）⇒ 向**进程级单例**
// 注册永不解绑的 listener，并以**单槽覆盖**劫持 `setResumeHandler`（唤醒回调指向无会话
// 状态的实例）。修复：改为**惰性装配**（入口 `sendMessage` / `streamMessage`），丢弃实例
// 从不装配 ⇒ 不累积、不劫持；`cleanup()` 仅摘除自有装配。

describe('Fix round 2 · Important-2：唤醒端口惰性装配', () => {
  const FLAG = 'FEATURE_BUDGET_SUSPEND_RESUME';
  let prevFlag: string | undefined;

  beforeEach(() => {
    resetBudgetSuspendForTest();
    prevFlag = process.env[FLAG];
    process.env[FLAG] = 'true';
  });
  afterEach(() => {
    if (prevFlag === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prevFlag;
    resetBudgetSuspendForTest();
  });

  it('构造丢弃实例不装配；live 经真实入口装配一次且 handler 指向 live；cleanup 解绑', async () => {
    const coordinator = getBudgetSuspendCoordinator();
    const handlerCalls: Array<((...a: never[]) => unknown) | null> = [];
    const original = coordinator.setResumeHandler.bind(coordinator);
    coordinator.setResumeHandler = (h) => {
      handlerCalls.push(h as unknown as (...a: never[]) => unknown);
      original(h);
    };

    // 丢弃实例（命令处理器典型路径：构造后从不 cleanup）
    new ChatManagerImpl();
    new ChatManagerImpl();
    expect(handlerCalls.length).toBe(0); // 修复前：每次构造即装配并覆盖 handler

    // live 实例：经**真实入口**（sendMessage）触发惰性装配
    const live = new ChatManagerImpl();
    (live as unknown as YieldInstallInternals)._ensureYieldResumerInstalled =
      () => {};
    internals(live).chatOrchestrator.sendMessage = async () => ({}) as never;

    await live.sendMessage('hi', { sessionId: 'live-1' });
    expect(handlerCalls.length).toBe(1);
    await live.sendMessage('hi-2', { sessionId: 'live-1' });
    expect(handlerCalls.length).toBe(1); // 幂等：至多装一次

    // 再构造丢弃实例 ⇒ 仍不装配、不覆盖
    new ChatManagerImpl();
    expect(handlerCalls.length).toBe(1);

    // handler 指向**具备会话状态**的 live：调用它 ⇒ 命中 live.resumeSuspendedSession
    const spy = spyOn(live, 'resumeSuspendedSession').mockResolvedValue(true);
    await (
      handlerCalls[0] as unknown as (
        sid: string,
        chain: string
      ) => Promise<boolean>
    )('s-any', 'taor');
    expect(spy).toHaveBeenCalledTimes(1);

    // cleanup 解绑：仅装配者摘除 ⇒ handler 置 null
    live.cleanup();
    expect(handlerCalls[handlerCalls.length - 1]).toBeNull();
  });
});

// ─── I1（最终整支评审）：进程级注册表无界增长 ⇒ 有界化 + 会话拆除/cleanup 注销 ──────
//
// 缺陷：`registerTAORLoop` 对每个 sessionId 注册一次，而 `unregisterTAORLoop` **全仓零调用**
// ⇒ 进程级 `activeLoops` 无界增长（内存泄漏 + 僵尸 TAORLoop），且**不受开关门控**（默认路径）。
// 修复：① 会话拆除 / clearAllSessions / `cleanup()` 注销；② 注册表设上限，超出按最旧淘汰。

/** 以 handler 行为探测某 sessionId 是否仍在注册表（未注册 ⇒ `{checkpoints: []}`） */
async function registryCheckpoints(
  sessionId: string
): Promise<Record<string, unknown>> {
  const { res, read } = makeRes();
  await handleListCheckpoints(
    makeReq(`/v1/sessions/${sessionId}/checkpoints`),
    res
  );
  return read().body;
}

describe('I1：TAOR 循环注册表有界 + 会话拆除注销', () => {
  it('① 会话拆除（deleteSession）后注册表不再含该 sessionId', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'i1-teardown';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => [{ id: 'cp-1' }] as never;

    expect(await registryCheckpoints(sid)).toEqual({
      checkpoints: [{ id: 'cp-1' }],
    });

    // 拆除锚点：`ChatManager.deleteSession`（既有会话拆除入口）。真实实现可能因无落盘
    // 会话而抛错 ⇒ 注销必须是**拆除入口的第一步**，与拆除结果解耦。
    await cm.deleteSession(sid).catch(() => {});

    expect(await registryCheckpoints(sid)).toEqual({ checkpoints: [] });
  });

  it('② cleanup() 注销全部已注册会话', async () => {
    const cm = new ChatManagerImpl();
    const sid = 'i1-cleanup';
    const loop = internals(cm)._getOrCreateTAORLoop(sid);
    loop.getCheckpointsForSession = async () => [{ id: 'cp-2' }] as never;
    expect(await registryCheckpoints(sid)).toEqual({
      checkpoints: [{ id: 'cp-2' }],
    });

    cm.cleanup();

    expect(await registryCheckpoints(sid)).toEqual({ checkpoints: [] });
  });

  it('③ 超上限 ⇒ 最旧条目被淘汰（表大小 ≤ 上限）', async () => {
    const N = MAX_TAOR_LOOP_REGISTRY + 10;
    const sentinel = [{ id: 'cp-cap' }];
    const port = {
      getCheckpointsForSession: async () => sentinel,
      resumeFromCheckpoint: async () => true,
    } as never;
    for (let i = 0; i < N; i++) registerTAORLoop(`i1-cap-${i}`, port);

    // 最旧者被淘汰；最新的 N - MAX 个保留（含最后一个）；边界处证明大小恰为上限
    expect(await registryCheckpoints('i1-cap-0')).toEqual({ checkpoints: [] });
    expect(await registryCheckpoints('i1-cap-9')).toEqual({ checkpoints: [] });
    expect(await registryCheckpoints('i1-cap-10')).toEqual({
      checkpoints: sentinel,
    });
    expect(await registryCheckpoints(`i1-cap-${N - 1}`)).toEqual({
      checkpoints: sentinel,
    });
  });
});
