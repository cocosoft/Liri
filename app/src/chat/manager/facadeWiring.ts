// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * facadeWiring — 子门面 / 服务装配外移（issue #8 · Cut C，2026-10-29）
 *
 * 迁出来源：`ChatManager` 构造函数里的「第一阶段收敛」到「断点续跑」区块
 * （原 1116–1374，约 259 行）。内容全部是 `new X({ …端口… })` 的装配，**不含业务判定**。
 *
 * 顺序敏感的约束（逐条保持迁移前顺序）：`_summarizer`/`_memoryManager` → 步骤循环工厂 →
 * `_pdcaLauncher` → `_wireCodeRunnerDeps()` → `_toolExecutionService` → `sessionLifecycle` →
 * `resumeCoordinator` → `contextCompactor` → `_pdcaLaunch` → `_streamSetup` → `_msgPersist` →
 * `_streamFinalize` → `_streamResume`。后段门面**按值读取**前段结果（如 `sessionLifecycle`），
 * 故本函数内必须按此顺序赋值。
 *
 * ⚠️ 访问面说明（如实）：端口值全部取自 `ChatManager` 的**私有成员**；本模块以
 * `FacadeWiringHost` 结构接口 + 调用点单点断言接收宿主。私有成员改名不会被编译器发现，
 * 由 `bun test tests/chat` 的构造/编排回归兜底。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名。
 */

import { SimpleMutex } from '@openliri/kernel';
import type {
  ToolAwareClient,
  ToolDefinition,
  ParsedToolCall,
} from '@modules/ai';
import type { ToolRegistry, ToolSchema } from '@modules/tools';
import type {
  ToolCall,
  ToolIntegration,
  ToolResult,
} from '@modules/session/types/tool';
import type {
  ChatSession,
  CreateSessionParams,
} from '@modules/session/types/session';
import type { EventLogStorage, SessionGateway } from '@modules/session';
import type {
  Message,
  SendMessageOptions,
} from '@modules/session/types/message';
import type { LiriEvent } from '@modules/session/types/events';
import type {
  ChatManagerTAORContext,
  LoopDetector,
  TAORLoop,
} from '@modules/query';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { HookChainManager } from '@modules/hooks';
import { CompactServiceImpl } from '@modules/compaction';
import type { RollbackIntegration } from '@modules/security';
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';
import type { PendingInteractionEntry } from '@modules/utils/pendingInteractions';
import type { SessionScopedRegistry } from '@modules/utils/SessionScopedRegistry';
import { setStepLoopFactory } from '@modules/tasks';
import type { MessageService } from '../services/MessageService.js';
import type { SessionAccessFacade } from '../services/SessionAccessFacade';
import { SessionLifecycleManager } from '../services/SessionLifecycleManager.js';
import { ResumeCoordinator } from '../services/ResumeCoordinator.js';
import { ContextCompactor } from '../services/ContextCompactor.js';
import type { SessionCheckpointService } from '../services/SessionCheckpointService.js';
import { SessionMemoryManager } from '../services/SessionMemoryManager';
import { SessionSummarizer } from '../services/SessionSummarizer';
import type { ImageContextService } from '../services/ImageContextService';
import { ToolExecutionService } from '../services/ToolExecutionService.js';
import type { ChatRecovery } from './recovery';
import { PdcaLauncher } from '../launchers/PdcaLauncher';
import { PdcaLaunchCoordinator } from './pdcaLaunch';
import { ChatStreamSetup } from './streamSetup';
import { ChatMessagePersistence } from './messagePersistence';
import { ChatStreamFinalize } from './streamFinalize';
import { ChatStreamResume } from './streamResume';
import type { SessionStateMachine } from '../../state/session/SessionStateMachine.js';
import type { ChatEventLogStore } from './eventLogStore';
import { assertHostSurface, type AssertNever } from './wiringHostGuard';

/** 工具执行的进度回调（`executeTool` 的 opts 形状） */
interface ToolExecOpts {
  useErrorHandler?: boolean;
  onProgress?: (progress: {
    toolUseID: string;
    data: Record<string, unknown>;
  }) => void;
}

/**
 * 装配所需的**宿主取用面**（全部为 `ChatManager` 的成员；调用点单点断言传入）。
 *
 * 签名逐条照抄宿主实现（`ChatManager.ts`），保持各子门面构造期的类型检查仍然有效。
 */
