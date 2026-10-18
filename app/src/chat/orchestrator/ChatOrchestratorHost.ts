/**
 * ChatOrchestrator 宿主端口（叶子模块，2026-10-19 CI 断环）
 *
 * 原定义在 `ChatOrchestrator.ts`，而 11 个 `streamMessage*` / `sendMessageFlow` 子模块
 * 反向 `import type` 它，与 `ChatOrchestrator.ts -> 子模块` 构成 11 条静态环。
 * 端口类型下沉到本叶子模块后，双方都只依赖它 ⇒ 环消失；`ChatOrchestrator.ts` 仍原样重导出。
 */
import type { SimpleMutex } from '@modules/core';
import type {
  ToolAwareClient,
  ToolDefinition,
  ParsedToolCall,
} from '@modules/ai';
import type { ToolRegistry } from '@modules/tools';
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
} from '@modules/session/types/message.js';
import type { LiriEvent } from '@modules/session/types/events.js';
import type { EventLogQuery } from '@modules/session';
import type { ChatSession } from '@modules/session/types/session.js';
import type { ToolResult } from '@modules/session/types/tool.js';
import type {
  SessionLifecycleManager,
  SessionCurrentIdPort,
} from '../services/SessionLifecycleManager.js';
import type { MessageService } from '../services/MessageService.js';
import type { UnifiedTokenTracker } from '@modules/tokenBudget';
import type { ImageContextService } from '../services/ImageContextService.js';
import type { HookChainManager } from '@modules/hooks';
import type { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint.js';
import type { SessionMemoryManager } from '../services/SessionMemoryManager.js';
import type { SessionSummarizer } from '../services/SessionSummarizer.js';
import type { PdcaLauncher } from '../launchers/PdcaLauncher.js';
import type { Span } from '@opentelemetry/api';
import type { SessionCheckpointService } from '../services/SessionCheckpointService.js';
import type { LoopDetector } from '@modules/query';
/**
 * 编排所需的最小 ChatManager 端口（sendMessage/streamMessage 编排委托）
 */
export interface ChatOrchestratorHost {
  // ── 共享状态（Map 直接传共享引用） ──────────────────────────
  chatSessions: Map<string, ChatSession>;
  sessionMutexes: Map<string, SimpleMutex>;
  sessionAbortControllers: Map<string, AbortController>;
  currentSessionIdRef: SessionCurrentIdPort;
  pendingInteractions: Map<string, unknown>;
  /** 工具轮次计数（sendMessage TAORLoop/计划编排读取） */
  toolRoundCount: number;
  /** 工具轮次计数 +1（流式/非流式完成后调用，确保 turn 编号唯一） */
  incrementToolRoundCount(): void;
  /** 是否正在执行计划（create_task_list 编排标志） */
  executingPlan: boolean;
  /** 原子切换 executingPlan 并执行（finally 恢复原值） */
  withExecutingPlan<T>(flag: boolean, fn: () => Promise<T>): Promise<T>;

  // ── 只读配置/标志 ─────────────────────────────────────────
  readonly ENABLE_TELEMETRY: boolean;
  readonly ENABLE_PLAN_DRIVEN_LOOP: boolean;
  readonly MAX_TOOL_TURNS: number;

  // ── 依赖服务 ──────────────────────────────────────────────
  messageService: MessageService;
  sessionLifecycle: SessionLifecycleManager;
  hookChainManager: HookChainManager;
  unifiedTracker: UnifiedTokenTracker;
  imageContextService: ImageContextService;
  checkpointService: SessionCheckpointService;
  memoryManager: SessionMemoryManager | null;
  summarizer: SessionSummarizer | null;
  pdcaLauncher: PdcaLauncher | null;
  /** 工具循环检测器（ToolLoopRunner 依赖，缺失会导致工具执行 TypeError） */
  loopDetector: LoopDetector;

  // ── 委托回调（编排需要触达 ChatManager 的其他能力） ─────────
  getLLMClient(): ToolAwareClient;
  getClientForModel(model?: string): ToolAwareClient;
  getToolRegistry(): ToolRegistry | null;
  buildToolDefinitions(schemas: unknown[]): ToolDefinition[];
  /**
   * TR-12-B（2026-09-22）：把"本轮发给模型的工具清单"落成 `context/model-input` 事件
   * （引用式去重），使"模型当时看到了哪些工具"可从事件重建（project_rules §1.6 红线）。
   * 失败不阻断主路径（服务内仅 warn）。
   */
  recordToolsSnapshot(sessionId: string, schemas: unknown[]): void;
  addAndPersistMessage(sessionId: string, message: Message): void;
  /**
   * M1 事件溯源：流式过程中追加事件到 events.jsonl
   *
   * 供 streamMessageFlow 在每个 chunk yield 前调用，
   * 把 thinking/text chunk 实时落盘到事件日志。
   * 失败不阻断流式（CS03），返回结果含失败原因。
   */
  appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }>;
  /**
   * U4（2026-10-06，`.trae/specs/online-quality-evaluation.md`）：**读**会话事件
   * （薄包 `EventLogStorage.read`，与 `appendStreamEvent` 成对）。
   *
   * 用途：空闲期在线质量评估器按水位增量读事件（**主链不调用**）。
   * 之所以由宿主提供：`EventLogStorage` **由 `chat/` 持有**（`CompactionOrchestrator.ts:208` 明文），
   * 非 chat 模块一律走注入（同 `RequestSnapshotService` / `requestPrep` / `requestBoundary`）。
   */
  readSessionEvents(
    sessionId: string,
    query: EventLogQuery
  ): Promise<LiriEvent[]>;
  /**
   * U4 历史会话补评（2026-10-06）：列出**最近更新**的会话 id（**磁盘层**，
   * 含本进程未加载的会话）。排序口径 `updatedAt` 降序 + 截断 —— 与消费方
   * （梦境只处理"最近被触碰的会话"）同源，**主链不调用**。
   */
  listRecentSessionIds(limit: number): Promise<string[]>;
  /**
   * P0-1② 覆盖面补齐（2026-10-04，`final-output-guard-no-tool-turns.md`）：
   * 更新消息 blocks —— 无工具回合的终稿 mermaid 修复后，用它**替换**已流出的正文
   * （与工具轮 `_supersedeNextRoundText` 同语义；G4：不新造替换通道）。
   */
  updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string
  ): Promise<void>;
  /**
   * A-2①（2026-09-02，v4 §5.2 选项①）：缓冲一条流式正文 chunk 到事件日志存储层
   * （不落盘、不分配 seq；落盘由 flushStreamEventBuffer / 读路径自动 flush 驱动）。
   * 失败不阻断流式（CS03）。
   */
  bufferStreamTextChunk(
    sessionId: string,
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }>;
  /**
   * A-2①：flush 该会话全部缓冲正文——按 messageId 聚合为 assistant/text-batch 落盘
   * （F-2 schema），批量失败回退逐 chunk（A-1）。返回 flush 的 chunk 数。
   */
  flushStreamEventBuffer(
    sessionId: string
  ): Promise<{ ok: boolean; flushed: number }>;
  /** C 阶段（2026-09-02，P1）：提供 session_lookup 取回工具 schema（null = 不提供/分层关闭） */
  getSessionLookupTool?(): ToolDefinition | null;
  /** C 阶段（2026-09-02，P1）：最近一次流式请求构建是否发生分页切窗（供工具注入判定） */
  isLastStreamBuildWindowed?(): boolean;
  /**
   * D 阶段（2026-09-02，v5）：跨会话摘要上卷至长期记忆（SessionSummaryAdapter 实现，
   * 失败仅 warn 不抛 CS03）。由 ChatManagerImpl host 提供。
   */
  rollupSessionSummaryToLongTerm?(input: {
    sessionId: string;
    content: string;
    keywords?: string[];
    compactedRange?: { startSeq: number; endSeq: number };
    sourceEventSeqs?: number[];
    summarySeq?: number;
  }): Promise<boolean>;
  /**
   * M1 事件溯源：获取当前会话的 tailSeq
   *
   * 供 streamMessageFlow 在流式开始时调用，决定 turn/start 与首个 chunk 的 seq。
   */
  getStreamTailSeq(sessionId: string): Promise<number>;
  /**
   * M1 事件溯源：获取当前会话已有事件的最大 turn 编号（重启后恢复 turn 计数）
   *
   * 供 streamMessageFlow 在写入 turn/start 时调用，替代内存计数器 toolRoundCount，
   * 避免后端重启后 turn 编号从 1 重新开始导致重复 turn 号。
   */
  getStreamMaxTurn(sessionId: string): Promise<number>;
  /** P3-3：中止指定会话的流式请求（卡死看门狗中断回调用，ChatManager 已实现） */
  abortSessionStream?(sessionId: string): void;
  getSessionMachine(sessionId: string): {
    start(reason?: string): unknown;
    finish(reason?: string): unknown;
  };
  getOrAssembleSystemPrompt(
    session: ChatSession,
    content: string
  ): Promise<string>;
  extractFilePathsFromText(text: string): string[];
  extractMemoryFromChat(
    userMsg: string,
    aiMsg: string,
    sessionId: string
  ): Promise<void>;
  /**
   * 用量记账（P2-2：`requestId` 可选透传，缺省 ⇒ 不写该字段）
   *
   * 债四「换算接线」（2026-10-13）：`model`（本轮实际模型）可选透传 ⇒ 供**金额**台账
   * 取价换算（缺失 ⇒ 只记 token、不记金额，**不臆造金额**）。
   */
  recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void;
  sanitizeApiMessages(messages: Record<string, unknown>[]): void;
  truncateApiMessages(
    messages: Record<string, unknown>[],
    maxTokens: number,
    sessionId: string,
    outputBudgetTokens?: number
  ): Promise<void>;
  persistTurnSummary(session: ChatSession): void;
  /**
   * **运行中长任务信号**（D3，2026-09-25）：`ReActToolLoop.getLongTaskSignal()` 命中的回合结束时，
   * 由宿主决定是否按**既有**升级通道把该任务接给 PDCA 编排（闸门见 `chat/longTaskEscalation.ts`；
   * 实现见 `ChatManager.onLongTaskSignal`）。
   *
   * 声明为**可选**：既有测试桩 host 未实现该缝时行为不变（不升级）。
   */
  onLongTaskSignal?(
    session: ChatSession,
    fact: { pendingTodoCount: number; consumedTurns: number }
  ): Promise<void>;
  /**
   * 把内存会话 metadata 合并持久化到会话存储（实现见 `ChatManager.persistSessionMetadata`）。
   *
   * 2026-09-25（跨 run 预算）：`ReActToolLoop` 每轮在内存更新 `metadata.toolTurnBudget`，
   * 由本方法在**轮次边界**写回磁盘 —— 使同一任务的下一次续跑（`systemResume`）能读到累计值。
   */
  persistSessionMetadata(session: ChatSession): Promise<void>;
  flushPendingPersists(): Promise<void>;
  shouldUseTAORLoop(sessionId: string): boolean;
  getOrCreateTAORLoop(sessionId: string): unknown;
  /**
   * G-T3-1（2026-10-12，预算挂起续跑）：**一次性消费**续跑意图。
   *
   * `resumeSuspendedSession` 的 taor 分支在触发执行入口前登记意图 ⇒ 委托路径据此
   * **跳过** `taorLoop.reset()`（`reset()` 会清刚恢复的游标/steering，使"续跑"退化）。
   * 命中即删并返回 `true`；未登记返回 `false`（照常 reset，既有行为不变）。
   */
  consumePendingResumeIntent(sessionId: string): boolean;
  buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): unknown;
  executeTool(
    toolCall: {
      id: string;
      name: string;
      arguments: unknown;
      sessionId: string;
    },
    opts?: { useErrorHandler?: boolean }
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
    /** 发起辩论的聊天会话 ID（U-14 阶段 1.3：会话级挂起快照的关联键） */
    ownerSessionId?: string
  ): Promise<void>;
  sendMessageDowngradePath(
    session: ChatSession,
    toolCalls: ParsedToolCall[],
    apiMessages: Record<string, unknown>[],
    activeClient: ToolAwareClient,
    options?: SendMessageOptions
  ): Promise<Message>;
  /** 是否触发 Council 辩论（sendMessage 收尾判断） */
  shouldTriggerCouncil(
    session: ChatSession,
    content: string,
    options?: SendMessageOptions
  ): boolean;
  /** 异步发起 Council 辩论（不阻塞主流程） */
  triggerCouncilDebateAsync(
    session: ChatSession,
    content: string,
    options?: SendMessageOptions
  ): void;
  /** telemetry/trajectory 回合收尾 */
  endTurnTelemetry(sessionId: string, ok: boolean, content?: string): void;
  /** Agent Loop 完成回调（AlwaysOnManager 注册） */
  onTurnEnd?: () => void;

  // ── 流式编排端口（streamMessageFlow 委托） ─────────────────
  _prepareStreamSession(
    content: string,
    options?: StreamMessageOptions
  ): Promise<{
    content: string;
    session: ChatSession;
    streamAbortController: AbortController;
    streamingCheckpoint: StreamingAutoCheckpoint;
    mutex: SimpleMutex;
    userMessage: Message;
    streamSpan: Span;
  }>;
  _buildApiMessagesForStream(
    messages: Message[],
    // C-2（2026-09-02，v4 §7.2）：可选预算参数——传 0/undefined 时不启用 map 前置切窗
    maxContextTokens?: number,
    outputBudgetTokens?: number
  ): Promise<Record<string, unknown>[]>;
  _createStreamPipeline(
    session: ChatSession,
    content: string,
    options?: StreamMessageOptions
  ): {
    ctx: {
      apiMessages: Record<string, unknown>[];
      toolDefinitions: ToolDefinition[];
      accumulatedContent: string;
      finalResponse: unknown;
      /** P2-2：本请求 requestId（= 同请求 `request/start` 的 seq）；缺省 ⇒ 用量条不带该字段 */
      requestId?: number;
      assistantMessage?: Message;
    };
    registerImages(): Promise<void>;
    preStreamHook(): Promise<void>;
    assembleSystemPrompt(
      fn: (s: ChatSession, c: string) => Promise<string>
    ): Promise<void>;
    compactContext(): Promise<{
      applied: boolean;
      beforeTokens: number;
      afterTokens: number;
      savedPercent: number;
    }>;
    repairContent(): string;
    recordUsage(): void;
    notifyUsage(): void;
    createAssistantMessage(content: string, opts?: { id?: string }): Message;
    postProcess(content: string): Promise<void>;
  };
  _finalizeStreamMessage(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: unknown,
    streamAbortController: AbortController,
    streamSpan: Span,
    options?: StreamMessageOptions,
    /** TB-16（2026-09-24）：主循环终止判定（透传落 `turn/end.terminationReason`） */
    terminationReason?: string
  ): Promise<Message>;
  /** 回滚轮次启动（streamMessage 工具循环） */
  startRollbackRound(sessionId: string, roundId: number): Promise<unknown>;
  /** 回滚轮次结束 */
  endRollbackRound(
    sessionId: string,
    content: string,
    firstAssistantContent: string
  ): Promise<unknown>;
  /** 构建工具轮次消息 */
  buildToolRoundMessages(
    messages: Record<string, unknown>[],
    assistantMessage: Message,
    toolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ParsedToolCall;
      result: ToolResult;
    }>
  ): Record<string, unknown>[];
}
