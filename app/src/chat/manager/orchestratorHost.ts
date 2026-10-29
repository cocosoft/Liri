// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * orchestratorHost — `ChatOrchestrator` 宿主端口的装配外移（issue #8 · Cut C，2026-10-29）
 *
 * 迁出来源：`ChatManager` 构造函数里 `new ChatOrchestrator({ host: { … } })` 的**对象字面量**
 * （原 1374–1566，约 190 行）。该字面量只是把宿主的既有能力**逐个转发**给编排器，
 * 不承载任何业务判定 ⇒ 搬迁为纯装配，行为等价。
 *
 * ⚠️ 访问面说明（如实）：字面量里的端口全部是 `ChatManager` 的**私有成员**（`_addAndPersistMessage`
 * 等）。本模块以 `OrchestratorWiringHost` 结构接口 + 调用点**单点**类型断言接收宿主 ——
 * 私有成员改名不会被编译器发现，由 `bun test tests/chat` 的构造/编排回归兜底。
 * 若后续要消除该盲区，应把宿主端口改为公开接口（`ChatOrchestratorHost` 直连本类）。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名；日志模块名仍为 `chat:manager`。
 */

import { getLogger, getOTelTracing } from '@modules/monitoring';
import type {
  ChatResponse,
  ParsedToolCall,
  ToolAwareClient,
  ToolDefinition,
} from '@modules/ai';
import type { ToolCall, ToolResult } from '@modules/session/types/tool';
import type { ChatSession } from '@modules/session/types/session';
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
} from '@modules/session/types/message';
import type { EventLogQuery } from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';
import type { ToolRegistry, ToolSchema } from '@modules/tools';
import type {
  ChatManagerTAORContext,
  LoopDetector,
  TAORLoop,
} from '@modules/query';
import type { HookChainManager } from '@modules/hooks';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { SimpleMutex } from '@openliri/kernel';
import type { PendingInteractionEntry } from '@modules/utils/pendingInteractions';
import type { SessionScopedRegistry } from '@modules/utils/SessionScopedRegistry';
import { agentTelemetry } from '@modules/agent';
import { handleError } from '@modules/error';
import { containsComplexKeywords } from '@modules/workspace/CouncilOrchestrator';
import { rollupSessionSummaryToLongTerm } from '@modules/memory';
import { contextLayeringEnabled } from '../services/MessageContextPipeline';
import type { MessageService } from '../services/MessageService.js';
import type { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import type { ImageContextService } from '../services/ImageContextService';
import type { SessionCheckpointService } from '../services/SessionCheckpointService';
import type { SessionMemoryManager } from '../services/SessionMemoryManager';
import type { SessionSummarizer } from '../services/SessionSummarizer';
import type { PdcaLauncher } from '../launchers/PdcaLauncher';
import type { StreamPipeline } from '../pipeline/StreamPipeline.js';
import type { StreamSetupResult } from './streamSetup';
import type { ChatEventLogStore } from './eventLogStore';
import type { ChatRequestPrep } from './requestPrep';
import { persistTurnSummary } from '../services/MessageContextPipeline';
import type { SessionStateMachine } from '../../state/session/SessionStateMachine.js';
import type { ChatOrchestratorHost } from '../orchestrator/ChatOrchestratorHost.js';
import { assertHostSurface, type AssertNever } from './wiringHostGuard';

const logger = getLogger('chat:manager');

/**
 * 编排器装配所需的**宿主取用面**（全部为 `ChatManager` 的成员；调用点单点断言传入）。
 *
 * 签名逐条照抄宿主实现（`ChatManager.ts`），以便字面量对 `ChatOrchestratorHost` 的类型检查仍然有效。
 */
export interface OrchestratorWiringHost {
  // —— 共享状态 / 已装配的服务（构造期已就绪）——
  _chatSessions: Map<string, ChatSession>;
  _sessionMutexes: Map<string, SimpleMutex>;
  _sessionAbortControllers: Map<string, AbortController>;
  _currentSessionId: string | null;
  _pendingInteractions: SessionScopedRegistry<PendingInteractionEntry>;
  _executingPlan: boolean;
  _lastStreamBuildWindowed: boolean;
  _loopDetector: LoopDetector;
  ENABLE_TELEMETRY: boolean;
  MAX_TOOL_TURNS: number;
  messageService: MessageService;
  sessionLifecycle: SessionLifecycleManager;
  hookChainManager: HookChainManager;
  unifiedTracker: UnifiedTokenTracker;
  imageContextService: ImageContextService;
  _checkpointService: SessionCheckpointService;
  /** D2 事件日志实例缓存（#18 薄委托收敛：端口直连，不再经宿主同名转发） */
  _eventLogStore: ChatEventLogStore;
  /** A1 请求构建/快照/压缩（#18 薄委托收敛：端口直连） */
  _requestPrep: ChatRequestPrep;
  _memoryManager: SessionMemoryManager | null;
  _summarizer: SessionSummarizer | null;
  _pdcaLauncher: PdcaLauncher | null;
  llmClient: ToolAwareClient | undefined;
  toolRegistry: ToolRegistry | null;
  onTurnEnd?: () => void;

  // —— 宿主方法（签名同实现）——
  getToolRound(sessionId: string): number;
  incToolRound(sessionId: string): number;
  getClientForModel(model?: string): ToolAwareClient;
  _addAndPersistMessage(
    sessionId: string,
    message: Message,
    options?: { throwOnError?: boolean }
  ): Promise<void>;
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  readSessionEvents(
    sessionId: string,
    query: EventLogQuery
  ): Promise<LiriEvent[]>;
  listRecentSessionIds(limit: number): Promise<string[]>;
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string
  ): Promise<void>;
  bufferStreamTextChunk(
    sessionId: string,
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }>;
  flushStreamEventBuffer(
    sessionId: string
  ): Promise<{ ok: boolean; flushed: number }>;
  getStreamTailSeq(sessionId: string): Promise<number>;
  getSessionMachine(sessionId: string): SessionStateMachine;
  getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string>;
  extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void>;
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void;
  onLongTaskSignal(
    session: ChatSession,
    fact: { pendingTodoCount: number; consumedTurns: number }
  ): Promise<void>;
  persistSessionMetadata(session: ChatSession): Promise<void>;
  flushPendingPersists(): Promise<void>;
  _shouldUseTAORLoop(sessionId: string): boolean;
  _getOrCreateTAORLoop(
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
  ): TAORLoop;
  consumePendingResumeIntent(sessionId: string): boolean;
  _buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): ChatManagerTAORContext;
  executeTool(
    toolCall: ToolCall,
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ): Promise<ToolResult>;
  executeStepPrompt(
    prompt: string,
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void>;
  executePlanSteps(
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void>;
  triggerCouncilDebate(
    workspaceId: string,
    topic: string,
    context: string,
    ownerSessionId?: string
  ): Promise<void>;
  _sendMessageDowngradePath(
    session: ChatSession,
    toolCalls: ParsedToolCall[],
    apiMessages: Record<string, unknown>[],
    activeClient: ToolAwareClient,
    options?: SendMessageOptions
  ): Promise<Message>;
  _prepareStreamSession(
    content: string,
    options?: StreamMessageOptions
  ): Promise<StreamSetupResult>;
  _buildApiMessagesForStream(
    messages: Message[],
    maxContextTokens?: number,
    outputBudgetTokens?: number
  ): Promise<Array<Record<string, unknown>>>;
  _createStreamPipeline(
    session: ChatSession,
    content: string,
    options?: StreamMessageOptions
  ): StreamPipeline;
  _finalizeStreamMessage(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: ChatResponse | null,
    streamAbortController: AbortController,
    streamSpan: ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
    options?: StreamMessageOptions,
    terminationReason?: string
  ): Promise<Message>;
  _startRollbackRound(sessionId: string, roundId: number): Promise<void>;
  _endRollbackRound(
    sessionId: string,
    messageSummary: string,
    assistantContent?: string
  ): Promise<void>;
  _buildToolRoundMessages(
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ): Record<string, unknown>[];
}

/**
 * 装配期**必须存在**的宿主成员（issue #16 契约守卫；`key in host` 逐条校验）。
 */
const ORCHESTRATOR_HOST_REQUIRED_KEYS = [
  '_chatSessions',
  '_sessionMutexes',
  '_sessionAbortControllers',
  '_currentSessionId',
  '_pendingInteractions',
  '_executingPlan',
  '_lastStreamBuildWindowed',
  '_loopDetector',
  'ENABLE_TELEMETRY',
  'MAX_TOOL_TURNS',
  'messageService',
  'sessionLifecycle',
  'hookChainManager',
  'unifiedTracker',
  'imageContextService',
  '_checkpointService',
  '_eventLogStore',
  '_requestPrep',
  '_memoryManager',
  '_summarizer',
  '_pdcaLauncher',
  'toolRegistry',
  'getToolRound',
  'incToolRound',
  'getClientForModel',
  '_addAndPersistMessage',
  'appendStreamEvent',
  'readSessionEvents',
  'listRecentSessionIds',
  'updateMessageBlocks',
  'bufferStreamTextChunk',
  'flushStreamEventBuffer',
  'getStreamTailSeq',
  'getSessionMachine',
  'getOrAssembleSystemPrompt',
  'extractMemoryFromChat',
  'recordChatResponseUsage',
  'onLongTaskSignal',
  'persistSessionMetadata',
  'flushPendingPersists',
  '_shouldUseTAORLoop',
  '_getOrCreateTAORLoop',
  'consumePendingResumeIntent',
  '_buildTAORContext',
  'executeTool',
  'executeStepPrompt',
  'executePlanSteps',
  'triggerCouncilDebate',
  '_sendMessageDowngradePath',
  '_prepareStreamSession',
  '_buildApiMessagesForStream',
  '_createStreamPipeline',
  '_finalizeStreamMessage',
  '_startRollbackRound',
  '_endRollbackRound',
  '_buildToolRoundMessages',
] as const;

/** 构造期**尚未赋值 / 可选**的成员（存在性检查会误报，故单列） */
const ORCHESTRATOR_HOST_DEFERRED_KEYS = ['llmClient', 'onTurnEnd'] as const;

/**
 * 编译期全量覆盖检查：`OrchestratorWiringHost` 的每个成员都必须落进上面两张表之一。
 *
 * 接口新增成员而键表漏登记 ⇒ 此处 `tsc` 报错（`Exclude` 结果不是 `never`）。
 */
export type OrchestratorHostKeysExhaustive = AssertNever<
  Exclude<
    keyof OrchestratorWiringHost,
    | (typeof ORCHESTRATOR_HOST_REQUIRED_KEYS)[number]
    | (typeof ORCHESTRATOR_HOST_DEFERRED_KEYS)[number]
  >
>;

/**
 * 构建编排器宿主端口（逐条转发，不含业务判定）。
 *
 * @param host 宿主（`ChatManager` 实例；调用点经 `asWiringHost` 单点断言传入）
 * @param sessionLookupTool `session_lookup` 工具定义（宿主静态常量；仅在 `contextLayeringEnabled()` 时注入）
 */
export function createOrchestratorHost(
  host: OrchestratorWiringHost,
  sessionLookupTool: ToolDefinition
): ChatOrchestratorHost {
  // issue #16：构建前先校验宿主端口存在性（私有成员改名/删除 ⇒ 立即抛错并点名缺失键）
  assertHostSurface(
    host,
    ORCHESTRATOR_HOST_REQUIRED_KEYS,
    'createOrchestratorHost'
  );
  return {
    chatSessions: host._chatSessions,
    sessionMutexes: host._sessionMutexes,
    sessionAbortControllers: host._sessionAbortControllers,
    currentSessionIdRef: {
      get: () => host._currentSessionId,
      set: (id) => {
        host._currentSessionId = id;
      },
    },
    pendingInteractions: host._pendingInteractions as unknown as Map<
      string,
      unknown
    >,
    get toolRoundCount(): number {
      // 设计三：per-session——host 未持有会话时回退当前会话
      return host.getToolRound(host._currentSessionId ?? '');
    },
    incrementToolRoundCount: (): void => {
      const sid = host._currentSessionId;
      if (sid) {
        const next = host.incToolRound(sid);
        logger.debug('chat:toolRoundCount 递增', {
          currentSessionId: sid,
          newValue: next,
        });
      }
    },
    get executingPlan(): boolean {
      return host._executingPlan;
    },
    withExecutingPlan: async <T>(
      flag: boolean,
      fn: () => Promise<T>
    ): Promise<T> => {
      const prev = host._executingPlan;
      host._executingPlan = flag;
      try {
        return await fn();
      } finally {
        host._executingPlan = prev;
      }
    },
    ENABLE_TELEMETRY: host.ENABLE_TELEMETRY,
    ENABLE_PLAN_DRIVEN_LOOP: true, // 阶段 3 退役（2026-09-01）：灰度开关删除，恒启用
    MAX_TOOL_TURNS: host.MAX_TOOL_TURNS,
    messageService: host.messageService,
    sessionLifecycle: host.sessionLifecycle,
    hookChainManager: host.hookChainManager,
    unifiedTracker: host.unifiedTracker,
    imageContextService: host.imageContextService,
    checkpointService: host._checkpointService,
    memoryManager: host._memoryManager,
    summarizer: host._summarizer,
    pdcaLauncher: host._pdcaLauncher,
    getLLMClient: () => host.llmClient as ToolAwareClient,
    getClientForModel: (model?: string) => host.getClientForModel(model),
    getToolRegistry: () => host.toolRegistry,
    buildToolDefinitions: (schemas: unknown[]) =>
      host._requestPrep.buildToolDefinitions(schemas as ToolSchema[]),
    recordToolsSnapshot: (sid, schemas) =>
      host._requestPrep.recordToolsSnapshot(sid, schemas as ToolSchema[]),
    loopDetector: host._loopDetector as import('@modules/query').LoopDetector,
    addAndPersistMessage: (sid, msg) => host._addAndPersistMessage(sid, msg),
    appendStreamEvent: (sid, event) => host.appendStreamEvent(sid, event),
    // U4（2026-10-06）：读会话事件（与 appendStreamEvent 成对）——
    // 空闲期在线质量评估器经此按水位增量读；**主链不调用**。
    readSessionEvents: (sid, query) => host.readSessionEvents(sid, query),
    // U4（2026-10-06）：磁盘层"最近更新"会话（历史会话补评用）
    listRecentSessionIds: (limit) => host.listRecentSessionIds(limit),
    // P0-1② 覆盖面补齐（2026-10-04）：无工具回合终稿修复后替换正文（走既有实现）
    updateMessageBlocks: (sid, mid, blocks, text) =>
      host.updateMessageBlocks(sid, mid, blocks, text),
    bufferStreamTextChunk: (sid, mid, content) =>
      host.bufferStreamTextChunk(sid, mid, content),
    flushStreamEventBuffer: (sid) => host.flushStreamEventBuffer(sid),
    getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
    getStreamMaxTurn: (sid) => host._eventLogStore.getStreamMaxTurn(sid),
    getSessionMachine: (sid) => host.getSessionMachine(sid),
    getOrAssembleSystemPrompt: (session, content) =>
      host.getOrAssembleSystemPrompt(session, content),
    extractFilePathsFromText: (text) =>
      host._requestPrep.extractFilePathsFromText(text),
    extractMemoryFromChat: (u, a, sid) => host.extractMemoryFromChat(u, a, sid),
    recordChatResponseUsage: (sid, usage, requestId, model) =>
      host.recordChatResponseUsage(sid, usage, requestId, model),
    sanitizeApiMessages: (msgs) => host._requestPrep.sanitizeApiMessages(msgs),
    truncateApiMessages: (msgs, max, sid, outputBudgetTokens) =>
      host._requestPrep.truncateApiMessages(msgs, max, sid, outputBudgetTokens),
    persistTurnSummary: (session) => persistTurnSummary(session),
    // D3（2026-09-25）：运行中长任务信号 ⇒ 按既有升级通道接给 PDCA（闸门见 longTaskEscalation）
    onLongTaskSignal: (session, fact) => host.onLongTaskSignal(session, fact),
    // 跨 run 预算（2026-09-25）：轮次边界把 `metadata.toolTurnBudget` 写回会话存储
    persistSessionMetadata: (session) => host.persistSessionMetadata(session),
    flushPendingPersists: () => host.flushPendingPersists(),
    shouldUseTAORLoop: (sid) => host._shouldUseTAORLoop(sid),
    getOrCreateTAORLoop: (sid) => host._getOrCreateTAORLoop(sid),
    // G-T3-1（2026-10-12）：委托路径据此跳过 `taorLoop.reset()`（一次性续跑意图）。
    consumePendingResumeIntent: (sid) => host.consumePendingResumeIntent(sid),
    buildTAORContext: (sid, defs, opts) =>
      host._buildTAORContext(sid, defs, opts),
    executeTool: (tc, opts) => host.executeTool(tc as ToolCall, opts),
    executeStepPrompt: (prompt, session, options) =>
      host.executeStepPrompt(prompt, session, options),
    executePlanSteps: (session, options) =>
      host.executePlanSteps(session, options),
    triggerCouncilDebate: (wid, topic, ctx, ownerSessionId) =>
      host.triggerCouncilDebate(wid, topic, ctx, ownerSessionId),
    sendMessageDowngradePath: (session, tcs, msgs, client, options) =>
      host._sendMessageDowngradePath(session, tcs, msgs, client, options),
    shouldTriggerCouncil: (session, content, options) =>
      session.metadata?.is_ultraplan_mode === true ||
      containsComplexKeywords(content) ||
      options?.metadata?.councilTriggeredManually === true,
    triggerCouncilDebateAsync: (session, content, options) => {
      host
        .triggerCouncilDebate(
          session.metadata?.workspaceId || 'default',
          content,
          session.metadata?.context || '',
          session.id
        )
        .catch((err) => {
          handleError(err, {
            module: 'chat:manager',
            action: 'Council辩论执行失败',
          });
        });
    },
    endTurnTelemetry: (sessionId, _ok, content) => {
      if (host.ENABLE_TELEMETRY) {
        try {
          agentTelemetry.endTurn(sessionId, 'completed');
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    },
    onTurnEnd: () => host.onTurnEnd?.(),
    _prepareStreamSession: (content, options) =>
      host._prepareStreamSession(content, options),
    _buildApiMessagesForStream: (
      msgs,
      maxCtx,
      outBudget
    ): Promise<Record<string, unknown>[]> =>
      host._buildApiMessagesForStream(msgs, maxCtx, outBudget),
    // C 阶段（P1）：session_lookup 工具注入辅助（schema + 本次构建是否切窗）
    getSessionLookupTool: () =>
      contextLayeringEnabled() ? sessionLookupTool : null,
    isLastStreamBuildWindowed: () => host._lastStreamBuildWindowed,
    // D 阶段（v5）：跨会话摘要上卷至长期记忆（adapter 实现：幂等 upsert +
    // skipConsolidation；内部失败仅 warn 不抛）
    rollupSessionSummaryToLongTerm: (input) =>
      rollupSessionSummaryToLongTerm(input),
    _createStreamPipeline: (session, content, options) =>
      host._createStreamPipeline(session, content, options),
    _finalizeStreamMessage: (
      session,
      content,
      acc,
      am,
      fr,
      abortCtl,
      span,
      options,
      terminationReason
    ) =>
      host._finalizeStreamMessage(
        session,
        content,
        acc,
        am,
        fr as ChatResponse,
        abortCtl,
        span as ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
        options,
        terminationReason
      ),
    startRollbackRound: (sid, roundId) =>
      host._startRollbackRound(sid, roundId),
    endRollbackRound: (sid, content, firstContent) =>
      host._endRollbackRound(sid, content, firstContent),
    buildToolRoundMessages: (msgs, am, tcs, prs) =>
      host._buildToolRoundMessages(msgs, am, tcs, prs),
  };
}