export interface FacadeWiringHost {
  // —— 共享状态 / 依赖（构造期已就绪）——
  llmClient: ToolAwareClient | undefined;
  sessionAccess: SessionAccessFacade;
  _chatSessions: Map<string, ChatSession>;
  messageService: MessageService;
  toolRegistry: ToolRegistry | null;
  toolIntegration: ToolIntegration | undefined;
  permissionManager: unknown;
  imageContextService: ImageContextService;
  rollbackIntegrations: Map<string, RollbackIntegration>;
  sessionGateway: SessionGateway;
  _currentSessionId: string | null;
  _sessionLeaveTimes: Map<string, number>;
  _sessionMutexes: Map<string, SimpleMutex>;
  _sessionAbortControllers: Map<string, AbortController>;
  _sessionExecutionIds: Map<string, string>;
  _pendingInteractions: SessionScopedRegistry<PendingInteractionEntry>;
  _pendingPersistPromises: Set<Promise<void>>;
  _toolCallSeqMap: Map<string, number>;
  _pdcaLaunchingSessions: Set<string>;
  compactService: CompactServiceImpl;
  _checkpointService: SessionCheckpointService;
  unifiedTracker: UnifiedTokenTracker;
  hookChainManager: HookChainManager;
  ENABLE_ERROR_HANDLER: boolean;
  ENABLE_TELEMETRY: boolean;
  MAX_TOOL_TURNS: number;
  _loopDetector: LoopDetector;
  _recovery: ChatRecovery;

  // —— 装配产物（本函数赋值）——
  _summarizer: SessionSummarizer | null;
  _memoryManager: SessionMemoryManager | null;
  _pdcaLauncher: PdcaLauncher | null;
  _toolExecutionService: ToolExecutionService | null;
  sessionLifecycle: SessionLifecycleManager;
  resumeCoordinator: ResumeCoordinator;
  contextCompactor: ContextCompactor;
  _pdcaLaunch: PdcaLaunchCoordinator;
  _streamSetup: ChatStreamSetup;
  _msgPersist: ChatMessagePersistence;
  _streamFinalize: ChatStreamFinalize;
  _streamResume: ChatStreamResume;

  // —— 宿主方法（签名同实现）——
  _getOrCreateTAORLoop(
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
  ): TAORLoop;
  _buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): ChatManagerTAORContext;
  _addAndPersistMessage(
    sessionId: string,
    message: Message,
    options?: { throwOnError?: boolean }
  ): Promise<void>;
  _submitToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    toolCallId: string,
    approvalReason?: string,
    approvalScope?: ApprovalScope,
    approvalSnapshot?: ApprovalSnapshot
  ): Promise<string | null>;
  getSessionWorkspacePath(sessionId?: string): string | undefined;
  getSessionWorkspaceId(sessionId?: string): string | undefined;
  isSessionWorkspaceStrict(sessionId?: string): boolean;
  getSessionApprovalMode(sessionId?: string): 'ask' | 'auto-local';
  _isCommandApproved(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    approvalFingerprint?: string
  ): Promise<boolean>;
  _wireCodeRunnerDeps(): void;
  createSession(params: CreateSessionParams): Promise<ChatSession>;
  _shouldUsePlanDrivenLoop(message: string): boolean;
  _shouldUseCodeMode(message: string): boolean;
  getStreamTailSeq(sessionId: string): Promise<number>;
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  persistSessionMetadata(session: ChatSession): Promise<void>;
  _recentUserText(session: ChatSession, n?: number): string;
  _lastAssistantText(session: ChatSession): string;
  _isLastAssistantOutputFallback(session: ChatSession): boolean;
  _waitForAbortSettled(
    sessionId: string,
    controller: AbortController
  ): Promise<void>;
  getSessionMachine(sessionId: string): SessionStateMachine;
  _requestReconcile(sessionId: string, eventLog: EventLogStorage): void;
  /** D2 事件日志实例缓存（#18 薄委托收敛：端口直连，不再经宿主同名转发） */
  _eventLogStore: ChatEventLogStore;
  getToolRound(sessionId: string): number;
  incToolRound(sessionId: string): number;
  _persistTurnSummary(session: ChatSession): void;
  _escalateToPdcaViaBareSession(params: {
    session: ChatSession;
    assistantContent: string;
    lastUserContent: string;
  }): Promise<void>;
  _autoCreateProject(
    session: ChatSession,
    workspaceId: string | undefined,
    result: { hasGoal: boolean; deliverables: number; goalSummary?: string }
  ): Promise<string | null>;
  _maybeLaunchPdca(
    session: ChatSession,
    assistantContent: string,
    projectId: string,
    lastUserContent: string | undefined
  ): void;
  flushPendingPersists(): Promise<void>;
  getLLMClient(): ToolAwareClient;
  _buildToolDefinitions(schemas: ToolSchema[]): ToolDefinition[];
  _recordToolsSnapshot(sessionId: string, schemas: ToolSchema[]): void;
  executeTool(toolCall: ToolCall, opts?: ToolExecOpts): Promise<ToolResult>;
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void;
  getToolRegistry(): ToolRegistry | null;
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
 *
 * 只列**输入**：输出（本函数赋值）在装配前不存在，不能参与存在性检查。
 */
