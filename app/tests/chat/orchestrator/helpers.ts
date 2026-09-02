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
 * streamMessageFlow 测试基建（T1.1 阶段 1，2026-09-01）
 *
 * 为 runStreamMessage 提供最小可用的 mock 环境：
 * - createTestSession()：轻量 ChatSession
 * - createTestLlmStream()：可控 LLM 流（按 chunk 顺序 yield，支持中途抛错模拟中断）
 * - createTestClient()：mock ToolAwareClient（getClientForModel/getLLMClient 返回）
 * - createTestHost()：ChatOrchestratorHost 最小面 mock（4 个流式端口 + 事件溯源 + 工具 + LLM）
 *
 * 设计原则（对标实施计划 §2.1）：
 * - 只 mock streamMessageFlow 实际调用的字段（见依赖清单），其余惰性 stub
 * - 核心断言字段（appendStreamEvent / getStreamTailSeq / _finalizeStreamMessage 等）用
 *   overrides 可替换为 vi.fn() 追踪落盘
 * - 布尔开关默认 false（跳过遥测/轨迹分支）
 */
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatSession } from '../../../src/chat/types/session.js';
import type { Message } from '../../../src/chat/types/message.js';
import type { SimpleMutex } from '../../../src/core/SimpleMutex.js';
import type {
  ChatMessage,
  ChatResponse,
  ThinkingProviderChunk,
  ToolAwareClient,
  ToolDefinition,
} from '@modules/ai';

// ─── Session ─────────────────────────────────────────────