const FACADE_HOST_REQUIRED_KEYS = [
  'sessionAccess',
  '_chatSessions',
  'messageService',
  'toolRegistry',
  'permissionManager',
  'imageContextService',
  'rollbackIntegrations',
  'sessionGateway',
  '_currentSessionId',
  '_sessionLeaveTimes',
  '_sessionMutexes',
  '_sessionAbortControllers',
  '_sessionExecutionIds',
  '_pendingInteractions',
  '_pendingPersistPromises',
  '_toolCallSeqMap',
  '_pdcaLaunchingSessions',
  'compactService',
  '_checkpointService',
  'unifiedTracker',
  'hookChainManager',
  'ENABLE_ERROR_HANDLER',
  'ENABLE_TELEMETRY',
  'MAX_TOOL_TURNS',
  '_loopDetector',
  '_recovery',
  '_getOrCreateTAORLoop',
  '_buildTAORContext',
  '_addAndPersistMessage',
  '_submitToolApproval',
  'getSessionWorkspacePath',
  'getSessionWorkspaceId',
  'isSessionWorkspaceStrict',
  'getSessionApprovalMode',
  '_isCommandApproved',
  '_wireCodeRunnerDeps',
  'createSession',
  '_shouldUsePlanDrivenLoop',
  '_shouldUseCodeMode',
  'getStreamTailSeq',
  'appendStreamEvent',
  'persistSessionMetadata',
  '_recentUserText',
  '_lastAssistantText',
  '_isLastAssistantOutputFallback',
  '_waitForAbortSettled',
  'getSessionMachine',
  '_eventLogStore',
  '_requestReconcile',
  'getToolRound',
  'incToolRound',
  '_persistTurnSummary',
  '_escalateToPdcaViaBareSession',
  '_autoCreateProject',
  '_maybeLaunchPdca',
  'flushPendingPersists',
  'getLLMClient',
  '_buildToolDefinitions',
  '_recordToolsSnapshot',
  'executeTool',
  'recordChatResponseUsage',
  'getToolRegistry',
  '_buildToolRoundMessages',
] as const;

/** 构造期**尚未赋值**的成员（由宿主稍后注入；存在性检查会误报，故单列） */
const FACADE_HOST_DEFERRED_KEYS = ['llmClient', 'toolIntegration'] as const;

/** 本函数**赋值**的产物（装配前不存在，不参与存在性检查） */
const FACADE_HOST_OUTPUT_KEYS = [
  '_summarizer',
  '_memoryManager',
  '_pdcaLauncher',
  '_toolExecutionService',
  'sessionLifecycle',
  'resumeCoordinator',
  'contextCompactor',
  '_pdcaLaunch',
  '_streamSetup',
  '_msgPersist',
  '_streamFinalize',
  '_streamResume',
] as const;

/**
 * 编译期全量覆盖检查：`FacadeWiringHost` 的每个成员都必须落进上面三张表之一。
 *
 * 接口新增成员而键表漏登记 ⇒ 此处 `tsc` 报错（`Exclude` 结果不是 `never`）。
 */
export type FacadeHostKeysExhaustive = AssertNever<
  Exclude<
    keyof FacadeWiringHost,
    | (typeof FACADE_HOST_REQUIRED_KEYS)[number]
    | (typeof FACADE_HOST_DEFERRED_KEYS)[number]
    | (typeof FACADE_HOST_OUTPUT_KEYS)[number]
  >
>;

/**
 * 装配全部子门面（顺序敏感，见文件头注释）。
 */
export function wireChatFacades(host: FacadeWiringHost): void {
  // issue #16：装配前先校验宿主端口存在性（私有成员改名/删除 ⇒ 立即抛错并点名缺失键）
  assertHostSurface(host, FACADE_HOST_REQUIRED_KEYS, 'wireChatFacades');
  // 第一阶段收敛：初始化提取的服务
  host._summarizer = new SessionSummarizer(host.llmClient);
  host._memoryManager = new SessionMemoryManager(
    host.sessionAccess,
    host.llmClient,
    host._chatSessions
  );
  // 2026-10-08（长程任务「执行不了」根因修复）：向 tasks 层注册步骤 TAORLoop 工厂。
  // 此前**只有** PdcaLauncher（会话内升级 / 阶段链）显式 `setTAORLoopFactory`，
  // 而 `getOrCreateOrchestrator()` 这条入口（前端「用编排推进」按钮 = `POST /v1/pdca/start`、
  // CLI `/goal start`）**从不注入** ⇒ 步骤退化为"纯 LLM 文本执行"：模型看不到工具、
  // 工具调用也无处执行（事故 `pdca_muz3wada`：`hasTAORLoop:false`，9 步 / 0 次工具调用）。
  // 注册后两条入口同源同行为。
  setStepLoopFactory((sid, opts) => host._getOrCreateTAORLoop(sid, opts));

  host._pdcaLauncher = new PdcaLauncher({
    enablePlanDrivenLoop: true, // 阶段 3 退役（2026-09-01）：灰度开关删除，恒启用
    taorLoopFactory: (sid, opts) => host._getOrCreateTAORLoop(sid, opts),
    buildTAORContext: (sid, defs, opts) =>
      host._buildTAORContext(sid, defs, opts),
    sessionMap: host._chatSessions,
    messageService: host.messageService,
    persistMessage: (sid, msg) => host._addAndPersistMessage(sid, msg),
    // 转正（2026-09-01）：任务分解 Provider——任务分工→chat 路由→ProviderRegistry
    // （模型体系唯一事实来源，不硬编码模型名）；失败/缺失返回 null，TaskDecomposer 降级简单分解
    getDecomposerProvider: async () => {
      try {
        const { resolveModelRoute, RouteKey } =
          await import('@modules/ai/router/resolveModelRoute');
        const { providerRegistry } = await import('@modules/ai');
        const modelId = await resolveModelRoute(RouteKey.CHAT);
        return providerRegistry.getByModel(modelId) ?? null;
      } catch {
        return null;
      }
    },
  });

  // CM-6：Code Mode 运行期依赖接线（CODE_MODE 开启时）
  host._wireCodeRunnerDeps();

  // 第三阶段收敛：初始化工具执行服务
  host._toolExecutionService = new ToolExecutionService({
    getToolRegistry: () => host.toolRegistry,
    getToolIntegration: () => host.toolIntegration ?? null,
    getPermissionManager: () => host.permissionManager,
    imageContextService: host.imageContextService,
    rollbackIntegrations: host.rollbackIntegrations,
    sessionGateway: host.sessionGateway,
    chatSessions: host._chatSessions,
    currentSessionId: host._currentSessionId ?? '',
    enableErrorHandler: host.ENABLE_ERROR_HANDLER,
    submitToolApproval: host._submitToolApproval.bind(host),
    getSessionWorkspacePath: host.getSessionWorkspacePath.bind(host),
    getSessionWorkspaceId: host.getSessionWorkspaceId.bind(host),
    isSessionWorkspaceStrict: host.isSessionWorkspaceStrict.bind(host),
    // PR-3（2026-10-23）：会话级审批模式（缺省 ask）
    getSessionApprovalMode: host.getSessionApprovalMode.bind(host),
    isCommandApproved: host._isCommandApproved.bind(host),
    sessionLookup: (args) => host._eventLogStore.sessionLookup(args),
    // R3（2026-09-21）：向工具执行注入**会话级中断控制器**。
    // 工具 context 原先没有 `abortController`（被内联类型断言掩盖）⇒ AgentTool 的
    // 父级取消桥接恒空转。此 Map 即 `stopMessage()` 中止的对象（见 `_sessionAbortControllers`），
    // 故"用户点停止"从此能传导到工具内部（并行批次短路未投递 worker）。
    getSessionAbortController: (sessionId) =>
      sessionId ? host._sessionAbortControllers.get(sessionId) : undefined,
  });

  // 会话生命周期门面：与会话状态共享 Map 引用 + currentSessionId 端口
  host.sessionLifecycle = new SessionLifecycleManager({
    chatSessions: host._chatSessions,
    currentSessionIdRef: {
      get: () => host._currentSessionId,
      set: (id) => {
        host._currentSessionId = id;
      },
    },
    sessionLeaveTimes: host._sessionLeaveTimes,
    sessionMutexes: host._sessionMutexes,
    sessionAbortControllers: host._sessionAbortControllers,
    sessionGateway: host.sessionGateway,
    sessionAccess: host.sessionAccess,
    hookChainManager: host.hookChainManager,
    messageService: host.messageService,
  });

  // 检查点/恢复门面：注入 checkpointService + 共享会话 Map + createSession 委托
  host.resumeCoordinator = new ResumeCoordinator({
    checkpointService: host._checkpointService,
    chatSessions: host._chatSessions,
    createSession: (p) => host.createSession(p),
  });

  // 上下文压缩门面：注入 compactService + 共享会话 Map + currentSessionId 端口
  host.contextCompactor = new ContextCompactor({
    compactService: host.compactService,
    chatSessions: host._chatSessions,
    currentSessionIdRef: {
      get: () => host._currentSessionId,
      set: (id) => {
        host._currentSessionId = id;
      },
    },
  });

  // PDCA 自动启动簇（U-22/S1 外移）：注入 host 端口，方法体在 `chat/manager/pdcaLaunch.ts`。
  host._pdcaLaunch = new PdcaLaunchCoordinator({
    launchingSessions: host._pdcaLaunchingSessions,
    getPdcaLauncher: () => host._pdcaLauncher,
    shouldUsePlanDrivenLoop: (msg) => host._shouldUsePlanDrivenLoop(msg),
    shouldUseCodeMode: (msg) => host._shouldUseCodeMode(msg),
    getOrCreateTAORLoop: (sid) => host._getOrCreateTAORLoop(sid),
    getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
    appendStreamEvent: (sid, event) => host.appendStreamEvent(sid, event),
    persistSessionMetadata: (session) => host.persistSessionMetadata(session),
    recentUserText: (session, n) => host._recentUserText(session, n),
    lastAssistantText: (session) => host._lastAssistantText(session),
    // BUG-A（2026-10-27）：长任务信号升级时区分"模型产出"与"空输出兜底"（结构化标记）
    isLastAssistantOutputFallback: (session) =>
      host._isLastAssistantOutputFallback(session),
    // LRO-11（2026-10-26）：执行模式可见告知（"仍在普通对话循环"等）
    notifyUser: (sid, text, metadata) => {
      host._addAndPersistMessage(
        sid,
        host.messageService.createAssistantMessage(text, {
          sessionId: sid,
          metadata: { isTaskMessage: true, ...metadata },
        })
      );
    },
  });

  // 流式请求准备段（U-22/S2 外移）：注入 host 端口，方法体在 `chat/manager/streamSetup.ts`。
  host._streamSetup = new ChatStreamSetup({
    currentSessionId: () => host._currentSessionId,
    getOrLoadSession: (sid, metadata) =>
      host.sessionLifecycle.getOrLoadSession(sid, metadata),
    onModelSwitch: (model) => host.unifiedTracker.onModelSwitch(model),
    beginStreamSession: (sid, model) =>
      host.unifiedTracker.beginStreamSession(sid, model),
    getExistingAbort: (sid) => host._sessionAbortControllers.get(sid),
    waitForAbortSettled: (sid, ac) => host._waitForAbortSettled(sid, ac),
    setAbortController: (sid, ac) => {
      host._sessionAbortControllers.set(sid, ac);
    },
    setExecutionId: (sid, executionId) => {
      host._sessionExecutionIds.set(sid, executionId);
    },
    checkpointService: host._checkpointService,
    getOrCreateMutex: (sid) => {
      let mutex = host._sessionMutexes.get(sid);
      if (!mutex) {
        mutex = new SimpleMutex();
        host._sessionMutexes.set(sid, mutex);
      }
      return mutex;
    },
    executePreMessageHook: (args) =>
      host.hookChainManager.execute('chat', args),
    createUserMessage: (content, opts) =>
      host.messageService.createUserMessage(content, opts),
    addAndPersistMessage: (sid, msg) => {
      host._addAndPersistMessage(sid, msg);
    },
    startProcessing: (sid) => {
      host.getSessionMachine(sid).start('processUserInput');
    },
  });

  // 消息持久化 / 事件投影（U-22/S3 外移）：注入 host 端口，方法体在
  // `chat/manager/messagePersistence.ts`；待落盘 Promise 集合仍归宿主（flush 共用）。
  host._msgPersist = new ChatMessagePersistence({
    chatSessions: host._chatSessions,
    sessionGateway: host.sessionGateway,
    getOrCreateEventLog: (sid) => host._eventLogStore.getOrCreateEventLog(sid),
    rebuildToolCallSeqMap: (sid) =>
      host._eventLogStore.rebuildToolCallSeqMap(sid),
    toolCallSeqMap: host._toolCallSeqMap,
    requestReconcile: (sid, eventLog) => host._requestReconcile(sid, eventLog),
    pendingPersistPromises: host._pendingPersistPromises,
    createAssistantMessage: (content, opts) =>
      host.messageService.createAssistantMessage(content, opts),
    getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
  });

  // 流式消息收尾（U-22/S4 外移）：注入 host 端口，方法体在
  // `chat/manager/streamFinalize.ts`；abort/executionId 两个 Map 与宿主共享。
  host._streamFinalize = new ChatStreamFinalize({
    addAndPersistMessage: (sid, msg) => host._addAndPersistMessage(sid, msg),
    getStreamMaxTurn: (sid) => host._eventLogStore.getStreamMaxTurn(sid),
    getToolRound: (sid) => host.getToolRound(sid),
    hasTurnEnded: (sid, turn) => host._eventLogStore.hasTurnEnded(sid, turn),
    getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
    appendStreamEvent: (sid, event) => host.appendStreamEvent(sid, event),
    endStreamSession: (sid) => host.unifiedTracker.endStreamSession(sid),
    finishSessionMachine: (sid, reason) => {
      host.getSessionMachine(sid).finish(reason);
    },
    sessionAbortControllers: host._sessionAbortControllers,
    sessionExecutionIds: host._sessionExecutionIds,
    persistTurnSummary: (session) => host._persistTurnSummary(session),
    accumulateSessionMemory: (sid, user, assistant, tokens, toolCalls) => {
      host._memoryManager!.accumulate(sid, user, assistant, tokens, toolCalls);
    },
    recentUserText: (session, n) => host._recentUserText(session, n),
    shouldUseCodeMode: (msg) => host._shouldUseCodeMode(msg),
    escalateToPdcaViaBareSession: (params) =>
      host._escalateToPdcaViaBareSession(params),
    autoCreateProject: (session, workspaceId, result) =>
      host._autoCreateProject(session, workspaceId, result),
    maybeLaunchPdca: (session, assistantContent, projectId, lastUser) =>
      host._maybeLaunchPdca(session, assistantContent, projectId, lastUser),
    isTelemetryEnabled: () => host.ENABLE_TELEMETRY,
    summarizeSession: (session, message) => {
      void host._summarizer!.summarize(session, message).catch(() => {
        /* 摘要生成失败不阻塞 */
      });
    },
    flushPendingPersists: () => host.flushPendingPersists(),
    incToolRound: (sid) => host.incToolRound(sid),
  });

  // 断点续跑（U-22/S4 外移）：注入 host 端口，方法体在
  // `chat/manager/streamResume.ts`；互斥锁 / abort 两个 Map 与宿主共享。
  host._streamResume = new ChatStreamResume({
    sessionMutexes: host._sessionMutexes,
    resumeSessionState: async (sid) => {
      await host.sessionGateway.resumeSession(sid);
    },
    checkpointService: host._checkpointService,
    rebuildTrailingTurnFromEvents: (sid) =>
      host._recovery.rebuildTrailingTurnFromEvents(sid),
    getOrLoadSession: (sid) => host.sessionLifecycle.getOrLoadSession(sid),
    sessionAbortControllers: host._sessionAbortControllers,
    getLLMClient: () => host.getLLMClient(),
    getToolSchemas: () =>
      host.toolRegistry ? host.toolRegistry.getToolSchemas() : null,
    buildToolDefinitions: (schemas) => host._buildToolDefinitions(schemas),
    recordToolsSnapshot: (sid, schemas) =>
      host._recordToolsSnapshot(sid, schemas),
    maxToolTurns: host.MAX_TOOL_TURNS,
    executeTool: (tc, opts) => host.executeTool(tc, opts),
    pendingInteractions: host._pendingInteractions,
    loopDetector: host._loopDetector,
    messageService: host.messageService,
    addAndPersistMessage: (sid, msg) => host._addAndPersistMessage(sid, msg),
    unifiedTracker: host.unifiedTracker,
    recordChatResponseUsage: (sid, usage, requestId, model) =>
      host.recordChatResponseUsage(sid, usage, requestId, model),
    getToolRegistry: () => host.getToolRegistry(),
    buildToolRoundMessages: (msgs, am, tcs, prs) =>
      host._buildToolRoundMessages(msgs, am, tcs, prs),
  });
}