/** 测试 session 工厂：轻量 ChatSession（messages/metadata） */
export function createTestSession(
  overrides: Partial<ChatSession> = {}
): ChatSession {
  return {
    id: 'test-session',
    messages: [],
    metadata: {},
    state: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ChatSession;
}

// ─── LLM 流 ──────────────────────────────────────────────

export interface TestLlmChunk {
  /** 文本块（string）或 thinking 块（{type:'thinking', content}） */
  content: string | { type: 'thinking'; content: string };
}

export interface TestLlmStreamOptions {
  /** 在消费第 N 个 chunk 后抛错（模拟流中断/provider 异常），默认不抛 */
  failAfter?: number;
  /** 抛出的错误（默认 STREAM_INTERRUPTED 风格 AppError） */
  failWith?: Error;
  /** 首块前延迟 ms（TTFB 路径测试用），默认 0 */
  ttfDelayMs?: number;
}

/**
 * 可控 LLM 流：按 chunks 顺序 yield string/thinking，
 * 消费到 failAfter 个后抛 failWith（触发 streamMessageFlow 中断路径 L1119）。
 */
export async function* createTestLlmStream(
  chunks: TestLlmChunk[],
  options: TestLlmStreamOptions = {}
): AsyncGenerator<string | ThinkingProviderChunk, ChatResponse> {
  const { failAfter = Infinity, failWith, ttfDelayMs = 0 } = options;
  if (ttfDelayMs > 0) await sleep(ttfDelayMs);

  let consumed = 0;
  for (const chunk of chunks) {
    consumed++;
    if (consumed > failAfter) {
      throw failWith ?? new Error('stream: simulated interruption');
    }
    if (typeof chunk.content === 'string') {
      yield chunk.content;
    } else {
      yield { type: 'thinking', content: chunk.content.content };
    }
  }
  return { content: '', role: 'assistant', id: '' } as unknown as ChatResponse;
}

// ─── Client ──────────────────────────────────────────────

/**
 * mock ToolAwareClient（getClientForModel / getLLMClient 返回）。
 * 每次 streamMessage 调用返回**新的 generator**（避免 async generator 单次消费限制）。
 */
export function createTestClient(
  chunks: TestLlmChunk[],
  options: TestLlmStreamOptions = {}
): ToolAwareClient {
  return {
    streamMessage: () => createTestLlmStream(chunks, options),
    sendMessage: async () =>
      ({ content: '', role: 'assistant', id: '' }) as unknown as ChatResponse,
    getProviderId: () => 'test-provider',
    getBaseUrl: () => 'http://localhost:test',
    // ToolAwareClient 其余字段惰性 stub（测试未触及）
  } as unknown as ToolAwareClient;
}

// ─── Host ────────────────────────────────────────────────

export interface TestHostOverrides {
  /** 会话覆盖（非 host 字段，测试便捷） */
  session?: ChatSession;
  /** LLM 流 chunk 覆盖（非 host 字段，测试便捷） */
  llmChunks?: TestLlmChunk[];
  /** LLM 流选项（中断/延迟模拟） */
  llmOptions?: TestLlmStreamOptions;
}

/**
 * host mock：最小面 + 4 端口（惰性 stub，overrides 可替换核心断言字段）。
 * 测试通过 overrides 注入 vi.fn() 追踪 appendStreamEvent / getStreamTailSeq /
 * _finalizeStreamMessage 等落盘行为。
 */
export function createTestHost(
  overrides: Partial<ChatOrchestratorHost> & TestHostOverrides = {}
): ChatOrchestratorHost {
  const session = overrides.session ?? createTestSession();
  const llmClient = createTestClient(
    overrides.llmChunks ?? [],
    overrides.llmOptions ?? {}
  );
  const abortController = new AbortController();

  // A-2① 缓冲正文收集（默认端口：flush 时聚合为 text-batch 经 appendStreamEvent
  //      写入——appendStreamEvent 可能被测试覆写为收集器，故运行时经 hostRef 动态取用）
  const hostTextBuffers = new Map<string, string[]>();
  let hostRef: ChatOrchestratorHost;

  const host = {
    // ── 数据 ──
    chatSessions: new Map([[session.id, session]]),
    sessionMutexes: new Map(),
    sessionAbortControllers: new Map([[session.id, abortController]]),
    currentSessionIdRef: { get: () => session.id },
    pendingInteractions: new Map(),
    toolRoundCount: 0,
    executingPlan: false,

    // ── 开关 ──
    ENABLE_TELEMETRY: false,
    ENABLE_TRAJECTORY: false,
    ENABLE_PLAN_DRIVEN_LOOP: true,
    MAX_TOOL_TURNS: 30,

    // ── 服务（惰性 stub） ──
    messageService: {
      createToolResultMessage: () => ({}) as Message,
      createAssistantMessage: () => ({}) as Message,
    },
    sessionLifecycle: {} as ChatOrchestratorHost['sessionLifecycle'],
    hookChainManager: { execute: async () => {} } as unknown as ChatOrchestratorHost['hookChainManager'],
    unifiedTracker: {
      checkBeforeRequest: async () => ({
        decision: 'skip',
        snapshot: { tokens: 0, maxTokens: 1000, ratio: 0 },
      }),
      onStreamChunk: () => {},
      resetStreamTokens: () => {},
      startStreamingCheck: () => () => {},
    } as unknown as ChatOrchestratorHost['unifiedTracker'],
    imageContextService: {} as ChatOrchestratorHost['imageContextService'],
    checkpointService: {
      saveCheckpointWithData: async () => {},
    } as unknown as ChatOrchestratorHost['checkpointService'],
    memoryManager: null,
    summarizer: null,
    pdcaLauncher: null,
    loopDetector: {} as ChatOrchestratorHost['loopDetector'],

    // ── 委托回调 ──
    getLLMClient: () => llmClient,
    getClientForModel: () => llmClient,
    getToolRegistry: () => null,
    buildToolDefinitions: (schemas: unknown[]) => schemas as ToolDefinition[],
    addAndPersistMessage: () => {},
    appendStreamEvent: async () => ({ ok: true, tailSeq: 0 }),
    // A-2①（2026-09-02）：缓冲/聚合语义对齐存储层默认端口（测试可经 appendStreamEvent 收集）
    bufferStreamTextChunk: async (sid: string, _mid: string, content: string) => {
      const arr = hostTextBuffers.get(sid) ?? [];
      arr.push(content);
      hostTextBuffers.set(sid, arr);
      return { ok: true };
    },
    flushStreamEventBuffer: async (sid: string) => {
      const arr = hostTextBuffers.get(sid);
      if (!arr || arr.length === 0) return { ok: true, flushed: 0 };
      hostTextBuffers.set(sid, []);
      const joined = arr.join('');
      const r = await hostRef.appendStreamEvent(sid, {
        type: 'assistant/text-batch',
        schemaVersion: 1,
        seq: 0,
        time: Date.now(),
        sessionId: sid,
        data: { content: joined, messageId: 'm-stream' },
      } as never);
      return { ok: r.ok, flushed: arr.length };
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
    getOrCreateTAORLoop: () => ({}),
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

    // ── 4 个流式端口（惰性 stub，overrides 可替换） ──
    _prepareStreamSession: async () => ({
      content: '',
      session,
      streamAbortController: abortController,
      streamingCheckpoint: {
        onToolCompleted: async () => {},
        restore: async () => null,
        restoreStepIndex: () => {},
      },
      mutex: { acquire: async () => {}, release: () => {} } as SimpleMutex,
      userMessage: {} as Message,
      // otel span 惰性 stub（addEvent/end/setAttribute 等）
      streamSpan: {
        addEvent: () => {},
        end: () => {},
        recordException: () => {},
        setAttribute: () => {},
        setStatus: () => {},
      } as unknown as ChatOrchestratorHost['_prepareStreamSession'] extends (
        ...args: infer P
      ) => Promise<infer R>
        ? R extends { streamSpan: infer S }
          ? S
          : never
        : never,
    }),
    _buildApiMessagesForStream: async () => [],
    _createStreamPipeline: () => {
      const ctx: { apiMessages: unknown[]; accumulatedContent?: string } = {
        apiMessages: [],
        accumulatedContent: '',
      };
      return {
        ctx,
        registerImages: () => {},
        assembleSystemPrompt: async () => {},
        preStreamHook: async () => {},
        compactContext: async () => ({ applied: false, savedPercent: 0 }),
        repairContent: () => ctx.accumulatedContent ?? '',
        recordUsage: () => {},
        notifyUsage: () => {},
        createAssistantMessage: () => ({}) as Message,
        postProcess: async () => {},
      };
    },
    _finalizeStreamMessage: async () => ({}) as Message,
  } as unknown as ChatOrchestratorHost;

  // overrides 合并（核心断言字段可替换为 vi.fn()）。
  // hostRef 供字面量内默认端口（flushStreamEventBuffer 等）在**运行时**经
  // 合并后对象动态取用 appendStreamEvent——测试覆写收集器（collectEvents）后才能命中。
  hostRef = { ...host, ...overrides } as ChatOrchestratorHost;
  return hostRef;
}

// ─── 工具 ────────────────────────────────────────────────

/** sleep（对齐 streamMessageFlow 内部 sleep 语义） */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
