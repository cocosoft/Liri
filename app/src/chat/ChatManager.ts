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

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { homedir } from 'node:os';

import { Logger, LogLevel, getOTelTracing } from '@modules/monitoring';
import { SpanStatusCode } from '@opentelemetry/api';
import { repairModelJson } from '@modules/utils/json';
import { containsComplexKeywords } from '@modules/workspace/CouncilOrchestrator';
import { ImageContextService } from './services/ImageContextService';
import {
  validatePathsInOutput,
  clearPathCheckCache,
} from './services/PathGuardService';
import {
  toSessionMsgType,
  mapSessionStatusToState,
  extractTodoData,
  resolveMaxContextTokens,
  repairImageUrls,
  TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
  getLocalSession,
  getOrCreateSessionMachine,
  persistChatMessage,
} from './services/ChatHelper';
import {
  sanitizeApiMessages,
  compressToolHistory,
  persistTurnSummary,
  extractCurrentGoal,
  truncateApiMessages,
  assembleContextualSystemPrompt,
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from './services/MessageContextPipeline';
import { StreamingToolCallScrubber } from '../streaming/scrubbers/StreamingToolCallScrubber';
import { SessionAccessFacade } from './services/SessionAccessFacade';
import { TaskFacade } from './facades/TaskFacade';

const logger = new Logger({ module: 'chat:manager', level: LogLevel.INFO });
import { SimpleMutex } from '@modules/core/SimpleMutex';
import { ImplicitEngineHook } from '../project/ImplicitEngineHook';
import { createProjectStore } from '../workspace/ProjectStore.js';
import { WorkItemStore } from '../workspace/WorkItemStore.js';
import { resolveDataDir } from '@modules/core/paths';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { getModelPricing } from '@modules/cost/ModelPricing.js';
// eslint-disable-next-line module-registry/no-direct-module-import
import { calculateTotalCost } from '@modules/cost/calculateCost.js';

import type { ChatManager } from './ChatManagerInterface.js';

/**
 * 聊天管理器
 * 聊天功能的核心管理类，负责整合所有聊天相关的功能
 */
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
  ChatResponse,
} from './types/message.js';
import { createSystemMessage } from './types/message.js';
import type { ChatSession, CreateSessionParams } from './types/session.js';
import { SessionState } from './types/session.js';
import type { ToolCall, ToolResult, ToolIntegration } from './types/tool.js';
import { getToolCallName } from './types/tool.js';
import {
  MessageService,
  createMessageService,
} from './services/MessageService.js';
import {
  StreamService,
  createStreamService,
} from './services/StreamService.js';
import { SessionStateMachine } from '../state/session/SessionStateMachine.js';
import { sessionMetadataService } from './services/SessionMetadataService.js';
import { eventNotificationService } from './services/EventNotificationService.js';
import { messageProcessingService } from './services/MessageProcessingService.js';
import { permissionModeIntegrationService } from './services/PermissionModeIntegrationService.js';
import { performanceOptimizationService } from './services/PerformanceOptimizationService.js';
import { securityService } from './services/SecurityService.js';
import { createCheckpointService } from './services/SessionCheckpointService.js';
import { StreamingAutoCheckpoint } from './services/StreamingAutoCheckpoint.js';
import { HookChainManager } from '@modules/hooks/core/HookChainManager.js';
import {
  recursivelySanitizeUnicode,
  sanitizeHTML,
  validateInput,
} from '@modules/utils/sanitization.js';
import { toolResultRegistry } from '../tool/ToolResultRegistry.js';
import { ToolAwareClient } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { trackUsage } from '@modules/ai';
import {
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
  type MaxOutputRetryState,
} from '../ai/MaxOutputRetryHandler';
import {
  createDegradationState,
  tryDegradeContext,
  getDegradationWarning,
  type DegradationState,
} from '../ai/ContextDegradation';
import type { IToolExecutor } from '@modules/ai';
import type { ToolRegistry, ToolSchema } from '@modules/tools/ToolRegistry';
import type {
  ChatMessage,
  ParsedToolCall,
  ToolDefinition,
  ChatResponse as AIChatResponse,
} from '@modules/ai';
import type { ThinkingProviderChunk } from '@modules/ai';
import type {
  ChatStreamChunk,
  QuestionData,
} from '@modules/runtime/api/CoreAPI.js';
import { assembleSystemPrompt } from '@modules/services/prompt/PromptAssembler';
import { setCurrentKnowledgeQuery } from '@modules/services/prompt/KnowledgePromptProvider';
import type { SessionContext } from '@modules/memory/types/SessionContext';
import {
  QueryEngine,
  createQueryEngine,
  type QueryEngineConfig,
} from '../query/QueryEngine.js';
import {
  TokenBudgetController,
  TokenBudgetStatus,
  type TokenBudgetParams,
  getDefaultTokenBudget,
} from '../core/tokenBudget/TokenBudgetController.js';
import { UnifiedTokenTracker } from '../core/tokenBudget/UnifiedTokenTracker.js';
import { ContextTracker } from '../query/context/ContextTracker.js';
import { compactionOrchestrator } from '../context/compaction/CompactionOrchestrator.js';
import { estimateMessagesTokens } from '../ai/tokenizer/TokenEstimator';
import { FileCheckpointStorage } from '../query/FileCheckpointStorage.js';
import {
  StopHookManager,
  createStopHookManager,
  DEFAULT_STOP_HOOK_PRIORITIES,
} from '../query/StopHooks.js';
import type { StopHookReason } from '../query/StopHooks.js';
import { TAORLoop, createTAORLoop } from '../query/TAORLoop.js';
import type { TAORLoopConfig } from '../query/TAORLoop.js';
import { LoopDetector } from '../query/LoopDetector.js';
import { createChatManagerTAORDeps } from '../query/ChatManagerTAORAdapter.js';
import type { ChatManagerTAORContext } from '../query/ChatManagerTAORAdapter.js';
import { agentTelemetry } from '../agent/AgentTelemetry.js';
import { trajectoryRecorder } from '../agent/trajectory/TrajectoryRecorder.js';
import { trajectoryRuntime } from '../core/trajectory/TrajectoryRuntime.js';
import { ErrorHandler } from '../core/utils/ErrorHandler.js';
import { convergenceDetector } from './services/ConvergenceDetector.js';
import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '../services/compact/CompactService.js';
import type { SessionMessage } from '@modules/session/models/SessionMessage';
import {
  SessionGateway,
  createSessionGateway,
} from '@modules/session/SessionGateway';
import type {
  UnifiedMessage,
  FrontendMessageBlock,
  MessageMetadata,
} from '@modules/session/types/Message';
import { MessageRole as SessionMessageRole } from '@modules/session/types/Message';
import {
  resolveProjectRoot,
  resolveOutputDir,
  resolvePyappHome,
} from '@modules/core/paths';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { TaskStatus } from '@modules/tasks/types';

import {
  RollbackIntegration,
  SensitiveErrorType,
  FileOperationTracker,
} from '@modules/security';
import type { FileOperation, FileChange } from '@modules/security';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { taskOrchestrator } from '@modules/tasks/TaskOrchestrator';

/** 非流式路径中待恢复的工具循环状态 */
interface InteractionSavedState {
  currentRoundMessages: Record<string, unknown>[];
  currentToolCalls: ParsedToolCall[];
  processedResults: Array<{
    normalizedToolCall: ToolCall;
    result: ToolResult;
  }>;
  interactionIdx: number;
  roundAssistantMsg: Message;
  toolDefinitions: Record<string, unknown>[];
  sessionId: string;
  questionData: QuestionData;
}

/**
 * 聊天管理器实现
 */
export class ChatManagerImpl implements ChatManager {
  /**
   * 消息服务
   */
  private messageService: MessageService;

  /**
   * 流服务
   */
  private streamService: StreamService;

  /**
   * 当前会话ID（本地缓存）
   */
  private _currentSessionId: string | null = null;
  /** 记录每个会话的离开时间戳，用于回切召回检测 */
  private _sessionLeaveTimes = new Map<string, number>();

  /**
   * 会话内存缓存
   */
  private _chatSessions: Map<string, ChatSession> = new Map();

  /**
   * 会话级互斥锁 — 防止同一会话并发流式请求（Bug Fix: 工具链被用户新消息打断）
   */
  private _sessionMutexes = new Map<string, SimpleMutex>();

  /**
   * 会话级中止控制器 — 新请求到达时中止旧流
   */
  private _sessionAbortControllers = new Map<string, AbortController>();

  /**
   * P1-5: 检查指定会话是否有活跃的流式请求
   * 用于前端幽灵块检测 — 长时间无 chunk 时 ping 此状态
   */
  public isSessionStreaming(sessionId: string): boolean {
    return this._sessionAbortControllers.has(sessionId);
  }

  /**
   * P2-1: 获取会话最近一次自动检查点的消息列表
   * 用于断线重连时恢复任务状态
   */
  public async getLatestCheckpointMessages(
    sessionId: string
  ): Promise<Array<Record<string, unknown>> | null> {
    try {
      const cp = await this._checkpointService.getLatestCheckpoint(sessionId);
      if (cp && cp.messages && cp.messages.length > 0) {
        return cp.messages as unknown as Array<Record<string, unknown>>;
      }
      return null;
    } catch (e) {
      logger.warn('获取最新检查点失败', {
        sessionId,
        error: String(e),
      });
      return null;
    }
  }

  /**
   * S1: 中止指定会话的流式请求
   * 用于 req.on('close') → 通知后端停止工具执行
   */
  public abortSessionStream(sessionId: string): void {
    const controller = this._sessionAbortControllers.get(sessionId);
    if (controller) {
      logger.info('req.on(close) 触发 — 中止会话流', { sessionId });
      controller.abort();
    }
  }

  /**
   * 传统工具循环最大轮次（防止无 TAORLoop 保护时的死循环）
   * 可通过环境变量 MAX_TAOR_TURNS 或 MAX_TOOL_TURNS 覆盖，默认 300
   */
  private readonly MAX_TOOL_TURNS = (() => {
    const env = process.env.MAX_TAOR_TURNS || process.env.MAX_TOOL_TURNS;
    if (env) {
      const val = parseInt(env, 10);
      if (!isNaN(val) && val > 0) return val;
    }
    return 300;
  })();

  /**
   * 检查点服务
   */
  private _checkpointService: ReturnType<typeof createCheckpointService>;

  /** P2-1: 当前流式执行的自动检查点管理器 */
  private _streamingCheckpoint: StreamingAutoCheckpoint | null = null;

  /**
   * LLM客户端
   */
  private llmClient: ToolAwareClient | undefined;

  /**
   * 工具集成
   */
  private toolIntegration: ToolIntegration | undefined;

  /**
   * 工具注册表
   */
  private toolRegistry: ToolRegistry | null = null;

  /**
   * 权限管理器
   */
  private permissionManager: unknown = null;

  /**
   * 工具执行器
   */
  private toolExecutor: IToolExecutor | null = null;

  /**
   * 子Agent管理器
   */
  private subAgentManager: unknown = null;

  /**
   * 会话持久化网关
   */
  private sessionGateway: SessionGateway;

  /**
   * HookChain 管理器
   */
  private hookChainManager: HookChainManager;
  private _executingPlan = false;

  /**
   * 待处理的用户交互（工具暂停/恢复机制）
   * 当工具需要用户输入时，streamMessage 会 yield question 分块，
   * 然后 await 此 Promise，直到 UI 层调用 resolveInteraction() 解析
   */
  private _pendingInteraction: {
    questionId: string;
    promise: Promise<string[]>;
    resolve: (answers: string[]) => void;
  } | null = null;

  /**
   * 非流式路径中待恢复的工具循环状态
   * 当 sendMessage 遇到需要用户交互的工具时，将循环状态保存至此 Map，
   * 等待 continueInteraction() 恢复执行
   */
  private pendingInteractions: Map<string, InteractionSavedState> = new Map();

  /**
   * 查询引擎
   */
  private queryEngine: QueryEngine | undefined;

  /**
   * 查询引擎配置
   */
  private queryEngineConfig: QueryEngineConfig | undefined;

  /**
   * Token 预算管理器（仅累计，不做循环控制——循环控制由 Phase 2 的 StopHookManager 负责）
   */
  private tokenBudget: TokenBudgetController;
  /** 统一追踪器 — 请求前预检 + 流式水位 + 请求后校准 */
  private unifiedTracker: UnifiedTokenTracker;

  /**
   * 上下文压缩追踪器（记录压缩前后 token 数、压缩比等指标）
   */
  private contextTracker: ContextTracker = new ContextTracker(100);

  /**
   * 工具循环轮次计数器（每轮工具调用递增）
   */
  private _toolRoundCount: number = 0;

  /**
   * 停止钩子管理器（Phase 2：预算检查统一入口）
   */
  private stopHookManager: StopHookManager;

  /**
   * Tracker feature flags（默认 false，灰度控制）
   */
  private readonly ENABLE_TELEMETRY =
    process.env.ENABLE_AGENT_TELEMETRY === 'true';
  private readonly ENABLE_TRAJECTORY = process.env.ENABLE_TRAJECTORY === 'true';
  private readonly ENABLE_ERROR_HANDLER =
    process.env.ENABLE_ERROR_HANDLER === 'true';

  /**
   * Phase 2: TAORLoop 统一编排器开关（默认 false，灰度控制）
   * 启用后 sendMessage/streamMessage 委托 TAORLoop 编排工具调用循环
   */
  private readonly ENABLE_LOOP_V8_PHASE2 =
    process.env.ENABLE_LOOP_V8_PHASE2 === 'true';

  /**
   * P2-3: TAORLoop 流量百分比（0~100，默认 10）
   * 仅在 ENABLE_LOOP_V8_PHASE2=true 时生效。
   * 按 sessionId hash 决定是否走 TAORLoop 路径。
   */
  private readonly _taorLoopTrafficPercent: number = (() => {
    const raw = process.env.TAORLOOP_TRAFFIC_PERCENT;
    const val = raw && !isNaN(Number(raw)) ? Number(raw) : 10;
    return Math.min(100, Math.max(0, val));
  })();

  /**
   * P2-3: 按 sessionId hash 决定是否走 TAORLoop 路径
   */
  private _shouldUseTAORLoop(sessionId: string): boolean {
    if (!this.ENABLE_LOOP_V8_PHASE2) return false;
    if (this._taorLoopTrafficPercent >= 100) return true;
    if (this._taorLoopTrafficPercent <= 0) return false;
    // 简单 hash：取 sessionId 首字符 charCode % 100
    const hash = (sessionId.charCodeAt(0) || 0) % 100;
    return hash < this._taorLoopTrafficPercent;
  }

  /**
   * TAORLoop 统一编排器实例（懒初始化，仅在 ENABLE_LOOP_V8_PHASE2 时创建）
   */
  private _taorLoop?: TAORLoop;

  /**
   * P2-3: LoopDetector — 工具调用循环检测器
   * 集成 TAORLoop 的循环检测能力到 streamMessage 工具循环
   */
  private _loopDetector = new LoopDetector();
  /** Resume 熔断计数 */
  private _resumeFailCount: number = 0;

  /**
   * 回滚集成（按会话 ID 索引）
   */
  private rollbackIntegrations: Map<string, RollbackIntegration> = new Map();

  /**
   * 会话级图片上下文管理服务
   * 负责图片路径注册、路径匹配、图像上下文跟踪
   */
  private imageContextService = new ImageContextService();

  /**
   * P4-fix: 待落盘的持久化 Promise 集合
   * _addAndPersistMessage 为 fire-and-forget 时，将 Promise 加入此集合。
   * 在 generator 返回前通过 flushPendingPersists() 等待全部落盘，
   * 确保 WAP 规范：操作结果在响应返回前已写入 DB。
   */
  private _pendingPersistPromises: Set<Promise<void>> = new Set();

  /**
   * 会话子系统访问门面
   */
  private sessionAccess = new SessionAccessFacade();

  /**
   * 任务执行门面
   */
  private taskFacade = new TaskFacade();

  /**
   * 压缩服务
   */
  private compactService: CompactServiceImpl;

  /**
   * 会话状态机映射
   */
  private sessionMachines: Map<string, SessionStateMachine> = new Map();

  /**
   * 从本地缓存获取会话（委托给 ChatHelper）
   */
  private _getLocalSession(
    sessionId: string | null | undefined
  ): ChatSession | undefined {
    return getLocalSession(this._chatSessions, sessionId);
  }

  /**
   * 获取或创建会话状态机（委托给 ChatHelper）
   */
  private getSessionMachine(sessionId: string): SessionStateMachine {
    return getOrCreateSessionMachine(this.sessionMachines, sessionId);
  }

  /**
   * P0-2: 每次 Agent Loop（TAORLoop）完成后的回调。
   * 由 AlwaysOnManager 注册，用于更新 agent_busy 状态。
   */
  public onTurnEnd?: () => void;

  /**
   * 构造函数
   */
  constructor() {
    this.messageService = createMessageService();
    this.streamService = createStreamService();
    this.sessionGateway = createSessionGateway();
    this.compactService = new CompactServiceImpl();
    this.hookChainManager = HookChainManager.getInstance();
    this._checkpointService = createCheckpointService(
      new FileCheckpointStorage()
    );
    const defaultBudget = getDefaultTokenBudget('default');
    this.tokenBudget = new TokenBudgetController(
      'default',
      defaultBudget,
      defaultBudget.total
    );
    this.unifiedTracker = new UnifiedTokenTracker(
      this.tokenBudget,
      new ContextTracker()
    );
    this.stopHookManager = createStopHookManager();
    this._registerStopHooks();
  }

  /**
   * 获取或创建 TAORLoop 实例（懒初始化）
   * 仅在 ENABLE_LOOP_V8_PHASE2 启用时调用
   */
  private _getOrCreateTAORLoop(sessionId: string): TAORLoop {
    if (!this._taorLoop) {
      this._taorLoop = createTAORLoop(this.getQueryEngine(), {
        sessionId,
        maxTurns: parseInt(process.env.MAX_TAOR_TURNS || '') || 300,
        /** 启用检查点，每 3 轮自动保存（原值：关闭 + 5 轮） */
        enableCheckpoint: true,
        checkpointInterval: 3,
      } satisfies TAORLoopConfig);
    }
    return this._taorLoop;
  }

  /**
   * 构建 TAORLoopDeps 上下文（批次4：sendMessage 路径）
   */
  private _buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): ChatManagerTAORContext {
    return {
      sessionId,
      toolDefinitions,
      sendModelRequest: async (messages, opts) => {
        const client = this.getClientForModel(options?.model);
        const response = await client.sendMessage(
          messages as unknown as import('../ai/models/types').ChatMessage[],
          {
            ...options,
            tools: (opts?.tools as Array<Record<string, unknown>>)?.length
              ? (opts?.tools as unknown as import('../ai/models/types').ToolDefinition[])
              : undefined,
          }
        );
        return {
          content:
            typeof response.content === 'string'
              ? response.content
              : JSON.stringify(response.content),
          tool_calls: response.tool_calls?.map(
            (tc: import('../ai/models/types').ParsedToolCall) => ({
              id: tc.id,
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? JSON.parse(tc.arguments)
                  : tc.arguments,
            })
          ),
          usage: response.usage,
        };
      },
      executeTool: (toolCall, opts) => this.executeTool(toolCall, opts),
      persistMessage: (sid, content, role, toolCallId, metadata) => {
        const msg =
          role === 'tool'
            ? this.messageService.createToolResultMessage(
                {
                  toolCallId: toolCallId || '',
                  toolName: '',
                  result: content,
                  error: undefined,
                },
                { sessionId: sid }
              )
            : this.messageService.createAssistantMessage(content, {
                sessionId: sid,
                metadata,
              });
        this._addAndPersistMessage(sid, msg);
      },
      onProgress: options?.onProgress
        ? (p) =>
            options.onProgress!(
              p as {
                stage:
                  | 'completed'
                  | 'analyzing'
                  | 'tool_executing'
                  | 'generating';
                message: string;
                toolName?: string;
              }
            )
        : undefined,
      onToolCall: options?.onToolCall
        ? (event, name, id, detail) =>
            options.onToolCall!(event as 'start' | 'end', name, id, detail)
        : undefined,
    };
  }

  /**
   * 添加消息到本地缓存并持久化
   * P1-3: await 持久化完成后再返回，符合 WAP 规范（先落盘再渲染）
   * P4-fix: 返回的 Promise 自动加入 _pendingPersistPromises，
   *         确保 flushPendingPersists() 可等待全部落盘。
   */
  private async _addAndPersistMessage(
    sessionId: string,
    message: Message
  ): Promise<void> {
    const session = this._chatSessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = new Date();
      session.metadata.lastActivityAt = new Date();
      session.metadata.totalMessages = session.messages.length;
      // 会话恢复后清除崩溃标记（正常使用说明已恢复）
      if (session.metadata.crashRecovery) {
        delete session.metadata.crashRecovery;
        delete session.metadata.crashedAt;
        delete session.metadata.lastActivityBeforeCrash;
      }
    }
    const persistPromise = (async () => {
      try {
        await persistChatMessage(this.sessionGateway, sessionId, message);
      } catch (e) {
        // @ignore-catch — 持久化失败不阻断主流程，由 handleError 统一记录
        handleError(e, {
          module: 'chat:manager',
          action: 'persistMessage',
          context: { sessionId },
        }).catch(() => {});
      }
    })();
    this._pendingPersistPromises.add(persistPromise);
    // 完成后自动从集合中移除，避免内存泄漏
    persistPromise.finally(() =>
      this._pendingPersistPromises.delete(persistPromise)
    );
    await persistPromise;
  }

  /**
   * P4-fix: 等待所有未完成的持久化 Promise
   * 在 generator 返回前调用，确保 WAP 规范（操作结果在响应返回前已写入 DB）
   * 超时保护 3 秒
   */
  private async flushPendingPersists(): Promise<void> {
    if (this._pendingPersistPromises.size === 0) return;
    const promises = [...this._pendingPersistPromises];
    try {
      await Promise.race([
        Promise.all(promises),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // 持久化超时，不阻断主流程
    }
  }

  /**
   * 更新消息的 blocks 结构并持久化
   * 使用 storage.updateMessage 按 ID 替换，避免重复追加
   */
  public async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>
  ): Promise<void> {
    const session = this._chatSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    let message = session.messages.find((m) => m.id === messageId);

    if (!message) {
      message = session.messages.filter((m) => m.role === 'assistant').pop();
    }

    if (!message) {
      message = this.messageService.createAssistantMessage('', {
        sessionId,
      });
      message.id = messageId;
      message.blocks = blocks;
      message.createdAt = new Date();
      message.updatedAt = new Date();
      session.messages.push(message);
      await persistChatMessage(this.sessionGateway, sessionId, message);
      return;
    }

    message.blocks = blocks;
    session.updatedAt = new Date();
    session.metadata.lastActivityAt = new Date();

    const toolCalls =
      message.tool_calls ||
      (message.metadata?.tool_calls as
        | Array<Record<string, unknown>>
        | undefined);
    const metadataObj: MessageMetadata = {
      ...(message.metadata as MessageMetadata | undefined),
      ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    const unifiedMessage: UnifiedMessage = {
      id: message.id,
      sessionId,
      type: toSessionMsgType(message),
      role: message.role as unknown as SessionMessageRole,
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      timestamp: message.createdAt?.getTime() ?? Date.now(),
      metadata: metadataObj,
      blocks: message.blocks as unknown as FrontendMessageBlock[] | undefined,
    };
    try {
      await this.sessionGateway.updateMessage(
        sessionId,
        messageId,
        unifiedMessage
      );
    } catch (err) {
      // 更新失败不应影响主消息流
      handleError(err, {
        module: 'chat:manager',
        action: 'updateMessage_appendAssistant',
      });
    }
  }

  /**
   * 获取 HookChain 管理器
   * @returns HookChain 管理器实例
   */
  public getHookChainManager(): HookChainManager {
    return this.hookChainManager;
  }

  /**
   * 获取或组装系统提示词（委托给 MessageContextPipeline）
   */
  private async getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string> {
    return assembleContextualSystemPrompt(
      session,
      currentMessage,
      this.llmClient,
      this.imageContextService,
      (sessionId: string) =>
        this.sessionAccess.getMemoryManager().getMemoryContext(sessionId)
    );
  }

  /**
   * 从会话中提取当前对话目标（委托给 MessageContextPipeline）
   */
  private _extractCurrentGoal(
    session: ChatSession,
    currentMessage?: string
  ): string | null {
    return extractCurrentGoal(session, currentMessage);
  }

  private _sessionsLoaded = false;

  /**
   * 确保会话已从磁盘加载（幂等）
   *
   * 与 LLM 客户端初始化解耦，使 GET /v1/sessions 等接口
   * 在首次聊天消息前即可返回持久化的会话列表。
   */
  async ensureSessionsLoaded(): Promise<void> {
    if (this._sessionsLoaded) return;
    try {
      await this.sessionGateway.initialize();
      await this._loadSessionsFromGateway();
      this._sessionsLoaded = true;
    } catch (err) {
      await handleError(err, {
        module: 'chat:manager',
        action: 'ensureSessionsLoaded',
      });
    }
  }

  /**
   * 清理超过 24 小时的残留 PID 锁文件
   * 这些文件由非正常退出（崩溃/强杀）留下，过期后无意义
   */
  private async _cleanStalePidFiles(): Promise<void> {
    try {
      const { resolveSessionsDir } = await import('@modules/core');
      const { readdirSync, statSync, unlinkSync, existsSync } = require('fs');
      const { join } = require('path');
      const pidDir = join(resolveSessionsDir(), 'pid');
      if (!existsSync(pidDir)) return;

      const now = Date.now();
      const STALE_MS = 24 * 60 * 60 * 1000; // 24 小时
      const entries = readdirSync(pidDir);
      let cleaned = 0;

      for (const entry of entries) {
        try {
          const filePath = join(pidDir, entry);
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > STALE_MS) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {
          // 单项清理失败，跳过
        }
      }

      if (cleaned > 0) {
        logger.info(`清理了 ${cleaned} 个过期 PID 锁文件`);
      }
    } catch {
      // 非关键路径，静默降级
    }
  }

  /**
   * 迁移：旧版项目路径 → 用户主目录
   * 当 LIRI_HOME 变更时，将 app/data/pyapp/data/ 下的 sessions 移到 ~/.pyapp/data/
   */
  private async _migrateHomeFromProjectToUser(): Promise<void> {
    try {
      const { resolvePyappHome } = await import('@modules/core');

      const newHome = path.join(homedir(), '.pyapp');
      const curHome = resolvePyappHome();

      // 当前已在用户主目录，无需迁移
      if (curHome.startsWith(homedir())) return;

      const curDataDir = path.join(curHome, 'data');
      const newDataDir = path.join(newHome, 'data');

      // 新路径已有数据 → 已迁移，跳过
      if (fs.existsSync(newDataDir)) return;
      // 旧路径无数据 → 无需迁移
      if (!fs.existsSync(curDataDir)) return;

      // 递归迁移：创建目标 → 移动文件 → 成功后删除旧目录
      fs.mkdirSync(newHome, { recursive: true });
      fs.mkdirSync(newDataDir, { recursive: true });

      // 迁移 home 根目录文件（settings.json 等）
      for (const entry of fs.readdirSync(curHome, { withFileTypes: true })) {
        if (entry.isFile()) {
          const srcPath = path.join(curHome, entry.name);
          const dstPath = path.join(newHome, entry.name);
          if (!fs.existsSync(dstPath)) {
            try {
              fs.renameSync(srcPath, dstPath);
            } catch {
              /* skip */
            }
          }
        }
      }

      // 迁移 data 子目录
      const migrateDir = (src: string, dst: string): void => {
        if (!fs.existsSync(src)) return;
        fs.mkdirSync(dst, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
          const srcPath = path.join(src, entry.name);
          const dstPath = path.join(dst, entry.name);
          if (entry.isDirectory()) {
            migrateDir(srcPath, dstPath);
          } else {
            try {
              fs.renameSync(srcPath, dstPath);
            } catch {
              /* 单项失败跳过 */
            }
          }
        }
      };
      migrateDir(curDataDir, newDataDir);

      logger.info(
        `会话数据已从项目路径迁移到用户主目录: ${curDataDir} → ${newDataDir}`
      );
    } catch {
      // 非致命，迁移失败不影响启动
    }
  }

  /**
   * 初始化
   */
  async initialize(): Promise<void> {
    this.llmClient?.initialize();
    await this.ensureSessionsLoaded();

    // 清理超过 24 小时的残留 PID 锁文件
    this._cleanStalePidFiles().catch((err) => {
      handleError(err, { module: 'chat:manager', action: 'cleanPidFiles' });
    });

    // 迁移：旧版项目路径 → 用户主目录（LIRI_HOME 统一后的一次性操作）
    await this._migrateHomeFromProjectToUser().catch((err) => {
      handleError(err, { module: 'chat:manager', action: 'migrateHome' });
    });

    // 启动会话活跃度追踪（心跳 + 并发控制）
    this.sessionAccess.ensureActivityTracker();

    // Worktree 存储隔离：迁移旧版会话到 worktree 路径
    try {
      const { migrateSessionsToWorktree } = await import('../core/paths.js');
      migrateSessionsToWorktree();
    } catch (err) {
      // 非阻塞
      handleError(err, { module: 'chat:manager', action: 'migrateSessions' });
    }

    // 连线 SessionLifecycle 事件 → 记忆/心跳自动化
    try {
      const { getGlobalEventBus } =
        await import('../session/lifecycle/SessionLifecycleEventBus.js');
      const { connectSessionHandlers } =
        await import('../session/lifecycle/SessionEventHandlers.js');
      connectSessionHandlers(getGlobalEventBus());
    } catch (err) {
      // 非阻塞：事件连线失败不影响主流程
      handleError(err, {
        module: 'chat:manager',
        action: 'connectSessionHandlers',
      });
    }

    // 启动回滚系统：清理中断轮次 + 配额管理
    await RollbackIntegration.onAppStart().catch((err) => {
      logger.warn('回滚系统初始化失败', { error: String(err) });
      // @ignore-catch — handleError已处理，异步抛错无需再处理
      handleError(err, {
        module: 'chat:ChatManager',
        action: 'rollback:onAppStart',
      }).catch(() => {});
    });

    // Phase 3: Durable Resume — 扫描并恢复中断的会话
    await this._resumePendingSessions().catch((err) => {
      logger.warn('Durable Resume 扫描失败', { error: String(err) });
      // 熔断：连续 3 次失败后跳过自动恢复
      this._resumeFailCount = (this._resumeFailCount ?? 0) + 1;
      if (this._resumeFailCount >= 3) {
        logger.warn('Durable Resume 已熔断 — 跳过后续自动恢复（需手动触发）', {
          failCount: this._resumeFailCount,
        });
      }
    });
    // 熔断恢复：启动 1 小时后重置失败计数
    if (this._resumeFailCount && this._resumeFailCount < 3) {
      setTimeout(() => {
        this._resumeFailCount = 0;
      }, 3600_000);
    }
  }

  /**
   * Durable Resume: 扫描文件系统上的 TAOR 检查点，恢复中断的会话。
   */
  private async _resumePendingSessions(): Promise<void> {
    try {
      const { resumeManager } = await import('../query/ResumeManager.js');
      const candidates = await resumeManager.scanPending();
      if (candidates.length === 0) {
        logger.info('Durable Resume: 无待恢复会话');
        return;
      }

      logger.info('Durable Resume: 发现待恢复会话', {
        count: candidates.length,
        sessions: candidates.map((c) => c.sessionId),
      });

      for (const candidate of candidates) {
        try {
          const cp = candidate.checkpoint;
          logger.info('Durable Resume: 恢复会话', {
            sessionId: cp.sessionId,
            checkpointId: cp.id,
            turnCount: cp.turnCount,
            phase: cp.phase,
            age: candidate.age,
          });

          // Phase 3: 进度事件
          resumeManager.emitProgress({
            phase: 'validating',
            sessionId: cp.sessionId,
            detail: `校验检查点 ${cp.id}...`,
          });
          const msgs = await this.sessionGateway.getMessages(cp.sessionId);
          const integrity = resumeManager.validateCheckpointIntegrity(
            cp,
            msgs.length,
            this.tokenBudget.getCurrentBudgetState().totalTokensUsed
          );
          const strategy = resumeManager.getRestoreStrategy(integrity);

          logger.info('Durable Resume: 完整性校验完成', {
            sessionId: cp.sessionId,
            ...strategy,
          });

          // 创建 TAORLoop 并从检查点恢复
          const taorLoop = this._getOrCreateTAORLoop(cp.sessionId);
          taorLoop.resumeFromCheckpoint(cp.id);

          // 注入恢复摘要 steering 消息
          const summary = [
            '[系统] 会话已从断点恢复。',
            `- 恢复时间点: ${new Date(cp.createdAt).toISOString()}`,
            `- 恢复阶段: ${cp.phase}（消息历史第 ${cp.turnCount} 轮）`,
            `- 恢复策略: ${strategy.reason}`,
            cp.inboxState
              ? `- Inbox 关联: ${cp.inboxState.pendingInboxItems.length} 项审批待处理`
              : '',
          ]
            .filter(Boolean)
            .join('\n');
          taorLoop.injectSteering(summary);

          logger.info('Durable Resume: 会话恢复完成', {
            sessionId: cp.sessionId,
            phase: cp.phase,
          });
        } catch (sessionErr) {
          logger.warn('Durable Resume: 单个会话恢复失败', {
            sessionId: candidate.sessionId,
            error: String(sessionErr),
          });
          // 不阻塞其他会话的恢复
        }
      }
    } catch (e) {
      handleError(e, {
        module: 'chat:manager',
        action: 'Durable Resume扫描待处理失败',
      });
      throw e;
    }
  }

  private async _loadSessionsFromGateway(): Promise<void> {
    try {
      const storedSessions = await this.sessionGateway.listSessions();
      for (const stored of storedSessions) {
        if (this._chatSessions.has(stored.id)) continue;
        try {
          const storedMessages = await this.sessionGateway.getMessages(
            stored.id
          );
          const messages: Message[] = storedMessages.map((m) => {
            let content: string;
            if (typeof m.content === 'string') {
              content = m.content;
            } else if (Array.isArray(m.content)) {
              const textBlocks = m.content.filter((b) => b.type === 'text');
              if (textBlocks.length > 0) {
                content = textBlocks
                  .map((b) => (b as { type: 'text'; text: string }).text)
                  .join('');
              } else {
                const toolResultBlock = m.content.find(
                  (b) => b.type === 'tool_result'
                );
                content = toolResultBlock
                  ? (
                      toolResultBlock as {
                        type: 'tool_result';
                        content: string;
                      }
                    ).content || ''
                  : '';
              }
            } else {
              content = '';
            }
            return {
              id: m.id,
              role: m.role,
              content,
              createdAt: new Date(m.timestamp),
              updatedAt: new Date(m.timestamp),
              sessionId: stored.id,
              toolCallId: m.metadata?.toolCallId,
              metadata: m.metadata as Record<string, unknown> | undefined,
              blocks: m.blocks as unknown as
                | Record<string, unknown>[]
                | undefined,
              tool_calls: m.metadata?.tool_calls,
            } as Message;
          });
          // 按消息 ID 去重（保留最后一份，它包含 blocks）
          const dedupMap = new Map<string, Message>();
          for (const msg of messages) {
            dedupMap.set(msg.id, msg);
          }
          const dedupedMessages = Array.from(dedupMap.values());
          // 从最新消息时间戳推导 updatedAt（磁盘上的 updatedAt 从未被更新，重启后恒为创建时间）
          let latestTimestamp = new Date(stored.updatedAt || stored.createdAt);
          for (const msg of dedupedMessages) {
            if (msg.createdAt > latestTimestamp) {
              latestTimestamp = msg.createdAt;
            }
          }
          const chatSession: ChatSession = {
            id: stored.id,
            title: stored.title,
            state: mapSessionStatusToState(stored.status),
            metadata: {
              title: stored.title || '',
              ...stored.metadata,
              totalMessages: dedupedMessages.length,
              lastActivityAt: new Date(stored.lastActivityAt),
            },
            messages: dedupedMessages,
            createdAt: new Date(stored.createdAt),
            updatedAt: latestTimestamp,
          };
          this._chatSessions.set(stored.id, chatSession);

          // Session State Hydration: 从 transcript 恢复衍生状态
          try {
            const hydrated = this.sessionAccess.hydrateSession(chatSession);
            if (hydrated.todos || (hydrated.recentFiles?.length ?? 0) > 0) {
              chatSession.metadata = {
                ...chatSession.metadata,
                hydratedTodos: hydrated.todos,
                hydratedRecentFiles: hydrated.recentFiles,
                hydratedDecisions: hydrated.recentDecisions,
              };
            }
          } catch (err) {
            // 回灌失败不影响会话加载
            handleError(err, {
              module: 'chat:manager',
              action: 'hydrateDecisions_loadSession',
            });
          }
        } catch (e) {
          logger.warn('加载单个会话失败，跳过', {
            sessionId: stored.id,
            error: String(e),
          });
          continue;
        }
      }
    } catch (e) {
      handleError(e, {
        module: 'chat:manager',
        action: '从Gateway加载会话失败',
      });
    }
  }

  /**
   * 从用户消息文本中提取绝对文件路径
   * 支持 Markdown 链接格式 [文件名](绝对路径) 和行内绝对路径
   * 仅返回存在于磁盘上且属于用户数据目录（attachments/output/downloads）的路径
   */
  private extractFilePathsFromText(text: string): string[] {
    const paths: string[] = [];
    if (!text || typeof text !== 'string') return paths;

    // 匹配 Markdown 链接: [name](path)
    const mdLinkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = mdLinkRegex.exec(text)) !== null) {
      const rawPath = match[2];
      if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
        paths.push(rawPath);
      }
    }

    // 匹配行内的绝对 Windows 路径（E:\... 或 C:\...）
    const absPathRegex = /([A-Za-z]:\\[^\s)\]]+)/g;
    while ((match = absPathRegex.exec(text)) !== null) {
      const rawPath = match[1];
      if (fs.existsSync(rawPath) && !paths.includes(rawPath)) {
        paths.push(rawPath);
      }
    }

    // 仅保留用户数据目录下的路径，避免注册系统路径
    const pyappHome = resolvePyappHome();
    const projectRoot = resolveProjectRoot();
    return paths.filter(
      (p) => p.startsWith(pyappHome) || p.startsWith(projectRoot)
    );
  }

  /**
   * 清理 API 消息列表中的孤立 tool_calls 和 tool 消息。
   *
   * DeepSeek API 要求：每个 assistant 含 tool_calls 之后，
   * 紧随其后的 tool 消息必须响应其所有 tool_call_id，
   * 中间不能插入非 tool 消息。
   *
   * 此方法从后往前遍历所有 assistant 含 tool_calls，
   * 逐条检查紧随其后的 tool 消息是否全部响应。
   */
  private _sanitizeApiMessages(apiMessages: Record<string, unknown>[]): void {
    sanitizeApiMessages(apiMessages);
  }

  /**
   * 将 ToolSchema[] 转换为 OpenAI 兼容的 ToolDefinition[]
   */
  private _buildToolDefinitions(schemas: ToolSchema[]): ToolDefinition[] {
    return schemas.map((schema) => ({
      type: 'function' as const,
      function: {
        name: schema.name,
        description: schema.description,
        parameters: {
          type: 'object' as const,
          properties:
            (schema.input_schema as { properties?: unknown })?.properties || {},
          required:
            (schema.input_schema as { required?: string[] })?.required || [],
        },
      },
    }));
  }

  /**
   * 上下文长度保护（委托给 MessageContextPipeline）
   * 压缩失败或压缩不足时退化为截断旧消息（保留 system prompt + 最近 N 条消息）。
   * 截断后重新 sanitize 以修复 tool/tool_calls 配对完整性。
   *
   * @param apiMessages - 待发送的消息列表（会被原地修改）
   * @param maxContextTokens - 模型上下文窗口上限（如 1_000_000），
   *       如果传入 0 或负数，则跳过滤检
   */
  private async _truncateApiMessages(
    apiMessages: Record<string, unknown>[],
    maxContextTokens: number,
    sessionId?: string
  ): Promise<void> {
    await truncateApiMessages(
      apiMessages,
      maxContextTokens,
      this._chatSessions,
      sessionId
    );
  }

  /**
   * 压缩工具循环历史消息（委托给 MessageContextPipeline）
   */
  private _compressToolHistory(
    currentRoundMessages: Record<string, unknown>[],
    sessionId: string,
    assistantMsg: Record<string, unknown>,
    toolResults: Record<string, unknown>[]
  ): Record<string, unknown>[] {
    const beforeTokens = this._estimateArrayTokens(currentRoundMessages);

    const result = compressToolHistory(
      currentRoundMessages,
      sessionId,
      assistantMsg,
      toolResults
    );

    const afterTokens = this._estimateArrayTokens(result);

    this.contextTracker.record({
      timestamp: Date.now(),
      turnCount: this._toolRoundCount,
      engineName: 'default',
      beforeTokens,
      afterTokens,
      compressionRatio: beforeTokens > 0 ? afterTokens / beforeTokens : 1,
      messageCountBefore: currentRoundMessages.length,
      messageCountAfter: result.length,
      hasFocusTopic: false,
    });

    return result;
  }

  /**
   * 估算消息数组的 token 数（简化为 JSON 长度 / 4）
   */
  private _estimateArrayTokens(messages: Record<string, unknown>[]): number {
    return Math.ceil(JSON.stringify(messages).length / 4);
  }

  /**
   * 注册停止钩子（预算告警 → 压缩/停止）
   */
  private _registerStopHooks(): void {
    this.stopHookManager.registerHook({
      name: 'token_budget_guard',
      priority: DEFAULT_STOP_HOOK_PRIORITIES.HIGH,
      hook: async (ctx) => {
        const status = this.tokenBudget.checkBudget();
        if (status === TokenBudgetStatus.EXCEEDED) {
          ctx.reason = 'aborted';
        }
      },
    });
  }

  /**
   * 跨轮对话摘要持久化（委托给 MessageContextPipeline）
   */
  private _persistTurnSummary(session: ChatSession): void {
    persistTurnSummary(session);
  }

  /**
   * 清理
   */
  cleanup(): void {
    taskOrchestrator
      .abortAll()
      .catch((e) =>
        logger.warn('cleanup: abortAll 失败', { error: String(e) })
      );
    for (const task of taskRegistry.getRunningTasks()) {
      task.kill().catch((e) =>
        logger.warn('cleanup: kill task 失败', {
          taskId: task.id,
          error: String(e),
        })
      );
    }
    taskRegistry
      .shutdown()
      .catch((e) =>
        logger.warn('cleanup: shutdown 失败', { error: String(e) })
      );
    this.streamService.reset();
  }

  /**
   * 发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 消息对象
   */
  async sendMessage(
    content: string,
    options?: SendMessageOptions
  ): Promise<Message> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性 — 检测到敏感数据时脱敏后继续，而非阻断
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'sendMessage',
      });
      content = securityService.sanitize(content);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 检查是否是命令
    if (content.startsWith('/')) {
      // 先获取或创建会话，以便将历史消息传入命令上下文
      const cmdSessionId = options?.sessionId || this._currentSessionId;
      const cmdSession = cmdSessionId
        ? await this._getOrLoadSession(cmdSessionId, options?.metadata)
        : undefined;

      const parts = content.slice(1).split(' ');
      const [commandName, ...args] = parts;

      let commandResult = '';
      const { commandExecutor } = await import('../commands/index.js');
      const result = await commandExecutor.execute(
        `/${commandName} ${args.join(' ')}`,
        {
          sessionId: options?.sessionId || 'chat-session',
          cwd: resolveProjectRoot(),
          messages: cmdSession?.messages || [],
        }
      );
      commandResult = result.message || result.value || '';

      // 创建命令执行结果消息
      const commandMessage = this.messageService.createAssistantMessage(
        commandResult,
        {
          sessionId: options?.sessionId,
          metadata: {
            isCommand: true,
            command: commandName,
          },
        }
      );

      // 添加到会话
      const resultSession = cmdSessionId
        ? await this._getOrLoadSession(cmdSessionId, options?.metadata)
        : undefined;

      if (resultSession) {
        this._addAndPersistMessage(resultSession.id, commandMessage);
      }

      return commandMessage;
    }

    // 获取或创建会话（统一 Gateway 降级加载）
    const sessionId = options?.sessionId || this._currentSessionId;
    if (!sessionId) {
      throw new AppError(
        'No session id provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    const session = await this._getOrLoadSession(sessionId, options?.metadata);
    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // Session Mutex: 防止同一会话并发请求
    let mutex = this._sessionMutexes.get(sessionId);
    if (!mutex) {
      mutex = new SimpleMutex();
      this._sessionMutexes.set(sessionId, mutex);
    }

    return mutex.run(async () => {
      // Phase 5+: 记忆初始化（新版 MemoryManagerImpl 自动初始化，无需手动调用）

      // 触发 ChatPreMessage Hook
      const preMsgResult = await this.hookChainManager.execute('chat', {
        event: 'chat.pre-message',
        data: { message: content, sessionId: session.id },
        sessionId: session.id,
      });
      for (const hr of preMsgResult.before) {
        if (
          hr.data &&
          typeof hr.data === 'object' &&
          'message' in (hr.data as Record<string, unknown>)
        ) {
          content = (hr.data as Record<string, string>).message;
        }
      }

      // 创建用户消息
      const userMessage = this.messageService.createUserMessage(content, {
        sessionId: session.id,
        metadata: options?.metadata,
      });

      // 持久化 roundCount（轮次数 = 用户消息数）
      session.metadata.roundCount = (session.metadata.roundCount ?? 0) + 1;

      // 添加消息到会话
      this._addAndPersistMessage(session.id, userMessage);

      // 通知会话状态变化为运行状态
      this.getSessionMachine(session.id).start('sendMessage');

      // OTel span
      const otel = getOTelTracing();
      const sendSpan = otel.startSpan('chat.sendMessage', {
        'session.id': session.id,
      });

      // 提升变量声明到 try 外部，确保 finally 块能正确调用 finish()
      let response: AIChatResponse;
      let assistantMessage: Message;
      try {
        // Phase 2: Trajectory 会话初始化
        if (this.ENABLE_TRAJECTORY) {
          try {
            trajectoryRecorder.startSession(session.id, options?.model);
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }
        if (this.ENABLE_TRAJECTORY) {
          try {
            trajectoryRuntime.startSession(session.id, options?.model);
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }

        // 准备消息列表
        const messages = session.messages;

        // 调用LLM客户端
        if (!this.llmClient) {
          throw new AppError(
            'LLM client not initialized',
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }

        const activeClient = this.getClientForModel(options?.model);

        // 准备消息列表（用于API调用）
        let apiMessages = messages.map((msg) => {
          // 对工具结果消息，若内容过大则截断，避免旧数据主导 LLM 上下文
          let content =
            typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);

          if (
            msg.role === 'tool' &&
            typeof content === 'string' &&
            content.length > TOOL_RESULT_MAX_LENGTH
          ) {
            content = truncateToolResult(content);
          }

          const chatMessage: Record<string, unknown> = {
            role: msg.role,
            content,
          };

          // 对于工具结果消息，确保添加 tool_call_id
          // 优先使用 msg.toolCallId，其次从 metadata 中查找
          // 只有在确实存在 tool_call_id 时才设置该字段，避免向 API 发送空值
          if (msg.role === 'tool') {
            const tcId =
              msg.toolCallId ||
              (msg.metadata?.toolCallId as string) ||
              (msg.metadata?.tool_call_id as string);
            if (tcId) {
              chatMessage.tool_call_id = tcId;
            }
          }

          // 对于助手消息，添加tool_calls（从metadata中读取）
          if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
            const toolCalls = msg.metadata.tool_calls as Record<
              string,
              unknown
            >[];
            chatMessage.tool_calls = toolCalls.map(
              (tc: Record<string, unknown>) => {
                if (tc.type && tc.function) {
                  return tc;
                }
                return {
                  id: tc.id,
                  type: 'function',
                  function: {
                    name: tc.name || 'unknown',
                    arguments:
                      typeof tc.arguments === 'string'
                        ? tc.arguments
                        : JSON.stringify(tc.arguments || {}),
                  },
                };
              }
            );
          }

          return chatMessage;
        });

        // 防止跨轮 tool_calls 污染：旧轮次的 tool_calls 会误导模型继续执行已完成的任务
        // 找到最后一条 user 消息之前的 assistant 消息，清除其 tool_calls
        // 后续 sanitizeApiMessages 会自动清理对应的孤立 tool 结果消息
        let lastUserMsgIdx = -1;
        for (let i = apiMessages.length - 1; i >= 0; i--) {
          if (apiMessages[i].role === 'user') {
            lastUserMsgIdx = i;
            break;
          }
        }
        // 清除最后一条 user 消息之前的所有 assistant 消息的 tool_calls
        for (let i = 0; i < lastUserMsgIdx; i++) {
          const msg = apiMessages[i];
          if (msg.role === 'assistant' && msg.tool_calls) {
            logger.info('清除旧轮次 assistant tool_calls，防止跨轮污染', {
              index: i,
              toolCallCount: (msg.tool_calls as unknown[]).length,
            });
            delete msg.tool_calls;
          }
        }

        // 将附带的图片路径以文本形式追加到用户消息中
        // 不嵌入 image_url 块（DeepSeek 等 Provider 不支持多模态），
        // 改为路径文本引用，由 AI 通过 image_analysis 工具分析
        if (options?.images && options.images.length > 0) {
          const imagesRoot = path.join(resolveOutputDir(), 'images');
          const lastUserMsg = [...apiMessages]
            .reverse()
            .find((m: Record<string, unknown>) => m.role === 'user');
          if (lastUserMsg && typeof lastUserMsg.content === 'string') {
            const imagePaths = options.images
              .map((img) => {
                const absolutePath = path.isAbsolute(img.path)
                  ? img.path
                  : path.resolve(imagesRoot, img.path);
                if (fs.existsSync(absolutePath)) return absolutePath;
                return null;
              })
              .filter(Boolean) as string[];

            if (imagePaths.length > 0) {
              lastUserMsg.content =
                lastUserMsg.content +
                '\n\n[附带的图片路径]\n' +
                imagePaths.map((p) => `- ${p}`).join('\n');
            }
          }

          // 注册图片路径到会话已知路径集合（使用绝对路径以匹配工具校验）
          const absoluteImagePaths = options.images.map((img) =>
            path.isAbsolute(img.path)
              ? img.path
              : path.resolve(imagesRoot, img.path)
          );
          this.imageContextService.registerImagePaths(
            options.sessionId || '',
            absoluteImagePaths
          );
        }

        // 从用户消息文本中提取文件路径并注册到已知路径集合
        // 文件上传（非图片按钮）的路径以 Markdown 链接形式嵌入到消息文本中
        {
          const lastUserMsgForPath = [...apiMessages]
            .reverse()
            .find(
              (m: Record<string, unknown>) =>
                m.role === 'user' && typeof m.content === 'string'
            );
          if (lastUserMsgForPath && options?.sessionId) {
            const textContent = lastUserMsgForPath.content as string;
            const extractedPaths = this.extractFilePathsFromText(textContent);
            if (extractedPaths.length > 0) {
              this.imageContextService.registerImagePaths(
                options!.sessionId,
                extractedPaths
              );
              logger.info('从用户消息文本中提取并注册文件路径', {
                sessionId: options!.sessionId,
                pathCount: extractedPaths.length,
              });
            }
          }
        }

        // 过滤孤立的 tool 消息（没有前置 tool_calls 的 assistant 消息）
        this._sanitizeApiMessages(apiMessages);

        // 获取工具定义
        const toolDefinitions: ToolDefinition[] = this.toolRegistry
          ? this._buildToolDefinitions(this.toolRegistry.getToolSchemas())
          : [];

        // 注入注册表查询工具（仅在当前会话有工具执行记录时）
        if (toolResultRegistry.getRoundCount(session.id) > 0) {
          toolDefinitions.push(
            ChatManagerImpl.QUERY_TOOL_GET_RESULT,
            ChatManagerImpl.QUERY_TOOL_LIST_CALLS
          );
        }

        const hasSystemMessage = apiMessages.some(
          (m: Record<string, unknown>) => m.role === 'system'
        );

        if (!hasSystemMessage) {
          const sysPrompt =
            options?.systemPrompt ||
            (await this.getOrAssembleSystemPrompt(session, content));
          apiMessages.unshift({ role: 'system', content: sysPrompt });
        }

        // 共享上下文：从 CombinedSessionGateway 加载所有通道的历史消息
        if (options?.useSharedContext) {
          try {
            const { getDIContainer } = await import('../core/DIContainer.js');
            const container = getDIContainer();
            if (container.has('combinedSessionGateway')) {
              const combinedGateway = container.resolve<any>(
                'combinedSessionGateway'
              );
              if (typeof combinedGateway.getMessages === 'function') {
                const sharedMessages = await combinedGateway.getMessages(
                  'shared-context',
                  { limit: 100 }
                );
                if (sharedMessages && sharedMessages.length > 0) {
                  const sharedApiMessages = sharedMessages.map(
                    (msg: { role: string; content: string | unknown[] }) => ({
                      role: msg.role === 'user' ? 'user' : 'assistant',
                      content:
                        typeof msg.content === 'string'
                          ? msg.content
                          : JSON.stringify(msg.content),
                    })
                  );
                  // 在系统消息之后、当前会话消息之前插入共享上下文
                  const sysMsgIndex = apiMessages.findIndex(
                    (m: Record<string, unknown>) => m.role === 'system'
                  );
                  if (sysMsgIndex >= 0) {
                    apiMessages.splice(
                      sysMsgIndex + 1,
                      0,
                      ...sharedApiMessages
                    );
                  } else {
                    apiMessages.unshift(...sharedApiMessages);
                  }
                }
              }
            }
          } catch (err) {
            // 共享上下文加载失败不影响主流程
            await handleError(err, {
              module: 'chat:manager',
              action: 'sharedContext_load',
            });
          }
        }

        // ─────────────────────────────────────────────────────────
        // 上下文长度保护：CompactionOrchestrator 三级渐进压缩
        //   Tier 1: MicroCompaction（无损移除过期 tool_result）
        //   Tier 2: SnipEngine（按轮次选择性裁剪）
        //   Tier 3: LLM Full Compaction（AI 摘要压缩）
        //   Fallback: _truncateApiMessages（粗暴截断）
        // ─────────────────────────────────────────────────────────
        const beforeCompact = estimateMessagesTokens(apiMessages);
        const compResult = await compactionOrchestrator.compact(
          apiMessages as unknown as import('../ai/models/types').ChatMessage[],
          { model: options?.model || '', sessionId: session.id }
        );
        if (compResult.applied) {
          apiMessages = compResult.messages as unknown as Record<
            string,
            unknown
          >[];
        } else {
          // 编排未生效 → fallback 到截断
          const maxCtx = resolveMaxContextTokens(options?.model);
          await this._truncateApiMessages(apiMessages, maxCtx, session.id);
        }

        // 通知压缩结果
        const afterTokens = estimateMessagesTokens(apiMessages);
        const savedPercent =
          afterTokens > 0
            ? Math.round((1 - afterTokens / beforeCompact) * 100)
            : 0;
        if (savedPercent > 0) {
          const displayMsg = `上下文已压缩: ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）`;
          logger.info('compaction:completed', {
            sessionId: session.id,
            before: beforeCompact,
            after: afterTokens,
            savedPercent,
          });
          options?.onProgress?.({
            stage: 'generating',
            message: displayMsg,
          });
          const sysMsg = createSystemMessage(
            `[上下文压缩] ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）, 策略: tiered`,
            { sessionId: session.id }
          );
          this._addAndPersistMessage(session.id, sysMsg);
          this.unifiedTracker.recordCompaction(beforeCompact, afterTokens);
        }

        // 校准：压缩后调用 checkBeforeRequest 设定 baselineInputTokens，
        // 后续 recordPostRequest 用真实 API usage 更新 calibrationFactor
        if (options?.model) {
          this.unifiedTracker.checkBeforeRequest(
            apiMessages as unknown as {
              role?: string;
              content?: string | unknown;
            }[],
            options.model,
            options?.maxTokens
          );
        }

        // 通知进度：开始 LLM 分析
        options?.onProgress?.({
          stage: 'analyzing',
          message: '正在分析问题...',
        });

        // Phase 2: Telemetry + Trajectory THINK 开始
        const llmStartTime = Date.now();
        if (this.ENABLE_TELEMETRY) {
          try {
            agentTelemetry.startTurn(
              session.id,
              options?.model ?? '',
              this._toolRoundCount + 1
            );
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }
        if (this.ENABLE_TRAJECTORY) {
          try {
            trajectoryRecorder.recordStep(session.id, {
              phase: 'thinking',
              input: content.slice(0, 500),
              modelName: options?.model,
            });
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }

        logger.debug('准备调用 activeClient.sendMessage', {
          constructor: activeClient?.constructor?.name as string,
          providerId: activeClient?.getProviderId(),
        });

        response = await activeClient.sendMessage(
          apiMessages as unknown as ChatMessage[],
          {
            ...options,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        this.recordChatResponseUsage(session.id, response.usage);

        // 异步记录使用量到 UsageStatsService + CostTracker + LLMTracker
        trackUsage(response, {
          model: options?.model || 'unknown',
          providerId: activeClient.getProviderId(),
          latencyMs: 0,
          isStreaming: false,
          sessionId: session.id,
        }).catch((err) => {
          logger.warn('用量记录失败', {
            error: err instanceof Error ? err.message : String(err),
          });
        });

        // Phase 5+: 记忆同步由 extractMemoryFromChat 统一处理（finally 块中调用）

        // Phase 2: Telemetry + Trajectory THINK 完成
        const llmDuration = Date.now() - llmStartTime;
        if (this.ENABLE_TELEMETRY) {
          try {
            agentTelemetry.recordTokens(
              session.id,
              response.usage?.prompt_tokens ?? 0,
              response.usage?.completion_tokens ?? 0
            );
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }
        if (this.ENABLE_TRAJECTORY) {
          try {
            trajectoryRecorder.recordStep(session.id, {
              phase: 'response',
              output:
                typeof response.content === 'string'
                  ? response.content.slice(0, 500)
                  : '',
              tokensUsed:
                (response.usage?.prompt_tokens ?? 0) +
                (response.usage?.completion_tokens ?? 0),
              durationMs: llmDuration,
            });
          } catch (err) {
            logger.debug('Telemetry recording skipped', {
              error: err instanceof Error ? err.message : String(err),
            });
            // @ignore-catch — handleError已处理，telemetry非关键路径
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'telemetry',
            }).catch(() => {});
          }
        }

        // 通知外部：本次 LLM 响应的词元用量
        if (options?.onUsage && response.usage) {
          const u = response.usage;
          const inputTokens = u.prompt_tokens ?? 0;
          const outputTokens = u.completion_tokens ?? 0;
          options.onUsage({
            inputTokens,
            outputTokens,
            cacheReadInputTokens: u.cache_read_input_tokens,
            cacheCreationInputTokens: u.cache_creation_input_tokens,
            totalTokens: inputTokens + outputTokens,
            // [v1.2] 使用统一定价计算，不再硬编码 3/15
            estimatedCostUsd: (() => {
              try {
                return calculateTotalCost(
                  getModelPricing(response.model ?? ''),
                  inputTokens,
                  outputTokens,
                  u.cache_creation_input_tokens ?? 0,
                  u.cache_read_input_tokens ?? 0
                );
              } catch {
                return 0;
              }
            })(),
          });
        }

        const rawContent =
          typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

        // 修复 AI 可能拼错的图片 URL，统一为 /v1/images/static/media/ 格式
        let assistantMessageContent = repairImageUrls(rawContent);

        // 剥离 think/response 标签，返回干净的用户可见内容
        assistantMessageContent = stripThinkResponseTags(
          assistantMessageContent
        );

        // 方案 1: 路径幻觉事后校验（dry-run 模式，只记录不修改文本）
        const pathGuardResult = await validatePathsInOutput(
          assistantMessageContent,
          this.imageContextService.confirmedPaths
        );
        if (pathGuardResult.corrections.length > 0) {
          // 后续稳定后可切换为 assistantMessageContent = pathGuardResult.text
        }

        const assistantMsg = this.messageService.createAssistantMessage(
          assistantMessageContent,
          {
            sessionId: session.id,
          }
        );
        assistantMessage = assistantMsg;
        assistantMessage.sessionId = session.id;
        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolCallsData = response.tool_calls.map(
            (tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })
          );
          assistantMessage.metadata = {
            ...assistantMessage.metadata,
            tool_calls: toolCallsData,
          };
        }
        this._addAndPersistMessage(session.id, assistantMessage);

        // 响应后自动提取记忆
        await this.extractMemoryFromChat(
          content,
          assistantMessageContent,
          session.id
        );

        // 触发 ChatPostMessage Hook
        await this.hookChainManager.execute('chat', {
          event: 'chat.post-message',
          data: { message: content, response, sessionId: session.id },
          sessionId: session.id,
        });

        // 处理工具调用 — 使用 while 循环支持多轮递归工具调用
        if (response.tool_calls && response.tool_calls.length > 0) {
          // P2-3: 按流量百分比灰度决定是否走 TAORLoop 路径
          if (this._shouldUseTAORLoop(session.id)) {
            logger.info('sendMessage 委托 TAORLoop 编排工具调用循环', {
              sessionId: session.id,
              toolCalls: response.tool_calls.length,
            });
            try {
              const taorLoop = this._getOrCreateTAORLoop(session.id);
              taorLoop.reset();
              const taorContext = this._buildTAORContext(
                session.id,
                toolDefinitions,
                options
              );
              const deps = createChatManagerTAORDeps(taorContext);
              // 将 apiMessages 转成 ChatMessage[] 格式传入 TAORLoop
              const taorMessages: ChatMessage[] = apiMessages.map((m) => ({
                role: (m.role as ChatMessage['role']) || 'user',
                content:
                  typeof m.content === 'string'
                    ? m.content
                    : JSON.stringify(m.content),
                ...(m.tool_call_id
                  ? { tool_call_id: m.tool_call_id as string }
                  : {}),
                ...(m.tool_calls
                  ? { tool_calls: m.tool_calls as ChatMessage['tool_calls'] }
                  : {}),
              }));

              const taorResult = await taorLoop.run(taorMessages, deps);
              logger.info('sendMessage TAORLoop 完成', {
                sessionId: session.id,
                turns: taorResult.turnCount,
                tokens: taorResult.totalTokens,
                reason: taorResult.stopReason,
              });

              // P0-2: 通知 AlwaysOnManager loop 已结束
              this.onTurnEnd?.();

              // TAORLoop 已通过 persistMessages 持久化消息，
              // 从会话中取最后一条 assistant 消息作为返回值
              const updatedSession = this._chatSessions.get(session.id);
              if (updatedSession) {
                const lastAssistant = [...updatedSession.messages]
                  .reverse()
                  .find((m) => m.role === 'assistant');
                if (lastAssistant) {
                  assistantMessage = lastAssistant;
                }
              }
            } catch (err) {
              await handleError(err, {
                module: 'chat:ChatManager',
                action: 'sendMessage_TAORLoop_fallback',
              });
              logger.warn('TAORLoop 执行失败，降级到逐工具执行', {
                sessionId: session.id,
                error: err instanceof Error ? err.message : String(err),
              });

              // 降级路径：逐个执行工具 + 手动调 LLM 获取最终回复
              try {
                for (const tc of response.tool_calls!) {
                  const toolResult = await this.executeTool(
                    {
                      id: tc.id,
                      name: tc.name,
                      arguments:
                        typeof tc.arguments === 'string'
                          ? JSON.parse(tc.arguments)
                          : tc.arguments,
                      sessionId: session.id,
                    },
                    { useErrorHandler: true }
                  );
                  apiMessages.push({
                    role: 'tool',
                    content: JSON.stringify(
                      toolResult.result ?? toolResult.error ?? ''
                    ),
                    tool_call_id: tc.id,
                  });
                }

                const fallbackResponse = await activeClient.sendMessage(
                  apiMessages as unknown as ChatMessage[],
                  options
                );
                const fallbackContent =
                  typeof fallbackResponse.content === 'string'
                    ? fallbackResponse.content
                    : JSON.stringify(fallbackResponse.content);
                assistantMessage = this.messageService.createAssistantMessage(
                  stripThinkResponseTags(fallbackContent),
                  { sessionId: session.id }
                );
                assistantMessage.sessionId = session.id;
                this._addAndPersistMessage(session.id, assistantMessage);
                options?.onProgress?.({
                  stage: 'completed',
                  message: '处理完成（降级路径）',
                });
              } catch (fallbackErr) {
                await handleError(fallbackErr, {
                  module: 'chat:manager',
                  action: 'TAORLoop降级路径也失败',
                });
                options?.onProgress?.({
                  stage: 'completed',
                  message: '处理异常，请重试',
                });
              }
            }
          }
        }

        // 检测是否存在 create_task_list 工具调用，进入计划编排模式
        if (
          !this._executingPlan &&
          response.tool_calls?.some((tc) => tc.name === 'create_task_list')
        ) {
          this._executingPlan = true;
          try {
            await this.executePlanSteps(session, options);
          } finally {
            this._executingPlan = false;
          }
        }

        // 通知进度：处理完成
        options?.onProgress?.({ stage: 'completed', message: '处理完成' });
      } catch (sendErr) {
        await handleError(sendErr, {
          module: 'chat:ChatManager',
          action: 'sendMessage',
          context: { sessionId: session.id },
        });
        // 构造错误消息返回，不重新抛出 — finally 确保锁释放
        response = {
          content: `处理请求时发生错误: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`,
          stop_reason: 'stop' as const,
          tool_calls: [],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          model: options?.model ?? '',
        };
        assistantMessage = this.messageService.createAssistantMessage(
          response.content,
          { sessionId: session.id }
        );
      } finally {
        // 通知会话状态变化为空闲状态（使用 finish 回到 IDLE，允许下一轮 start）
        this.getSessionMachine(session.id).finish('sendMessage完成');
        sendSpan.end();
      }

      // 跨轮对话摘要：保存关键决策
      this._persistTurnSummary(session);

      // Session Memory: 累计本轮 token + 工具调用，达到阈值则触发提炼
      this._accumulateSessionMemory(
        session.id,
        content,
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '',
        response.usage?.prompt_tokens || 0,
        response.tool_calls?.length || 0
      );

      // 检查是否需要触发 Council 辩论
      const shouldTriggerCouncil =
        session.metadata?.is_ultraplan_mode ||
        containsComplexKeywords(content) ||
        options?.metadata?.councilTriggeredManually;

      if (shouldTriggerCouncil) {
        // 异步启动 Council 辩论（不阻塞主流程）
        this.triggerCouncilDebate(
          session.metadata?.workspaceId || 'default',
          content,
          session.metadata?.context || ''
        ).catch((err) => {
          handleError(err, {
            module: 'chat:manager',
            action: 'Council辩论执行失败',
          });
        });

        // 将辩论通知追加到 AI 回复末尾
        assistantMessage.content += `\n\n> 🏛️ 理事会正在讨论此议题，请切换到"理事会"标签页查看辩论过程。`;
      }

      // Phase 2: Telemetry + Trajectory 完成
      if (this.ENABLE_TELEMETRY) {
        try {
          agentTelemetry.endTurn(session.id, 'completed');
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (this.ENABLE_TRAJECTORY) {
        try {
          trajectoryRecorder.recordStep(session.id, {
            phase: 'response',
            output:
              typeof assistantMessage.content === 'string'
                ? assistantMessage.content.slice(0, 500)
                : '',
          });
          trajectoryRecorder.completeSession(session.id);
          trajectoryRuntime.completeSession(session.id);
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return assistantMessage;
    });
  }

  /**
   * 响应后自动提取记忆
   */

  /**
   * 触发 Council 辩论（异步，不阻塞主流程）
   */
  private async triggerCouncilDebate(
    workspaceId: string,
    topic: string,
    context: string
  ): Promise<void> {
    const { getCouncilEngine } =
      await import('@modules/workspace/CouncilEngine');
    const { CouncilOrchestrator } =
      await import('@modules/workspace/CouncilOrchestrator');

    const engine = getCouncilEngine();
    const orchestrator = new CouncilOrchestrator(engine);

    await orchestrator.startCouncil(workspaceId, topic, context);
  }

  private async extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    try {
      const { MemoryManagerImpl } =
        await import('@modules/memory/MemoryManager');
      const mm = new MemoryManagerImpl();
      const memorableContent = `用户: ${userContent}\n助手: ${assistantContent}`;
      await mm.createMemory({
        content: memorableContent,
        metadata: {
          name: `会话 ${sessionId.slice(0, 8)} 对话`,
          description: '从对话中自动提取',
          type: 'conversation',
          tags: ['auto-extracted', sessionId],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      // 记忆提取失败不影响主流程
      handleError(err, { module: 'chat:manager', action: 'extractMemory' });
    }
  }

  /**
   * 记录 LLM 响应的令牌用量
   */
  private recordChatResponseUsage(
    _sessionId: string,
    usage: Record<string, number> | null | undefined
  ): void {
    if (!usage) return;
    const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) return;

    const totalTokens = inputTokens + outputTokens;
    this.tokenBudget.consumeTokens(totalTokens);
    // Phase 1c: 同步校准因子到 UnifiedTokenTracker
    this.unifiedTracker.recordPostRequest({
      usage: { inputTokens, outputTokens, totalTokens },
    });
    // 同步校准因子到 AutoCompactionPolicy（使压缩决策阈值更准确）
    compactionOrchestrator
      .getPolicy()
      .setCalibrationFactor(this.unifiedTracker.getCalibrationFactor());
  }

  /**
   * 执行单步提示（委托给 sendMessage，统一路径，批次4.3）
   * 不再维护独立的 LLM 调用 + 工具执行循环。
   */
  private async executeStepPrompt(
    prompt: string,
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    // 委托给 sendMessage，复用统一的 LLM 调用 + 工具循环（含 TAORLoop 支持）
    // 计划步骤内通常不触发 ask_user_question 等交互工具，
    // 若触发则 sendMessage 的 pendingInteraction 机制会保存状态并提前返回。
    await this.sendMessage(prompt, {
      ...options,
      sessionId: session.id,
    });
  }

  /**
   * 执行所有计划步骤（委托给 TaskFacade）
   */
  private async executePlanSteps(
    session: ChatSession,
    options?: SendMessageOptions
  ): Promise<void> {
    await this.taskFacade.executePlanSteps(
      session,
      (prompt, sess, opts) => this.executeStepPrompt(prompt, sess, opts),
      options
    );
  }

  /**
   * 构建工具定义列表
   */
  /**
   * 注册表查询工具：按 tool_call_id 获取完整工具执行结果
   */
  private static readonly QUERY_TOOL_GET_RESULT: ToolDefinition = {
    type: 'function',
    function: {
      name: 'get_tool_result',
      description:
        '查询此前某次工具调用的完整执行结果。当压缩摘要或上下文中的工具结果信息不足以支持后续决策时，使用此工具获取全部细节。参数 tool_call_id 来自 assistant 消息的 tool_calls 数组。',
      parameters: {
        type: 'object',
        properties: {
          tool_call_id: {
            type: 'string',
            description:
              '工具调用 ID（如 call_xxxx），来自 assistant 消息的 tool_calls 数组中的 id 字段',
          },
        },
        required: ['tool_call_id'],
      },
    },
  };

  /**
   * 注册表查询工具：列出当前会话的所有工具调用记录
   */
  private static readonly QUERY_TOOL_LIST_CALLS: ToolDefinition = {
    type: 'function',
    function: {
      name: 'list_tool_calls',
      description:
        '列出当前会话中所有已执行工具的调用记录，包括 tool_call_id、工具名称和所属轮次。可指定 round 参数按轮次过滤。使用 get_tool_result 基于返回的 tool_call_id 查询完整详情。',
      parameters: {
        type: 'object',
        properties: {
          round: {
            type: 'number',
            description:
              '可选，指定轮次号（从 1 开始）。不传时返回全部轮次记录。',
          },
        },
        required: [],
      },
    },
  };

  /**
   * P2-3.5: 将 session.messages 转换为 API 格式消息列表
   *
   * 提取自 streamMessage，处理工具结果截断、tool_call_id 补全、
   * 跨轮 tool_calls 清理等纯数据转换逻辑。
   */
  private _buildApiMessagesForStream(
    messages: Message[]
  ): Array<Record<string, unknown>> {
    const apiMessages = messages.map((msg) => {
      let content =
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content);

      if (
        msg.role === 'tool' &&
        typeof content === 'string' &&
        content.length > TOOL_RESULT_MAX_LENGTH
      ) {
        content = truncateToolResult(content);
      }

      const chatMessage: Record<string, unknown> = {
        role: msg.role,
        content,
      };

      if (msg.role === 'tool') {
        const tcId =
          msg.toolCallId ||
          (msg.metadata?.toolCallId as string) ||
          (msg.metadata?.tool_call_id as string);
        if (tcId) {
          chatMessage.tool_call_id = tcId;
        }
      }

      if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
        const toolCalls = msg.metadata.tool_calls as Record<string, unknown>[];
        chatMessage.tool_calls = toolCalls.map(
          (tc: Record<string, unknown>) => {
            if (tc.type && tc.function) {
              return tc;
            }
            return {
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            };
          }
        );
      }

      return chatMessage;
    });

    // 防止跨轮 tool_calls 污染
    let lastUserMsgIdx = -1;
    for (let i = apiMessages.length - 1; i >= 0; i--) {
      if (apiMessages[i].role === 'user') {
        lastUserMsgIdx = i;
        break;
      }
    }
    for (let i = 0; i < lastUserMsgIdx; i++) {
      const msg = apiMessages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        logger.info('清除旧轮次 assistant tool_calls，防止跨轮污染', {
          index: i,
          toolCallCount: (msg.tool_calls as unknown[]).length,
        });
        delete msg.tool_calls;
      }
    }

    return apiMessages;
  }

  /**
   * P2-3.5: 流式消息预处理 — 会话准备、安全检查、Mutex 获取
   *
   * 提取自 streamMessage，返回 streamMessage 后续阶段所需的上下文对象。
   */
  private async _prepareStreamSession(
    content: string,
    options?: StreamMessageOptions
  ): Promise<{
    content: string;
    session: ChatSession;
    streamAbortController: AbortController;
    streamingCheckpoint: StreamingAutoCheckpoint;
    mutex: SimpleMutex;
    userMessage: Message;
    streamSpan: ReturnType<typeof getOTelTracing> extends {
      startSpan: (...args: any[]) => infer S;
    }
      ? S
      : never;
  }> {
    // 清理用户输入，防止XSS和隐藏字符攻击
    content = recursivelySanitizeUnicode(content) as string;

    // 验证输入安全性
    const validationResult = securityService.validateInput(content);
    if (!validationResult.valid) {
      logger.warn('用户输入包含敏感数据，已自动脱敏处理', {
        module: 'chat:manager',
        action: 'streamMessage',
      });
      content = securityService.sanitize(content);
      securityService.logSecurityError({
        type: SensitiveErrorType.SENSITIVE_DATA_DETECTED,
        message: '用户输入包含敏感数据，已自动脱敏处理',
      });
    }

    // 获取或创建会话
    const sessionId = options?.sessionId || this._currentSessionId;
    if (!sessionId) {
      throw new AppError(
        'No session id provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    const session = await this._getOrLoadSession(sessionId, options?.metadata);
    if (!session) {
      throw new AppError(
        'No session found or created',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 根据实际模型更新 token 预算
    if (options?.model) {
      this.unifiedTracker.onModelSwitch(options.model);
    }

    // 中止同一会话的旧流
    const existingAbort = this._sessionAbortControllers.get(session.id);
    if (existingAbort) {
      logger.info('中止同一会话的旧流式请求', { sessionId: session.id });
      existingAbort.abort();
      await new Promise((r) => setTimeout(r, 100));
    }
    const streamAbortController = new AbortController();
    this._sessionAbortControllers.set(session.id, streamAbortController);

    // P2-1: 初始化流式自动检查点
    const streamingCheckpoint = new StreamingAutoCheckpoint(
      this._checkpointService,
      session.id
    );
    this._streamingCheckpoint = streamingCheckpoint;

    // 获取会话互斥锁（仅保护工具执行循环，setup 阶段无需锁）
    let mutex = this._sessionMutexes.get(session.id);
    if (!mutex) {
      mutex = new SimpleMutex();
      this._sessionMutexes.set(session.id, mutex);
    }

    // 触发 ChatPreMessage Hook
    const preMsgResult = await this.hookChainManager.execute('chat', {
      event: 'chat.pre-message',
      data: { message: content, sessionId: session.id },
      sessionId: session.id,
    });
    for (const hr of preMsgResult.before) {
      if (
        hr.data &&
        typeof hr.data === 'object' &&
        'message' in (hr.data as Record<string, unknown>)
      ) {
        content = (hr.data as Record<string, string>).message;
      }
    }

    // 创建用户消息
    const userMessage = this.messageService.createUserMessage(content, {
      sessionId: session.id,
      metadata: options?.metadata,
    });

    session.metadata.roundCount = (session.metadata.roundCount ?? 0) + 1;
    this._addAndPersistMessage(session.id, userMessage);
    this.getSessionMachine(session.id).start('processUserInput');

    // OTel span
    const otel = getOTelTracing();
    const streamSpan = otel.startSpan('chat.streamMessage', {
      'session.id': session.id,
    });

    // Phase 2: Trajectory 会话初始化
    if (this.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.startSession(session.id, options?.model);
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        trajectoryRuntime.startSession(session.id, options?.model);
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      content,
      session,
      streamAbortController,
      streamingCheckpoint,
      mutex,
      userMessage,
      streamSpan,
    };
  }

  /**
   * P2-3.5: 流式消息最终化 — 清理资源 + 持久化 + 构建返回消息
   *
   * 提取自 streamMessage 的 finally 块和最终 return 逻辑。
   */
  private async _finalizeStreamMessage(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: ChatResponse | null,
    streamAbortController: AbortController,
    streamSpan: ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
    options?: StreamMessageOptions
  ): Promise<Message> {
    // Phase 1c: 停止流式水位监测
    this.unifiedTracker.stopStreamingCheck();
    // 通知会话状态变化为空闲状态
    this.getSessionMachine(session.id).finish('工具执行完成');
    getOTelTracing().endSpan(streamSpan, SpanStatusCode.OK);

    // Bug Fix: 清理 AbortController（当前流已完成，允许新请求）
    if (
      this._sessionAbortControllers.get(session.id) === streamAbortController
    ) {
      this._sessionAbortControllers.delete(session.id);
    }

    // 跨轮对话摘要：保存关键决策
    this._persistTurnSummary(session);

    // Session Memory: 累计本轮数据，达到阈值则触发提炼
    this._accumulateSessionMemory(
      session.id,
      content,
      accumulatedContent,
      finalResponse?.usage?.inputTokens || 0,
      finalResponse?.tool_calls?.length || 0
    );

    options?.onComplete?.(assistantMessage);

    // 隐性引擎钩子：项目会话的消息完成后，触发 Plan/Do/Check/Act 分析
    // P0-4: 优先使用 projectId（项目上下文），兜底 workspaceId（UI 环境）
    const contextId =
      (session.metadata?.projectId as string | undefined) ??
      (session.metadata?.workspaceId as string | undefined);
    if (contextId && assistantMessage.content) {
      ImplicitEngineHook.persist(
        contextId,
        assistantMessage.content as string,
        undefined,
        session.id
      )
        .then((result) => {
          // P0: 自动建项目 — 检测到 goal + deliverable 且会话未关联项目时自动创建
          // P3-1: 用户消息含明确项目意图时降阈值为 1，否则保持 2
          const userMessages =
            session.messages?.filter((m) => m.role === 'user') ?? [];
          const lastUserContent =
            userMessages.length > 0
              ? (((
                  userMessages[userMessages.length - 1] as unknown as Record<
                    string,
                    unknown
                  >
                ).content as string) ?? '')
              : '';
          const hasExplicitIntent =
            /(?:帮我|我要|我想|给我)\s*(?:做|开发|规划|设计|建|创建|写|整理|实现|搭建|部署)/.test(
              lastUserContent
            );
          const deliverableThreshold = hasExplicitIntent ? 1 : 2;

          if (
            result.hasGoal &&
            result.deliverables >= deliverableThreshold &&
            !session.metadata?.projectId
          ) {
            this._autoCreateProject(session, contextId, result).catch(() => {
              /* 自动建项目失败不阻塞消息流 */
            });
          }

          // 升级通道：检测到目标时自动发起完整 PDCA 循环（仅显式 create_project 路径触发）
          if (result.hasGoal && session.metadata?.projectId) {
            this._launchImplicitPdca(
              session.metadata.projectId as string,
              assistantMessage.content as string,
              session.id
            ).catch(() => {});
          }
        })
        .catch(() => {
          /* 隐性引擎失败不阻塞消息流 */
        });
    }

    // Phase 2: Telemetry + Trajectory 完成
    if (this.ENABLE_TELEMETRY) {
      try {
        agentTelemetry.endTurn(session.id, 'completed');
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // S6: 会话摘要生成（异步，不阻塞消息流）
    if (session.metadata?.projectId) {
      this._generateSessionSummary(session, assistantMessage).catch(() => {
        /* 摘要生成失败不阻塞 */
      });
    }

    if (this.ENABLE_TRAJECTORY) {
      try {
        trajectoryRecorder.recordStep(session.id, {
          phase: 'response',
          output:
            typeof assistantMessage.content === 'string'
              ? assistantMessage.content.slice(0, 500)
              : '',
        });
        trajectoryRecorder.completeSession(session.id);
        trajectoryRuntime.completeSession(session.id);
      } catch (err) {
        logger.debug('Telemetry recording skipped', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // P4-fix: 等待所有未完成的持久化完成后再返回（WAP 规范）
    await this.flushPendingPersists();

    // P2-1: 流正常结束，清理自动检查点
    this._streamingCheckpoint = null;

    return assistantMessage;
  }

  /**
   * 隐性引擎升级通道：检测到 goal 后自动发起完整 PDCA 循环
   * 隐性模式：requirePlanApproval=false，结果写入讨论记录（internal trail）
   */
  private async _launchImplicitPdca(
    projectId: string,
    description: string,
    sessionId: string
  ): Promise<void> {
    const taskId = `pdca_${Date.now().toString(36)}`;
    const now = new Date().toISOString();

    try {
      // 写入检查点
      const { writePdcaCheckpoint } =
        await import('../tasks/PdcaWorkItemBridge');
      writePdcaCheckpoint(taskId, {
        taskId,
        status: 'started',
        description,
        sessionId,
        workspaceId: projectId,
        autoLaunched: true,
      });

      // 关联到项目 pdcaIds（通过 ProjectStore 统一 API，不再硬编码路径）
      try {
        const dataDir = resolveDataDir();
        const wiStore = new WorkItemStore(dataDir);
        const pjStore = createProjectStore(dataDir, wiStore);
        if (!pjStore.listPdcaIds(projectId).includes(taskId)) {
          pjStore.addPdca(projectId, taskId);
        }
      } catch {
        /* skip */
      }

      // 启动编排器（隐性模式：不需要审批，不打断用户）
      const { getOrCreateOrchestrator } =
        await import('../tasks/LongRunningTaskOrchestrator');
      const orchestrator = getOrCreateOrchestrator(taskId);
      void orchestrator
        .runFullPdca(description, sessionId, {
          requirePlanApproval: false,
        })
        .catch((e) => {
          logger.error('隐性 PDCA 执行失败', {
            taskId,
            projectId,
            error: (e as Error)?.message ?? String(e),
          });
        });
    } catch {
      /* 隐性 PDCA 启动失败不影响主流程 */
    }
  }

  /**
   * P0 跨会话去重：提取关键词集合（归一化后分词）
   */
  private _extractKeywords(text: string): Set<string> {
    if (!text) return new Set();
    const normalized = text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 10);
    return new Set(normalized);
  }

  /**
   * P3-2: Jaccard 相似度 — 替代精确 hash 匹配，语义相近项目可被识别
   */
  private _jaccardSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const k of a) {
      if (b.has(k)) intersection++;
    }
    return intersection / (a.size + b.size - intersection);
  }

  /**
   * P0: 自动建项目 — 检测到 goal + deliverables 时静默创建项目
   * 不启动 PDCA，不打断用户，仅关联 session 并弹 toast 提示
   */
  private async _autoCreateProject(
    session: ChatSession,
    workspaceId: string | undefined,
    result: { hasGoal: boolean; deliverables: number; goalSummary?: string }
  ): Promise<void> {
    try {
      const dataDir = resolveDataDir();
      const workItemStore = new WorkItemStore(dataDir);
      const projectStore = createProjectStore(dataDir, workItemStore);

      // 项目名：优先使用引擎提取的 goal 摘要，否则用产出物数生成默认名
      const projectName =
        result.goalSummary || `项目 ${result.deliverables} 个产出`;
      const newKeywords = this._extractKeywords(projectName);
      if (newKeywords.size > 0) {
        const existingProjects = projectStore.list(workspaceId ?? 'default');
        const matched = existingProjects.find((p) => {
          const pKeywords = this._extractKeywords(p.description ?? p.name);
          return this._jaccardSimilarity(newKeywords, pKeywords) >= 0.6;
        });
        if (matched) {
          // 命中已有项目：关联 session，不新建
          if (!session.metadata) {
            (session as unknown as Record<string, unknown>).metadata = {};
          }
          session.metadata.projectId = matched.id;
          logger.info('P0 跨会话去重 — 关联到已有项目', {
            existingProjectId: matched.id,
            sessionId: session.id,
          });
          return;
        }
      }

      const project = projectStore.create({
        workspaceId: workspaceId ?? 'default',
        name: projectName,
        description:
          result.goalSummary || `自动创建：${result.deliverables} 个产出物`,
        delaySandbox: true,
      });

      // 关联 session 到新项目
      if (!session.metadata) {
        (session as unknown as Record<string, unknown>).metadata = {};
      }
      session.metadata.projectId = project.id;

      // S5b: 写入项目上下文文件（供 system prompt 读取）
      // P0: 迁移已有 context/artifacts 到新项目目录
      try {
        const {
          mkdirSync,
          copyFileSync,
          existsSync: _exists,
        } = await import('fs');
        const projDir = join(dataDir, 'projects', project.id);
        mkdirSync(projDir, { recursive: true });
        writeFileSync(
          join(projDir, 'project-context.md'),
          `## 项目上下文\n\n**名称**: ${project.name}\n**目标**: ${project.description}\n**文件夹**: ${project.sandboxPath}\n**创建时间**: ${project.createdAt}\n`,
          'utf-8'
        );

        // P0 context 迁移：复制 ImplicitEngineHook 已写入的 rules/artifacts
        // S2 上线前：物理复制（S2 后改为 items.db 引用）
        if (workspaceId) {
          const srcDir = join(homedir(), '.pyapp', 'projects', workspaceId);
          for (const file of ['rules.md', 'artifacts.json']) {
            const srcPath = join(srcDir, file);
            const dstPath = join(projDir, file);
            if (_exists(srcPath) && !_exists(dstPath)) {
              copyFileSync(srcPath, dstPath);
            }
          }
        }
      } catch {
        /* 写上下文文件失败不影响主流程 */
      }

      logger.info('P0 自动建项目', {
        projectId: project.id,
        sessionId: session.id,
        deliverables: result.deliverables,
      });

      // P0 增强：通知前端导航到新项目
      eventNotificationService.emitCustomEvent('project:auto_created', {
        projectId: project.id,
        name: project.name,
      });
      // P0b-3: 同步广播到全局 SSE 事件总线，前端 worktree 同步创建
      try {
        const { broadcastEvent } =
          await import('../infrastructure/http/LocalHTTPServiceSSE');
        broadcastEvent('project:auto_created', {
          projectId: project.id,
          name: project.name,
        });
      } catch {
        /* SSE 广播失败不影响主流程 */
      }
    } catch (e) {
      logger.warn('P0 自动建项目失败', {
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  /**
   * S6: 生成会话摘要 + 决策记录 + 阶段性小结
   *
   * 三级沉淀：
   * 1. 会话摘要 — 每轮对话后生成，提取式 + 预留 LLM 接口
   * 2. 决策记录 — 检测用户做出选择/决定时自动提取
   * 3. 阶段性小结 — 同一项目累计 3 次会话摘要后触发
   *
   * 持久化到 projects/<id>/summaries.json
   */
  private async _generateSessionSummary(
    session: ChatSession,
    assistantMessage: Message
  ): Promise<void> {
    const messageCount = session.messages?.length ?? 0;
    if (messageCount < 3) return;

    try {
      const projectId = session.metadata?.projectId as string | undefined;
      if (!projectId) return;

      // S2: 惰性迁移
      try {
        const { ProjectItemStore } =
          await import('../workspace/ProjectItemStore.js');
        const itemStore = new ProjectItemStore(projectId);
        if (itemStore.needsMigration()) {
          await itemStore.initialize();
          const { migrated } = await itemStore.migrateFromLegacy();
          if (migrated > 0) {
            logger.info('S2 惰性迁移完成', { projectId, migrated });
          }
          await itemStore.close();
        }
      } catch {
        /* 迁移失败不影响 */
      }

      const messages = session.messages ?? [];
      let lastUserContent = '';
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          lastUserContent =
            ((messages[i] as unknown as Record<string, unknown>)
              .content as string) ?? '';
          break;
        }
      }

      const assistantContent =
        typeof assistantMessage.content === 'string'
          ? assistantMessage.content
          : '';

      // ─── 0. 5 分钟合并检查（避免重复 LLM 调用）───
      const {
        readFileSync: _readFs,
        writeFileSync: _writeFs,
        existsSync: _existsFs,
        mkdirSync: _mkdirFs,
      } = await import('fs');
      const projDir = join(resolveDataDir(), 'projects', projectId);
      if (!_existsFs(projDir)) {
        _mkdirFs(projDir, { recursive: true });
      }
      const summariesPath = join(projDir, 'summaries.json');
      interface SummaryEntry {
        sessionId: string;
        summary: string;
        messageCount: number;
        createdAt: string;
        decision?: string;
        phaseSummary?: boolean;
      }
      let summaries: SummaryEntry[] = [];
      if (_existsFs(summariesPath)) {
        try {
          summaries = JSON.parse(_readFs(summariesPath, 'utf-8'));
        } catch {
          /* 重建 */
        }
      }

      if (summaries.some((s) => s.sessionId === session.id)) return;

      const lastSessionSummary = summaries
        .filter((s) => !s.phaseSummary)
        .slice(-1)[0];
      if (lastSessionSummary) {
        const lastTime = new Date(lastSessionSummary.createdAt).getTime();
        if (Date.now() - lastTime < 5 * 60 * 1000) {
          // 合并到上一条摘要：跳过 LLM 调用，仅更新消息计数
          lastSessionSummary.messageCount += messageCount;
          lastSessionSummary.createdAt = new Date().toISOString();
          _writeFs(summariesPath, JSON.stringify(summaries, null, 2), 'utf-8');
          logger.debug('S6 5分钟内连续会话，合并摘要（跳过 LLM）', {
            sessionId: session.id,
            mergedInto: lastSessionSummary.sessionId,
          });
          return;
        }
      }

      // ─── 1. 会话摘要（LLM 优先，提取式兜底） ───
      const userBrief = lastUserContent.slice(0, 500).replace(/\n/g, ' ');
      const aiBrief = assistantContent.slice(0, 500).replace(/\n/g, ' ');

      let summary = lastUserContent
        ? `用户问"${userBrief.slice(0, 80)}${lastUserContent.length > 80 ? '...' : ''}" — AI 回应：${aiBrief.slice(0, 120)}${assistantContent.length > 120 ? '...' : ''}`
        : aiBrief.slice(0, 200);

      // 尝试 LLM 摘要
      if (this.llmClient) {
        try {
          const llmResponse = await this.llmClient.chat([
            {
              role: 'system' as const,
              content:
                '你是一个项目助理。用1-2句话概括以下对话的核心内容（不含任何前缀，直接输出摘要）：',
            },
            {
              role: 'user' as const,
              content: `用户：${userBrief}\nAI：${aiBrief}`,
            },
          ]);
          const llmSummary = (llmResponse.content as string)?.trim();
          if (llmSummary && llmSummary.length > 5) {
            summary = llmSummary;
          }
        } catch {
          /* LLM 失败回退提取式 */
        }
      }

      // ─── 2. 决策检测 ───
      let decision: string | null = null;
      const decisionKeywords =
        /(决定|选择|采用|确定|选定)(?!不了|不下来|哪个|什么|谁|怎样|如何)/;
      if (decisionKeywords.test(lastUserContent)) {
        const decisionMatch = lastUserContent.match(
          /(?:决定|选择|采用|确定|选定).{0,50}/
        );
        if (decisionMatch) {
          decision = `用户决定：${decisionMatch[0].slice(0, 100)}`;
        }
      }

      // ─── 3. 持久化 ───
      const entry: SummaryEntry = {
        sessionId: session.id,
        summary,
        messageCount,
        createdAt: new Date().toISOString(),
      };
      if (decision) {
        entry.decision = decision;
      }
      summaries.push(entry);

      // ─── 3. 阶段性小结（3 次会话后触发） ───
      const sessionSummaries = summaries.filter((s) => !s.phaseSummary);
      if (sessionSummaries.length >= 3 && sessionSummaries.length % 3 === 0) {
        const recentSummaries = sessionSummaries.slice(-3);
        const phaseText = recentSummaries
          .map((s, i) => `${i + 1}. ${s.summary}`)
          .join('\n');

        let phaseSummary = `项目阶段性小结（最近 ${recentSummaries.length} 次会话）：
${phaseText}`;

        // 尝试 LLM 生成综合摘要
        if (this.llmClient) {
          try {
            const llmResponse = await this.llmClient.chat([
              {
                role: 'system' as const,
                content:
                  '你是一个项目助理。根据以下最近几次会话摘要，写一段3-5句话的项目阶段性小结，概括主要进展、关键决策和待办事项。',
              },
              { role: 'user' as const, content: phaseText },
            ]);
            const llmPhaseSummary = (llmResponse.content as string)?.trim();
            if (llmPhaseSummary && llmPhaseSummary.length > 10) {
              phaseSummary = `项目阶段性小结（最近 ${recentSummaries.length} 次会话）：

${llmPhaseSummary}`;
            }
          } catch {
            /* LLM 失败回退拼接 */
          }
        }

        summaries.push({
          sessionId: `phase_${Date.now()}`,
          summary: phaseSummary,
          messageCount: recentSummaries.reduce(
            (sum, s) => sum + s.messageCount,
            0
          ),
          createdAt: new Date().toISOString(),
          phaseSummary: true,
        });

        logger.info('S6 阶段性小结已生成', {
          projectId,
          sessionCount: sessionSummaries.length,
        });
      }

      if (summaries.length > 50) {
        summaries = summaries.slice(-50);
      }

      _writeFs(summariesPath, JSON.stringify(summaries, null, 2), 'utf-8');

      const hasDecision = decision ? ' + 决策' : '';
      logger.info(`S6 会话摘要已生成${hasDecision}`, {
        sessionId: session.id,
        projectId,
        messageCount,
        totalSummaries: sessionSummaries.length + 1,
      });
    } catch (e) {
      logger.warn('S6 会话摘要生成失败', {
        sessionId: session.id,
        error: (e as Error)?.message ?? String(e),
      });
    }
  }

  /**
   * 流式发送消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流数据块
   */
  async *streamMessage(
    content: string,
    options?: StreamMessageOptions
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    // P2-3.5: 流式消息预处理（提取为 _prepareStreamSession）
    const ctx = await this._prepareStreamSession(content, options);
    content = ctx.content;
    const session = ctx.session;
    const streamAbortController = ctx.streamAbortController;
    const streamingCheckpoint = ctx.streamingCheckpoint;
    const mutex = ctx.mutex;
    const userMessage = ctx.userMessage;
    const streamSpan = ctx.streamSpan;
    // OTel P4: try/finally 确保 streamSpan 在异常/提前终止时不会泄漏
    try {
      // P2-3.5: 构建 API 格式消息列表（提取为 _buildApiMessagesForStream）
      let apiMessages = this._buildApiMessagesForStream(session.messages);

      // 将附带的图片路径以文本形式追加到用户消息中
      // 不嵌入 image_url 块（DeepSeek 等 Provider 不支持多模态），
      // 改为路径文本引用，由 AI 通过 image_analysis 工具分析
      if (options?.images && options.images.length > 0) {
        const imagesRoot = path.join(resolveOutputDir(), 'images');
        const lastUserMsg = [...apiMessages]
          .reverse()
          .find((m: Record<string, unknown>) => m.role === 'user');
        if (lastUserMsg && typeof lastUserMsg.content === 'string') {
          const imagePaths = options.images
            .map((img) => {
              const absolutePath = path.isAbsolute(img.path)
                ? img.path
                : path.resolve(imagesRoot, img.path);
              if (fs.existsSync(absolutePath)) return absolutePath;
              return null;
            })
            .filter(Boolean) as string[];

          if (imagePaths.length > 0) {
            lastUserMsg.content =
              lastUserMsg.content +
              '\n\n[附带的图片路径]\n' +
              imagePaths.map((p) => `- ${p}`).join('\n');
          }
        }

        // 注册图片路径到会话已知路径集合（使用绝对路径以匹配工具校验）
        const absoluteImagePaths = options.images.map((img) =>
          path.isAbsolute(img.path)
            ? img.path
            : path.resolve(imagesRoot, img.path)
        );
        this.imageContextService.registerImagePaths(
          options.sessionId || '',
          absoluteImagePaths
        );
      }

      // 从用户消息文本中提取文件路径并注册到已知路径集合
      // 文件上传（非图片按钮）的路径以 Markdown 链接形式嵌入到消息文本中，
      // 但未通过 options.images 传递，需要在此处补充注册
      {
        const lastUserMsgForPath = [...apiMessages]
          .reverse()
          .find(
            (m: Record<string, unknown>) =>
              m.role === 'user' && typeof m.content === 'string'
          );
        if (lastUserMsgForPath && options?.sessionId) {
          const textContent = lastUserMsgForPath.content as string;
          const extractedPaths = this.extractFilePathsFromText(textContent);
          if (extractedPaths.length > 0) {
            this.imageContextService.registerImagePaths(
              options!.sessionId,
              extractedPaths
            );
            logger.info('从用户消息文本中提取并注册文件路径', {
              sessionId: options!.sessionId,
              pathCount: extractedPaths.length,
            });
          }
        }
      }

      this._sanitizeApiMessages(apiMessages);

      // 获取工具定义
      const toolDefinitions: ToolDefinition[] = this.toolRegistry
        ? this._buildToolDefinitions(this.toolRegistry.getToolSchemas())
        : [];

      // 注入注册表查询工具（仅在当前会话有工具执行记录时）
      if (toolResultRegistry.getRoundCount(session.id) > 0) {
        toolDefinitions.push(
          ChatManagerImpl.QUERY_TOOL_GET_RESULT,
          ChatManagerImpl.QUERY_TOOL_LIST_CALLS
        );
      }

      // 触发 ChatPreStream Hook
      await this.hookChainManager.execute('chat', {
        event: 'chat.pre-stream',
        data: { message: content, sessionId: session.id },
        sessionId: session.id,
      });

      const hasSystemMessage = apiMessages.some(
        (m: Record<string, unknown>) => m.role === 'system'
      );
      if (!hasSystemMessage) {
        const sysPrompt =
          options?.systemPrompt ||
          (await this.getOrAssembleSystemPrompt(session, content));
        apiMessages.unshift({ role: 'system', content: sysPrompt });
      }

      let assistantMessage: Message | undefined;
      let accumulatedContent = '';
      let finalResponse: ChatResponse | null = null;

      if (!this.llmClient) {
        throw new AppError(
          'LLM client not initialized',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      const activeClient = this.getClientForModel(options?.model);

      // ─────────────────────────────────────────────────────────
      // 上下文长度保护：CompactionOrchestrator 三级渐进压缩
      // ─────────────────────────────────────────────────────────
      const beforeCompact = estimateMessagesTokens(apiMessages);
      try {
        const compResult = await compactionOrchestrator.compact(
          apiMessages as unknown as import('../ai/models/types').ChatMessage[],
          { model: options?.model || '', sessionId: session.id }
        );
        if (compResult.applied) {
          apiMessages = compResult.messages as unknown as Record<
            string,
            unknown
          >[];
        } else {
          const maxCtx = resolveMaxContextTokens(options?.model);
          await this._truncateApiMessages(apiMessages, maxCtx, session.id);
        }
      } catch (compErr) {
        // P2: 压缩是非关键优化，失败时降级到截断
        logger.warn('compaction:failed — 降级到截断策略', {
          sessionId: session.id,
          error: compErr instanceof Error ? compErr.message : String(compErr),
        });
        const maxCtx = resolveMaxContextTokens(options?.model);
        await this._truncateApiMessages(apiMessages, maxCtx, session.id);
        handleError(compErr, {
          module: 'chat:manager',
          action: 'compaction',
          context: { sessionId: session.id },
        }).catch(() => {});
      }

      // 通知压缩结果
      const afterTokens = estimateMessagesTokens(apiMessages);
      const savedPercent =
        afterTokens > 0
          ? Math.round((1 - afterTokens / beforeCompact) * 100)
          : 0;
      if (savedPercent > 0) {
        const displayMsg = `上下文已压缩: ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）`;
        logger.info('compaction:completed', {
          sessionId: session.id,
          before: beforeCompact,
          after: afterTokens,
          savedPercent,
        });
        options?.onProgress?.({
          stage: 'generating',
          message: displayMsg,
        });
        const sysMsg = createSystemMessage(
          `[上下文压缩] ${beforeCompact} → ${afterTokens} tokens（节省 ${savedPercent}%）, 策略: tiered`,
          { sessionId: session.id }
        );
        this._addAndPersistMessage(session.id, sysMsg);
        this.unifiedTracker.recordCompaction(beforeCompact, afterTokens);
      }

      // Phase 2: Telemetry + Trajectory THINK 开始
      const streamLlmStartTime = Date.now();
      if (this.ENABLE_TELEMETRY) {
        try {
          agentTelemetry.startTurn(
            session.id,
            options?.model ?? '',
            this._toolRoundCount + 1
          );
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (this.ENABLE_TRAJECTORY) {
        try {
          trajectoryRecorder.recordStep(session.id, {
            phase: 'thinking',
            input: content.slice(0, 500),
            modelName: options?.model,
          });
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 缺陷 C 修复: 推理前容量预检 — 主动防御上下文超限
      if (options?.model) {
        const preCheck = this.unifiedTracker.checkBeforeRequest(
          apiMessages as unknown as readonly {
            role?: string;
            content?: string | unknown;
          }[],
          options.model,
          options?.maxTokens
        );
        if (preCheck.decision !== 'skip') {
          logger.warn('compaction:preemptive_check', {
            sessionId: session.id,
            decision: preCheck.decision,
            beforeTokens: preCheck.beforeTokens,
          });
          if (preCheck.decision === 'trigger') {
            options?.onProgress?.({
              stage: 'generating',
              message: `上下文空间不足（预计 ${preCheck.beforeTokens.toLocaleString()} tokens），建议手动压缩`,
            });
          }
        }
      }

      // P2-12: max_output 加倍重试 — 对标 PilotDeck finishReason=length 处理
      const MAX_OUTPUT_RETRY_CFG = { maxRetries: 3, maxOutputLimit: 64000 };
      const initialMaxTokens =
        (options?.maxTokens as number | undefined) ?? 4096;
      let retryState: MaxOutputRetryState = createMaxOutputRetryState(
        initialMaxTokens,
        MAX_OUTPUT_RETRY_CFG
      );

      // P1-7: 上下文溢出渐进降级 — 初始化降级状态
      const initialCtxLimit = resolveMaxContextTokens(options?.model);
      let ctxDegradation: DegradationState =
        createDegradationState(initialCtxLimit);

      let streamHadError = false;
      while (true) {
        streamHadError = false;

        // 每轮 LLM 调用（含重试）前重置输出 token 计数器
        this.unifiedTracker.resetStreamTokens();
        const gen = activeClient.streamMessage(
          apiMessages as unknown as ChatMessage[],
          {
            ...options,
            maxTokens: retryState.nextMaxTokens,
            signal: streamAbortController.signal,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        let result = await gen.next();

        // Phase 1c: 使用 UnifiedTokenTracker 做流式水位监测
        this.unifiedTracker.startStreamingCheck((state) => {
          logger.warn('流式输出中上下文水位告警', {
            sessionId: session.id,
            currentTokens: state.currentTokens,
            contextLimit: state.contextLimit,
            ratio: Number(state.ratio.toFixed(3)),
            severity: state.severity,
          });
          const pct = Math.round(state.ratio * 100);
          const curK =
            state.currentTokens > 0
              ? `${(state.currentTokens / 1000).toFixed(0)}K`
              : '?';
          const maxK =
            state.contextLimit > 0
              ? `${(state.contextLimit / 1000).toFixed(0)}K`
              : '?';
          options?.onProgress?.({
            stage: 'generating',
            message: `上下文水位: ${pct}% (${curK}/${maxK}) | severity:${state.severity} | ratio:${state.ratio.toFixed(3)} | tokens:${state.currentTokens}/${state.contextLimit}`,
            watermarkState: {
              currentTokens: state.currentTokens,
              contextLimit: state.contextLimit,
              ratio: state.ratio,
              severity: state.severity,
            },
          });
        });

        // 获取会话互斥锁（保护工具执行循环，防止并发请求同时修改会话消息）
        await mutex.acquire();
        try {
          while (!result.done) {
            const chunk = result.value as string | ThinkingProviderChunk;
            if (typeof chunk === 'string') {
              accumulatedContent += chunk;
              this.unifiedTracker.onStreamChunk(chunk);
            } else if (chunk?.type === 'thinking') {
              if (chunk.content) {
                this.unifiedTracker.onStreamChunk(
                  typeof chunk.content === 'string'
                    ? chunk.content
                    : JSON.stringify(chunk.content)
                );
              }
              const thinkingChunk: ChatStreamChunk = {
                type: 'thinking',
                content: chunk.content,
                sessionId: session.id,
              };
              yield thinkingChunk;
            }
            result = await gen.next();
          }
        } catch (genErr) {
          // P1-7: 上下文溢出降级 — 检测 context_length_exceeded 并尝试降级重试
          const degradationResult = tryDegradeContext(ctxDegradation, genErr);
          if (degradationResult.shouldRetry) {
            logger.warn('chat:context_degraded — 降低上下文窗口重试', {
              sessionId: session.id,
              from: initialCtxLimit,
              to: degradationResult.limit,
              degradationCount: ctxDegradation.degradationCount,
            });
            const warning = getDegradationWarning(ctxDegradation);
            if (warning) {
              yield {
                type: 'context_state',
                content: warning,
                sessionId: session.id,
                watermarkState: {
                  currentTokens: 0,
                  contextLimit: degradationResult.limit,
                  ratio: degradationResult.limit / ctxDegradation.originalLimit,
                  severity:
                    degradationResult.limit / ctxDegradation.originalLimit <=
                    0.5
                      ? ('compact' as const)
                      : ('warn' as const),
                },
              } as ChatStreamChunk;
            }
            // 重新截断消息以适应降级后的上下文窗口
            await this._truncateApiMessages(
              apiMessages,
              degradationResult.limit,
              session.id
            );
            // 继续 while(true) 重试（不设置 streamHadError，不 break）
            continue;
          }

          streamHadError = true;
          await handleError(genErr, {
            module: 'chat:ChatManager',
            action: 'streamMessage_genIteration',
            context: { sessionId: session.id },
          });
          const errorMsg =
            genErr instanceof Error
              ? genErr.message.slice(0, 200)
              : String(genErr).slice(0, 200);
          yield {
            type: 'error',
            content: `流式响应中断: ${errorMsg}`,
            sessionId: session.id,
          } as unknown as string;
        }

        if (!streamHadError) {
          finalResponse = result.value as unknown as ChatResponse;
        } else {
          finalResponse = { finishReason: 'error' } as unknown as ChatResponse;
          break; // 流错误不重试
        }

        // P2-12: 检查是否需要加倍重试（stop_reason === 'max_tokens' 表示输出截断）
        const aiStopReason = (
          finalResponse as unknown as { stop_reason?: string }
        ).stop_reason;
        if (aiStopReason === 'max_tokens') {
          retryState = advanceMaxOutputRetry(
            'max_tokens',
            retryState,
            MAX_OUTPUT_RETRY_CFG
          );
        } else {
          retryState = { ...retryState, shouldRetry: false };
        }

        if (!retryState.shouldRetry) break;

        // 重试：清空累积内容，LLM 将以更大 maxTokens 重新生成完整响应
        logger.info('maxOutputRetry: retrying with increased maxTokens', {
          sessionId: session.id,
          retryCount: retryState.retryCount,
          nextMaxTokens: retryState.nextMaxTokens,
          previousContentLength: accumulatedContent.length,
        });
        yield {
          type: 'status',
          statusType: 'retry',
          content: `输出截断，正在以更大 token 限制重试（第 ${retryState.retryCount} 次，maxTokens=${retryState.nextMaxTokens}）...`,
          sessionId: session.id,
        } as ChatStreamChunk;
        accumulatedContent = '';
      }

      // 攒够完整响应后统一修复图片 URL，再一次性发出，避免 AI 拼错 URL
      // ensureThinkResponseTags 用于内部处理，最终输出时剥离标签
      const repairedContent = ensureThinkResponseTags(
        repairImageUrls(accumulatedContent)
      );
      // 剥离 think/response 标签，返回干净的用户可见内容
      const strippedContent = stripThinkResponseTags(repairedContent);
      // 擦洗工具调用标签（<tool_call>/<invoke>/<tool_calls>），防止在流式输出中暴露给用户
      const toolCallScrubber = new StreamingToolCallScrubber();
      const scrubbed = toolCallScrubber.scrub({
        content: strippedContent,
        isComplete: true,
      });
      const residual = toolCallScrubber.flush();
      // 兜底清理：剥离 scrubber 遗漏的孤立工具调用标签残片（如 </parameter></invoke>）
      const finalContent = stripOrphanToolTags(scrubbed.content + residual);
      options?.onStream?.(finalContent);
      yield finalContent;

      this.recordChatResponseUsage(session.id, finalResponse?.usage);

      // 异步记录使用量到 UsageStatsService + CostTracker + LLMTracker
      // ChatManager 直接调用 AI provider，不经过 aiService，需要在此处插桩
      trackUsage(finalResponse ?? {}, {
        model: options?.model || 'unknown',
        providerId: activeClient.getProviderId(),
        latencyMs: 0,
        isStreaming: true,
        sessionId: session.id,
      }).catch((err) => {
        logger.warn('用量记录失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // Phase 5+: 记忆同步由 extractMemoryFromChat 统一处理

      // Phase 2: Telemetry + Trajectory THINK 完成
      const streamLlmDuration = Date.now() - streamLlmStartTime;
      if (this.ENABLE_TELEMETRY) {
        try {
          agentTelemetry.recordTokens(
            session.id,
            finalResponse?.usage?.inputTokens ?? 0,
            finalResponse?.usage?.outputTokens ?? 0
          );
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      if (this.ENABLE_TRAJECTORY) {
        try {
          trajectoryRecorder.recordStep(session.id, {
            phase: 'response',
            output:
              typeof accumulatedContent === 'string'
                ? accumulatedContent.slice(0, 500)
                : '',
            tokensUsed:
              (finalResponse?.usage?.inputTokens ?? 0) +
              (finalResponse?.usage?.outputTokens ?? 0),
            durationMs: streamLlmDuration,
          });
        } catch (err) {
          logger.debug('Telemetry recording skipped', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 通知外部：本次 LLM 响应的词元用量
      if (options?.onUsage && finalResponse?.usage) {
        const u = finalResponse.usage as unknown as Record<string, number>;
        const inputTokens = u.prompt_tokens ?? u.inputTokens ?? 0;
        const outputTokens = u.completion_tokens ?? u.outputTokens ?? 0;
        options.onUsage({
          inputTokens,
          outputTokens,
          cacheReadInputTokens:
            u.prompt_cache_hit_tokens ??
            u.cache_read_input_tokens ??
            u.cacheReadInputTokens ??
            0,
          cacheCreationInputTokens:
            u.prompt_cache_miss_tokens ??
            u.cache_creation_input_tokens ??
            u.cacheCreationInputTokens ??
            0,
          totalTokens:
            u.total_tokens ?? u.totalTokens ?? inputTokens + outputTokens,
          // [v1.2] 使用统一定价计算，不再硬编码 3/15
          estimatedCostUsd: (() => {
            try {
              return calculateTotalCost(
                getModelPricing(options.model ?? ''),
                inputTokens,
                outputTokens,
                u.cache_creation_input_tokens ??
                  u.cacheCreationInputTokens ??
                  0,
                u.cache_read_input_tokens ?? u.cacheReadInputTokens ?? 0
              );
            } catch {
              return 0;
            }
          })(),
        });
      }

      // 创建助手消息（使用已剥离标签、已擦洗工具调用 XML 的 finalContent）
      // 与前端展示内容一致；原始 <think>/<response>/<invoke> 标签不应持久化，
      // 否则会话重载时前端会显示原始标签（已确认 messages.jsonl 残留 <response> 的根因）
      assistantMessage = this.messageService.createAssistantMessage(
        finalContent,
        {
          sessionId: session.id,
        }
      );
      // 传播 finishReason 到消息对象（修复 BUG #10 L3）
      // P2-12: 同时检查 stop_reason（AI ChatResponse）和 finishReason（chat ChatResponse）
      assistantMessage.finishReason =
        finalResponse?.finishReason ||
        (finalResponse as unknown as { stop_reason?: string })?.stop_reason ||
        'stop';

      // 添加助手消息到会话
      // 将 tool_calls 附加到存储的助手消息上，确保后续重建 apiMessages 时格式正确
      try {
        if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
          assistantMessage.metadata = {
            ...assistantMessage.metadata,
            tool_calls: finalResponse.tool_calls.map((tc: ParsedToolCall) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments || {}),
              },
            })),
          };
        }
        this._addAndPersistMessage(session.id, assistantMessage);

        // 响应后自动提取记忆
        await this.extractMemoryFromChat(
          content,
          accumulatedContent,
          session.id
        );

        // 方案 1 路径幻觉校验（流式输出完成后 — 校验完整文本）
        // 注意：流式场景下文本已发送到前端，此处仅在日志中记录 + 必要时追加纠正
        if (accumulatedContent.length > 0) {
          const pathGuardResult = await validatePathsInOutput(
            accumulatedContent,
            this.imageContextService.confirmedPaths
          );
          if (pathGuardResult.corrections.length > 0) {
            // 后续稳定后可 yield 额外 chunk 通知前端纠正
          }
        }

        // 触发 ChatPostStream Hook
        await this.hookChainManager.execute('chat', {
          event: 'chat.post-stream',
          data: {
            message: content,
            response: finalResponse,
            sessionId: session.id,
          },
          sessionId: session.id,
        });

        // 触发 ChatPostMessage Hook
        await this.hookChainManager.execute('chat', {
          event: 'chat.post-message',
          data: {
            message: content,
            response: finalResponse,
            sessionId: session.id,
          },
          sessionId: session.id,
        });

        // 处理工具调用 — 流式工具执行循环（yield 结果到前端）
        if (finalResponse?.tool_calls && finalResponse.tool_calls.length > 0) {
          let currentMessages: Record<string, unknown>[] = [...apiMessages];
          let currentToolCalls: ParsedToolCall[] = [
            ...finalResponse.tool_calls,
          ];
          let currentAssistantMsg = assistantMessage;

          // 保存首个助手消息内容，用于 Shell 声明-校验（解析 [FILE_OPERATION] 声明）
          const firstAssistantContent = String(assistantMessage.content ?? '');

          // 注册表 + 回滚
          const rollbackRoundId = toolResultRegistry.nextRound(session.id);

          // 记录 roundIndex 映射（消息ID → 轮次ID），用于回退时的文件回滚
          if (!session.metadata.roundIndex) {
            session.metadata.roundIndex = {};
          }
          session.metadata.roundIndex[userMessage.id] = rollbackRoundId;
          session.metadata.roundCounter = rollbackRoundId;

          await this._startRollbackRound(session.id, rollbackRoundId).catch(
            (err) => {
              logger.warn('回滚轮次启动失败', { error: String(err) });
              // @ignore-catch — handleError已处理，回滚轮次启动异步抛错无需再处理
              handleError(err, {
                module: 'chat:ChatManager',
                action: 'rollback:startRound',
              }).catch(() => {});
            }
          );

          let toolTurnCount = 0;
          let llmCallCount = 1; // 初始 LLM 调用为第 1 次，工具循环中每次调用递增
          let lastHeartbeatTime = Date.now();
          // P2-5: 跨轮累计已完成工具名，用于心跳结构化数据
          const completedToolNames: string[] = [];
          // P2-1: 跨轮累计已完成 tool_call ID，用于检查点恢复
          const completedToolCallIds: string[] = [];
          while (currentToolCalls.length > 0) {
            // P1-1: 客户端断开时立即中止工具循环，防止幽灵任务浪费 LLM token
            if (streamAbortController.signal.aborted) {
              logger.warn('客户端已断开/取消，中止工具循环', {
                sessionId: session.id,
                completedTurnCount: toolTurnCount,
              });
              break;
            }
            // Bug Fix: 传统工具循环最大轮次保护
            toolTurnCount++;

            // P2-5: 任务进度心跳 — 每 5 秒 yield execution_phase，前端渲染进度条
            if (Date.now() - lastHeartbeatTime >= 5000) {
              lastHeartbeatTime = Date.now();
              yield {
                type: 'execution_phase',
                content: `已执行 ${completedToolNames.length} 个工具，第 ${toolTurnCount} 轮`,
                sessionId: session.id,
                executionPhase: {
                  phase: 'implementing' as const,
                  progress: completedToolNames.length,
                  description: `第 ${toolTurnCount} 轮工具调用`,
                  steps: [
                    ...completedToolNames.map((name) => ({
                      name,
                      status: 'done' as const,
                    })),
                    ...currentToolCalls.map((tc) => ({
                      name: getToolCallName(tc),
                      status: 'in_progress' as const,
                    })),
                  ],
                  currentStep: getToolCallName(currentToolCalls[0]) || '',
                },
              } as ChatStreamChunk;
            }

            if (toolTurnCount > this.MAX_TOOL_TURNS) {
              logger.warn('工具循环达到最大轮次限制', {
                sessionId: session.id,
                maxTurns: this.MAX_TOOL_TURNS,
              });
              yield `\n\n⚠️ 已达到最大工具轮次限制 (${this.MAX_TOOL_TURNS})，工具链提前终止。`;
              currentToolCalls = [];
              break;
            }
            const processedResults: Array<{
              normalizedToolCall: ToolCall;
              result: ToolResult;
            }> = [];

            // P2-3: LoopDetector — 执行前检测是否有循环模式
            for (const toolCall of currentToolCalls) {
              const toolName = getToolCallName(toolCall);
              const detection = this._loopDetector.detect(
                toolName,
                toolCall.arguments
              );
              if (detection.stuck && detection.level === 'critical') {
                logger.warn('LoopDetector 检测到工具调用循环，中止执行', {
                  sessionId: session.id,
                  toolName,
                  detector: detection.detector,
                  message: detection.message,
                });
                yield `\n\n⚠️ 检测到工具调用循环 (${detection.message})，任务提前终止。`;
                currentToolCalls = [];
                break;
              } else if (detection.stuck && detection.level === 'warning') {
                logger.info('LoopDetector 警告', {
                  sessionId: session.id,
                  toolName,
                  detector: detection.detector,
                  message: detection.message,
                });
              }
            }
            if (currentToolCalls.length === 0) break;

            for (const toolCall of currentToolCalls) {
              const toolName = getToolCallName(toolCall);

              // 用户交互检查
              const toolObj = (
                this.toolRegistry as unknown as {
                  getTool: (
                    name: string
                  ) => { requiresUserInteraction?: () => boolean } | undefined;
                }
              ).getTool?.(toolName);

              if (toolObj?.requiresUserInteraction?.()) {
                const toolArgs = toolCall.arguments as Record<string, unknown>;
                const questionId = `q_${Date.now()}_${(toolCall.id || '').slice(0, 8)}`;
                const rawOptions =
                  (toolArgs.options as Array<{
                    label?: string;
                    description?: string;
                  }>) || [];
                const validatedOptions = rawOptions
                  .filter(
                    (opt) => opt.label && String(opt.label).trim().length > 0
                  )
                  .slice(0, 4)
                  .map((opt) => ({
                    label: String(opt.label).trim(),
                    description: opt.description
                      ? String(opt.description).trim()
                      : '',
                  }));

                let finalOptions =
                  validatedOptions.length >= 2
                    ? validatedOptions
                    : [
                        {
                          label: '好的，开始讨论',
                          description: '按当前方向直接开始',
                        },
                        {
                          label: '我补充信息',
                          description: '我还有其他信息要补充',
                        },
                      ];

                const interactionPromise = new Promise<string[]>((resolve) => {
                  this._pendingInteraction = {
                    questionId,
                    resolve,
                    promise: undefined as unknown as Promise<string[]>,
                  };
                });
                (
                  this._pendingInteraction as { promise: Promise<string[]> }
                ).promise = interactionPromise;

                yield {
                  type: 'question',
                  content: (toolArgs.question as string) || '',
                  sessionId: session.id,
                  toolCall: {
                    id: toolCall.id,
                    name: toolName,
                    arguments: toolArgs,
                  },
                  questionData: {
                    questionId,
                    question: (toolArgs.question as string) || '',
                    header: (toolArgs.header as string) || '请选择',
                    options: finalOptions,
                    multiSelect: toolArgs.multiSelect as boolean | undefined,
                  },
                } as unknown as string;

                const answers = await interactionPromise;
                (toolCall.arguments as Record<string, unknown>)._userAnswers =
                  answers;
              }

              // 执行工具
              const toolResult = await this.executeTool(
                {
                  id: toolCall.id,
                  name: toolName,
                  arguments: toolCall.arguments,
                  sessionId: session.id,
                },
                { useErrorHandler: true }
              );

              // 注册表 + 持久化
              toolResultRegistry.storeResult(
                session.id,
                toolCall.id,
                toolName,
                toolCall.arguments,
                { result: toolResult.result, error: toolResult.error },
                toolResultRegistry.getCurrentRound(session.id)
              );
              const toolResultMsg = this.messageService.createToolResultMessage(
                toolResult,
                { sessionId: session.id, metadata: toolResult.metadata }
              );
              this._addAndPersistMessage(session.id, toolResultMsg);

              processedResults.push({
                normalizedToolCall: {
                  id: toolCall.id,
                  name: toolName,
                  arguments: toolCall.arguments,
                },
                result: toolResult,
              });

              // P2-5: 记录已完成工具名，用于心跳结构化数据
              completedToolNames.push(toolName);
              // P2-1: 记录已完成 tool_call ID，用于检查点恢复。
              // pendingApproval 工具不算完成——批准后 resume 需重放它（此时放行缓存命中直接执行）
              const isPendingApprovalResult =
                (toolResult as { result?: { pendingApproval?: boolean } })
                  ?.result?.pendingApproval === true;
              if (!isPendingApprovalResult) {
                completedToolCallIds.push(toolCall.id);
              }

              // P2-1: 工具执行完成后写入流式自动检查点
              await streamingCheckpoint.onToolCompleted({
                newMessagesSinceLastCheckpoint: [
                  assistantMessage,
                  toolResultMsg,
                ],
                messagesSnapshot: session.messages.slice(),
                currentToolCalls: currentToolCalls
                  .filter((tc: ParsedToolCall) => tc.id !== toolCall.id)
                  .map((tc: ParsedToolCall) => ({
                    id: tc.id,
                    name: getToolCallName(tc),
                    arguments: tc.arguments,
                  })),
                completedToolCallIds: [...completedToolCallIds],
                generatorState: { toolTurnCount, llmCallCount },
                metadata: { model: options?.model },
                sessionState: session.state,
              });

              // P2-3: LoopDetector — 记录工具执行结果，用于后续循环检测
              this._loopDetector.recordToolCallOutcome(
                toolName,
                toolCall.arguments,
                toolResult.result,
                toolResult.error
              );

              // yield tool_call 完成 chunk
              yield {
                type: 'tool_call',
                content: toolResult.error
                  ? `工具 ${toolName} 执行失败: ${toolResult.error.slice(0, 300)}`
                  : '',
                sessionId: session.id,
                toolCall: {
                  id: toolCall.id,
                  name: toolName,
                  arguments: toolCall.arguments,
                  status: toolResult.error ? 'failed' : 'completed',
                },
              } as unknown as string;

              // yield todo chunk
              const todoData = extractTodoData(toolResult);
              if (todoData) {
                yield {
                  type: 'todo',
                  content: JSON.stringify(todoData),
                  sessionId: session.id,
                  todoData,
                } as unknown as string;
              }
            }

            // 构建工具结果消息，流式调用 LLM
            const updatedMessages: Record<string, unknown>[] = [
              ...currentMessages,
              {
                role: 'assistant',
                content:
                  typeof currentAssistantMsg.content === 'string'
                    ? currentAssistantMsg.content
                    : null,
                tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments:
                      typeof tc.arguments === 'string'
                        ? tc.arguments
                        : JSON.stringify(tc.arguments || {}),
                  },
                })),
              },
              ...processedResults.map((pr) => ({
                role: 'tool' as const,
                content: pr.result.result
                  ? JSON.stringify(pr.result.result)
                  : pr.result.error || '{}',
                tool_call_id: pr.normalizedToolCall.id,
              })),
            ];

            let toolResultAccumulatedContent = '';
            this.unifiedTracker.resetStreamTokens();
            if (options?.model) {
              this.unifiedTracker.updateBaselineForRound(
                updatedMessages as unknown as {
                  role?: string;
                  content?: string | unknown;
                }[],
                options.model
              );
            }
            llmCallCount++; // P2-1: 追踪 LLM 调用次数

            // P3 修复（2026-08-05）：工具轮次残缺工具调用自动重试
            // 现象：模型输出不完整工具调用 XML（如仅输出 </parameter></invoke></tool_calls>
            // 闭合标签、缺失开标签），导致解析不出 tool_calls，任务静默中断。
            // 处理：无 tool_calls 且内容以工具调用标签结尾时判定为残缺，加大 maxTokens 重试一次。
            const toolRoundBaseMaxTokens =
              (options?.maxTokens as number | undefined) ?? 4096;
            let toolResultResponse = null as unknown as ChatResponse;
            let toolRoundRetried = false;

            for (;;) {
              const toolGen = activeClient.streamMessage(
                updatedMessages as unknown as ChatMessage[],
                {
                  ...options,
                  maxTokens: toolRoundRetried
                    ? Math.min(
                        Math.max(toolRoundBaseMaxTokens * 2, 8192),
                        64000
                      )
                    : toolRoundBaseMaxTokens,
                  signal: streamAbortController.signal,
                  tools:
                    toolDefinitions.length > 0
                      ? (toolDefinitions as unknown as ToolDefinition[])
                      : undefined,
                }
              );

              const toolGenResult = await toolGen.next();
              let toolResultIter = toolGenResult;
              let roundContent = '';
              try {
                while (!toolResultIter.done) {
                  const chunk = toolResultIter.value as
                    | string
                    | ThinkingProviderChunk;
                  if (typeof chunk === 'string') {
                    roundContent += chunk;
                  } else if (chunk?.type === 'thinking') {
                    yield {
                      type: 'thinking',
                      content: chunk.content,
                      sessionId: session.id,
                    } as unknown as string;
                  }
                  toolResultIter = await toolGen.next();
                }
              } catch (toolGenErr) {
                await handleError(toolGenErr, {
                  module: 'chat:ChatManager',
                  action: 'streamMessage_toolGenIteration',
                  context: { sessionId: session.id },
                });
                roundContent += `\n\n[工具轮次流式响应中断: ${toolGenErr instanceof Error ? toolGenErr.message.slice(0, 200) : String(toolGenErr).slice(0, 200)}]`;
              }
              const toolGenResponse =
                toolResultIter.value as unknown as ChatResponse;

              // 残缺工具调用检测：无 tool_calls 但内容以工具调用 XML 标签结尾
              const truncatedToolCall =
                !toolGenResponse?.tool_calls?.length &&
                /<\/?(?:parameter|invoke|tool_call|tool_calls)\b[^>]*>\s*$/i.test(
                  roundContent.trimEnd()
                );
              if (truncatedToolCall && !toolRoundRetried) {
                toolRoundRetried = true;
                logger.warn('toolRound:truncated_tool_call_retry', {
                  sessionId: session.id,
                  contentTail: roundContent.slice(-160),
                });
                yield {
                  type: 'status',
                  statusType: 'tool_retry',
                  content: '工具调用输出不完整，正在重新生成...',
                  sessionId: session.id,
                } as unknown as string;
                continue;
              }

              toolResultAccumulatedContent = roundContent;
              toolResultResponse = toolGenResponse;
              break;
            }

            // yield 累积文本
            const repairedToolContent = ensureThinkResponseTags(
              repairImageUrls(toolResultAccumulatedContent)
            );
            // 剥离 response 标签（与主流程一致），避免持久化原始标签
            const strippedToolContent =
              stripThinkResponseTags(repairedToolContent);
            // 擦洗工具调用标签，防止在工具轮次中暴露给用户
            const toolRoundScrubber = new StreamingToolCallScrubber();
            const toolScrubbed = toolRoundScrubber.scrub({
              content: strippedToolContent,
              isComplete: true,
            });
            const toolResidual = toolRoundScrubber.flush();
            // 兜底清理：剥离 scrubber 遗漏的孤立工具调用标签残片
            const cleanToolContent = stripOrphanToolTags(
              toolScrubbed.content + toolResidual
            );
            options?.onStream?.(cleanToolContent);
            yield cleanToolContent;

            this.recordChatResponseUsage(session.id, toolResultResponse?.usage);
            trackUsage(toolResultResponse ?? {}, {
              model: options?.model || 'unknown',
              providerId: activeClient.getProviderId(),
              latencyMs: 0,
              isStreaming: true,
              sessionId: session.id,
              // @ignore-catch — fire-and-forget用量追踪，非关键路径
            }).catch(() => {});

            const toolResultAssistantMsg =
              this.messageService.createAssistantMessage(cleanToolContent, {
                sessionId: session.id,
              });
            toolResultAssistantMsg.finishReason =
              toolResultResponse?.finishReason ||
              (toolResultResponse as unknown as { stop_reason?: string })
                ?.stop_reason ||
              'stop';
            if (toolResultResponse?.tool_calls?.length) {
              toolResultAssistantMsg.metadata = {
                ...toolResultAssistantMsg.metadata,
                tool_calls: toolResultResponse.tool_calls.map(
                  (tc: ParsedToolCall) => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.name,
                      arguments:
                        typeof tc.arguments === 'string'
                          ? tc.arguments
                          : JSON.stringify(tc.arguments || {}),
                    },
                  })
                ),
              };
            }
            this._addAndPersistMessage(session.id, toolResultAssistantMsg);

            // 下一轮
            if (toolResultResponse?.tool_calls?.length) {
              toolResultRegistry.nextRound(session.id);
              currentMessages = updatedMessages;
              currentToolCalls = [...toolResultResponse.tool_calls];
              currentAssistantMsg = toolResultAssistantMsg;
              assistantMessage = toolResultAssistantMsg;
            } else {
              assistantMessage = toolResultAssistantMsg;
              currentToolCalls = [];
            }

            // P2-3: LoopDetector — 记录本轮是否有工具调用
            this._loopDetector.recordTurn(
              toolResultResponse?.tool_calls?.length ? true : false
            );

            // P2-1: 断点续传 — 每 5 轮保存一次检查点
            if (toolTurnCount % 5 === 0) {
              this._checkpointService
                .saveCheckpointWithData(
                  session.id,
                  session.messages,
                  session.metadata,
                  SessionState.ACTIVE,
                  `auto-round-${toolTurnCount}`,
                  `工具执行第 ${toolTurnCount} 轮自动检查点`,
                  true,
                  estimateMessagesTokens(
                    session.messages as unknown as Record<string, unknown>[]
                  )
                )
                .catch((e) =>
                  logger.warn('自动检查点保存失败（非关键）', {
                    sessionId: session.id,
                    round: toolTurnCount,
                    error: String(e),
                  })
                );
            }
          }

          await this._endRollbackRound(
            session.id,
            content,
            firstAssistantContent
          ).catch((err) => {
            logger.warn('回滚轮次结束失败', { error: String(err) });
            // @ignore-catch — handleError已处理，回滚轮次结束异步抛错无需再处理
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:endRound',
            }).catch(() => {});
          });
        }
      } catch (toolExecErr) {
        await handleError(toolExecErr, {
          module: 'chat:ChatManager',
          action: 'streamMessage_toolExecution',
          context: { sessionId: session.id },
        });
        // socket 意外关闭（Provider 超时/网络波动）→ 用户友好提示
        const errMsg = getToolExecErrorMessage(toolExecErr);
        accumulatedContent += `\n\n[${errMsg}]`;
      } finally {
        // BUG-02/03 fix: 释放 mutex 锁（工具执行异常时也必须释放，防止会话死锁）
        mutex.release();
      }

      // P2-3.5: 资源清理 + 持久化 + 构建返回消息（提取为 _finalizeStreamMessage）
      return await this._finalizeStreamMessage(
        session,
        content,
        accumulatedContent,
        assistantMessage,
        finalResponse,
        streamAbortController,
        streamSpan,
        options
      );
    } finally {
      // OTel P4: 确保 streamSpan 在生成器提早终止时不泄漏
      // _finalizeStreamMessage 正常路径已 end，此处为防御性兜底
      try {
        getOTelTracing().endSpan(streamSpan);
      } catch {
        /* span 可能已结束 */
      }
    }
  }

  /**
   * P2-1: 从检查点恢复流式执行
   *
   * 加载自动检查点中保存的消息快照和剩余工具调用，
   * 跳过已完成的工具，从断点继续执行工具循环。
   */
  async *resumeStream(
    sessionId: string,
    checkpointId: string
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    // P2-1: 获取会话互斥锁，防止并发恢复请求操作同一会话
    let mutex = this._sessionMutexes.get(sessionId);
    if (!mutex) {
      mutex = new SimpleMutex();
      this._sessionMutexes.set(sessionId, mutex);
    }
    await mutex.acquire();

    const streamingCheckpoint = new StreamingAutoCheckpoint(
      this._checkpointService,
      sessionId
    );

    let restoreResult: Awaited<ReturnType<StreamingAutoCheckpoint['restore']>>;
    try {
      restoreResult = await streamingCheckpoint.restore();
    } catch (err) {
      mutex.release();
      throw err;
    }
    if (!restoreResult) {
      try {
        yield {
          type: 'error',
          content: '无可用检查点，无法恢复',
          sessionId,
        } as unknown as string;
      } finally {
        mutex.release();
      }
      return null as unknown as Message;
    }

    const { checkpoint, stepIndex, completedToolCallIds, generatorState } =
      restoreResult;

    // 1. 恢复会话状态
    const session = await this._getOrLoadSession(sessionId);
    session.messages = checkpoint.messages;

    try {
      // 2. 创建新的 streamAbortController
      const streamAbortController = new AbortController();
      this._sessionAbortControllers.set(sessionId, streamAbortController);

      // 3. 找到最后一条含 tool_calls 的 assistant 消息，提取剩余工具
      let accumulatedContent = '';
      let remainingToolCalls: ParsedToolCall[] = [];
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i];
        if (msg.role === 'assistant' && msg.metadata?.tool_calls) {
          const tcs = msg.metadata.tool_calls as Array<{
            id: string;
            type: string;
            function: { name: string; arguments: string };
          }>;
          remainingToolCalls = tcs
            .filter((tc) => !completedToolCallIds.includes(tc.id))
            .map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              arguments:
                typeof tc.function.arguments === 'string'
                  ? JSON.parse(tc.function.arguments)
                  : tc.function.arguments,
            }));
          accumulatedContent =
            typeof msg.content === 'string' ? msg.content : '';
          break;
        }
      }

      if (remainingToolCalls.length === 0) {
        logger.info('resumeStream: 所有工具已完成，无需恢复', { sessionId });
        try {
          yield {
            type: 'status',
            statusType: 'task_all_done',
            content: '任务已全部完成',
            sessionId,
          } as ChatStreamChunk;
        } finally {
          mutex.release();
        }
        return session.messages[session.messages.length - 1] || ({} as Message);
      }

      // 4. 获取工具定义
      const activeClient = this.getLLMClient();
      const toolDefinitions: ToolDefinition[] = this.toolRegistry
        ? this._buildToolDefinitions(this.toolRegistry.getToolSchemas())
        : [];

      logger.info('resumeStream: 开始恢复执行', {
        sessionId,
        stepIndex,
        completedToolCount: completedToolCallIds.length,
        remainingToolCount: remainingToolCalls.length,
        toolTurnCount: generatorState.toolTurnCount,
      });

      yield {
        type: 'status',
        statusType: 'resume',
        content: `从第 ${stepIndex} 步恢复 — 剩余 ${remainingToolCalls.length} 个工具`,
        sessionId,
      } as ChatStreamChunk;

      // 5. 工具执行循环（简化版，复用核心逻辑）
      let currentToolCalls: ParsedToolCall[] = remainingToolCalls;
      let toolTurnCount = generatorState.toolTurnCount;
      const MAX_TOOL_TURNS = this.MAX_TOOL_TURNS;

      while (currentToolCalls.length > 0) {
        if (streamAbortController.signal.aborted) break;
        toolTurnCount++;

        if (toolTurnCount > MAX_TOOL_TURNS) {
          yield {
            type: 'error',
            content: `工具调用次数已达上限 (${MAX_TOOL_TURNS})`,
            sessionId,
          } as unknown as string;
          break;
        }

        // 执行本轮工具
        const processedResults: Array<{
          normalizedToolCall: ParsedToolCall;
          result: ToolResult;
        }> = [];
        for (const tc of currentToolCalls) {
          const toolName = tc.name;
          const toolResult = await this.executeTool(
            { id: tc.id, name: toolName, arguments: tc.arguments, sessionId },
            { useErrorHandler: true }
          );
          processedResults.push({
            normalizedToolCall: {
              id: tc.id,
              name: toolName,
              arguments: tc.arguments,
            },
            result: toolResult,
          });

          yield {
            type: 'tool_call',
            content: toolResult.error ? `工具 ${toolName} 执行失败` : '',
            sessionId,
            toolCall: {
              id: tc.id,
              name: toolName,
              arguments: tc.arguments,
              status: toolResult.error ? 'failed' : 'completed',
            },
          } as unknown as string;
        }

        // 构建 API 消息并调用 LLM
        const updatedMessages: Record<string, unknown>[] = session.messages.map(
          (m) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
            ...(m.metadata?.tool_calls
              ? { tool_calls: m.metadata.tool_calls }
              : {}),
            ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          })
        );

        for (const pr of processedResults) {
          updatedMessages.push({
            role: 'assistant',
            content: accumulatedContent,
            tool_calls: currentToolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          });
          updatedMessages.push({
            role: 'tool',
            content: pr.result.result
              ? typeof pr.result.result === 'string'
                ? pr.result.result
                : JSON.stringify(pr.result.result)
              : pr.result.error || '{}',
            tool_call_id: pr.normalizedToolCall.id,
          });
        }

        // 调用 LLM
        const toolGen = activeClient.streamMessage(
          updatedMessages as unknown as ChatMessage[],
          {
            signal: streamAbortController.signal,
            tools:
              toolDefinitions.length > 0
                ? (toolDefinitions as unknown as ToolDefinition[])
                : undefined,
          }
        );

        accumulatedContent = '';
        let result = await toolGen.next();
        while (!result.done) {
          const chunk = result.value as
            | { type?: string; content?: string; delta?: { content?: string } }
            | string;
          const content =
            typeof chunk === 'string'
              ? chunk
              : chunk?.delta?.content || chunk?.content || '';
          if (content) {
            accumulatedContent += content;
            yield content;
          }
          result = await toolGen.next();
        }

        const toolResultResponse = result.value as {
          content?: string;
          tool_calls?: ParsedToolCall[];
          usage?: { inputTokens?: number; outputTokens?: number };
        };

        // 检查是否还有新工具调用
        if (
          toolResultResponse?.tool_calls &&
          toolResultResponse.tool_calls.length > 0
        ) {
          currentToolCalls = [...toolResultResponse.tool_calls];
          continue;
        }

        currentToolCalls = [];
      }

      // 6. 清理
      this._sessionAbortControllers.delete(sessionId);
      this._streamingCheckpoint = null;

      const assistantMessage = this.messageService.createAssistantMessage(
        stripThinkResponseTags(repairImageUrls(accumulatedContent)),
        { sessionId }
      );
      assistantMessage.sessionId = sessionId;
      assistantMessage.finishReason = streamAbortController.signal.aborted
        ? 'abort'
        : 'stop';
      this._addAndPersistMessage(sessionId, assistantMessage);

      return assistantMessage;
    } finally {
      mutex.release();
    }
  }

  /**
   * 解析待处理的用户交互
   * 当工具需要用户输入时，UI 层调用此方法提供用户答案，从而恢复工具执行
   *
   * @param questionId 问题ID（必须与待处理交互的 questionId 匹配）
   * @param answers 用户选择的答案列表
   * @returns 是否成功解析
   */
  resolveInteraction(questionId: string, answers: string[]): boolean {
    if (
      this._pendingInteraction &&
      this._pendingInteraction.questionId === questionId
    ) {
      logger.info('解析用户交互', { questionId, answers });
      this._pendingInteraction.resolve(answers);
      this._pendingInteraction = null;
      return true;
    }
    logger.warn('未找到匹配的待处理交互', { questionId });
    return false;
  }

  /**
   * 获取非流式路径中的待处理交互数据
   * @param sessionId 会话ID
   * @returns 待处理的提问数据，如果没有则返回 null
   */
  getPendingInteraction(sessionId: string): QuestionData | null {
    const state = this.pendingInteractions.get(sessionId);
    return state?.questionData ?? null;
  }

  /**
   * 继续非流式路径中的交互（用户回答后恢复工具执行）
   * 恢复 sendMessage() 中断的工具循环：注入用户答案执行交互工具，
   * 执行剩余工具，继续 LLM 多轮递归
   */
  async continueInteraction(
    sessionId: string,
    questionId: string,
    answers: string[]
  ): Promise<Message> {
    const state = this.pendingInteractions.get(sessionId);
    if (!state) {
      throw new AppError(
        `会话 ${sessionId} 没有待恢复的交互状态`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    if (state.questionData.questionId !== questionId) {
      throw new AppError(
        `问题 ID 不匹配: 期望 ${state.questionData.questionId}，实际 ${questionId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.pendingInteractions.delete(sessionId);
    logger.info('恢复非流式交互', { sessionId, questionId, answers });

    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        `会话 ${sessionId} 不存在`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 解构保存的状态
    let {
      currentRoundMessages,
      currentToolCalls,
      processedResults,
      interactionIdx,
      roundAssistantMsg,
      toolDefinitions,
    } = state;

    // ----- 执行从 interactionIdx 开始的工具 -----
    // 先完成当前轮次中 interactionIdx 及之后的工具
    const remainingTools = currentToolCalls.slice(interactionIdx);
    const newProcessedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }> = [...processedResults];

    for (let i = 0; i < remainingTools.length; i++) {
      const toolCall = remainingTools[i];
      const normalizedToolCall: ToolCall = {
        id: toolCall.id,
        name: toolCall.name || 'unknown',
        arguments: toolCall.arguments || {},
      };

      // 解析参数
      let parsedArguments: Record<string, unknown>;
      if (typeof normalizedToolCall.arguments === 'string') {
        try {
          parsedArguments = JSON.parse(normalizedToolCall.arguments);
        } catch (err) {
          logger.debug('Tool argument JSON parse failed, using empty object', {
            error: err instanceof Error ? err.message : String(err),
          });
          parsedArguments = {};
        }
      } else {
        parsedArguments = normalizedToolCall.arguments as Record<
          string,
          unknown
        >;
      }

      // 如果是交互工具（第一个），注入用户答案
      if (i === 0) {
        parsedArguments._userAnswers = answers;
      }

      // 执行工具
      const toolResult = await this.executeTool(
        {
          id: normalizedToolCall.id,
          name: normalizedToolCall.name,
          arguments: parsedArguments,
          sessionId: session.id,
        },
        { useErrorHandler: true }
      );

      // 注册表：存储工具执行结果
      toolResultRegistry.storeResult(
        session.id,
        normalizedToolCall.id,
        normalizedToolCall.name,
        parsedArguments,
        { result: toolResult.result, error: toolResult.error },
        toolResultRegistry.getCurrentRound(session.id)
      );

      // 保存工具结果消息
      const toolResultMessage = this.messageService.createToolResultMessage(
        toolResult,
        { sessionId: session.id, metadata: toolResult.metadata }
      );
      this._addAndPersistMessage(session.id, toolResultMessage);

      newProcessedResults.push({ normalizedToolCall, result: toolResult });
    }

    // ----- 构建下一轮 LLM 请求 -----
    let updatedMessages: Record<string, unknown>[];
    let assistantMsg = roundAssistantMsg;

    // 继续多轮递归工具循环
    // 使用 assistantMessage 作为累积消息，继续 while 循环
    // 注册表：进入下一轮
    toolResultRegistry.nextRound(session.id);
    while (true) {
      // 构建包含本轮全部结果的完整请求
      updatedMessages = [
        ...currentRoundMessages,
        {
          role: 'assistant',
          content:
            typeof assistantMsg.content === 'string'
              ? assistantMsg.content
              : JSON.stringify(assistantMsg.content),
          tool_calls: currentToolCalls.map((tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })),
        },
        ...newProcessedResults.map((pr) => {
          const toolResultContent = pr.result.result
            ? typeof pr.result.result === 'string'
              ? pr.result.result
              : JSON.stringify(pr.result.result)
            : pr.result.error || '{}';
          return {
            role: 'tool' as const,
            content: toolResultContent,
            tool_call_id: pr.normalizedToolCall.id,
          };
        }),
      ];

      // 发送到 LLM
      const activeClient = this.getLLMClient();
      const toolResultResponse = await activeClient.sendMessage(
        updatedMessages as unknown as ChatMessage[],
        {
          tools:
            toolDefinitions.length > 0
              ? (toolDefinitions as unknown as ToolDefinition[])
              : undefined,
        }
      );

      this.recordChatResponseUsage(session.id, toolResultResponse.usage);

      // 异步记录使用量
      trackUsage(toolResultResponse, {
        model: 'unknown',
        providerId: activeClient.getProviderId(),
        latencyMs: 0,
        isStreaming: false,
        sessionId: session.id,
      }).catch((err) => {
        logger.warn('用量记录失败', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      // 创建本轮 assistant 消息（剥离 think/response 标签 + 修复图片 URL，
      // 与主消息一致，避免原始标签持久化后在前端展示）
      const toolResultAssistantContent = stripThinkResponseTags(
        repairImageUrls(
          typeof toolResultResponse.content === 'string'
            ? toolResultResponse.content
            : JSON.stringify(toolResultResponse.content)
        )
      );

      const toolResultAssistantMsg = this.messageService.createAssistantMessage(
        toolResultAssistantContent,
        { sessionId: session.id }
      );
      toolResultAssistantMsg.sessionId = session.id;

      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        const toolCallsData = toolResultResponse.tool_calls.map(
          (tc: ParsedToolCall) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string'
                  ? tc.arguments
                  : JSON.stringify(tc.arguments || {}),
            },
          })
        );
        toolResultAssistantMsg.metadata = {
          ...toolResultAssistantMsg.metadata,
          tool_calls: toolCallsData,
        };
      }
      this._addAndPersistMessage(session.id, toolResultAssistantMsg);

      // 检查是否有新的工具调用
      if (
        toolResultResponse.tool_calls &&
        toolResultResponse.tool_calls.length > 0
      ) {
        // 继续下一轮
        // 注册表：进入下一轮
        toolResultRegistry.nextRound(session.id);
        const assistantMsgForCompress = updatedMessages[
          currentRoundMessages.length
        ] as Record<string, unknown>;
        const toolResultsForCompress = updatedMessages.slice(
          currentRoundMessages.length + 1
        ) as Record<string, unknown>[];
        currentRoundMessages = this._compressToolHistory(
          currentRoundMessages,
          session.id,
          assistantMsgForCompress,
          toolResultsForCompress
        );
        currentToolCalls = [...toolResultResponse.tool_calls];
        newProcessedResults.length = 0; // 清空，重新累积
        assistantMsg = toolResultAssistantMsg;
        continue;
      }

      // 没有更多工具调用，返回最终消息
      return toolResultAssistantMsg;
    }
  }

  /**
   * 获取或创建回滚集成实例
   * @param sessionId 会话 ID
   * @returns 回滚集成实例
   */
  private _getRollbackIntegration(sessionId: string): RollbackIntegration {
    let integration = this.rollbackIntegrations.get(sessionId);
    if (!integration) {
      integration = new RollbackIntegration(sessionId);

      // 连接撤消/重做权限控制
      // 将 undo_round / redo_round 作为虚拟工具名，复用 PermissionManager
      if (this.permissionManager) {
        const pm = this.permissionManager as {
          checkPermissionForTool: (
            name: string,
            args: Record<string, unknown>
          ) => Promise<{ allowed: boolean; reason?: string }>;
        };
        integration.setPermissionChecker(async (action, roundId) => {
          const result = await pm.checkPermissionForTool(
            action === 'undo' ? 'undo_round' : 'redo_round',
            { sessionId, roundId }
          );
          return { allowed: result.allowed, reason: result.reason };
        });
      }

      this.rollbackIntegrations.set(sessionId, integration);
    }
    return integration;
  }

  /**
   * 开始回滚轮次追踪
   * @param sessionId 会话 ID
   * @param roundId 轮次编号
   */
  private async _startRollbackRound(
    sessionId: string,
    roundId: number
  ): Promise<void> {
    const integration = this._getRollbackIntegration(sessionId);
    const scanPaths = [resolveProjectRoot()];
    await integration.onRoundStart(sessionId, roundId, scanPaths);
  }

  /**
   * 结束回滚轮次追踪并创建快照
   * @param sessionId 会话 ID
   * @param messageSummary 用户消息摘要
   * @param assistantContent 本轮首个助手消息内容（用于解析 [FILE_OPERATION] 声明）
   */
  private async _endRollbackRound(
    sessionId: string,
    messageSummary: string,
    assistantContent?: string
  ): Promise<void> {
    const integration = this.rollbackIntegrations.get(sessionId);
    if (integration) {
      const snapshot = await integration.onRoundEnd(messageSummary);

      // P1: Shell 声明-校验 — 解析 AI 的 [FILE_OPERATION] 声明，补录 detectShellSideEffects 漏掉的操作
      if (snapshot && assistantContent) {
        try {
          const declarations =
            FileOperationTracker.parseFileOperationDeclarations(
              assistantContent,
              resolveProjectRoot()
            );
          if (declarations.length > 0) {
            // 将声明中未被 detectShellSideEffects 检测到的操作补充到变更列表
            const existingPaths = new Set(
              snapshot.changedFiles.map((c: { path: string }) => c.path)
            );
            const missedChanges: FileChange[] = [];

            for (const decl of declarations) {
              const absPath = decl.path;
              if (!existingPaths.has(absPath)) {
                // 声明但未检测到的文件操作
                if (decl.type === 'created') {
                  // 创建声明：文件可能已创建但不在扫描范围内
                  missedChanges.push({ path: absPath, type: 'created' });
                } else if (decl.type === 'deleted') {
                  // 删除声明：文件可能已被删除
                  missedChanges.push({ path: absPath, type: 'deleted' });
                } else if (decl.type === 'modified') {
                  missedChanges.push({ path: absPath, type: 'modified' });
                }
              }
            }

            if (missedChanges.length > 0) {
              integration.mergeChanges(missedChanges);
              logger.debug(
                'Shell声明校验：补录detectShellSideEffects漏掉的操作',
                {
                  sessionId,
                  declaredCount: declarations.length,
                  missedCount: missedChanges.length,
                }
              );
            }
          }
        } catch {
          // @ignore-catch — 非关键路径
        }
      }

      // P1: 子 Agent 操作继承 — 将子 Agent 的 Shell 副作用（file_create / file_delete）合并到父会话 tracker
      if (snapshot && snapshot.changedFiles.length > 0) {
        try {
          const session = await this.sessionGateway.getSession(sessionId);
          const parentSessionId = session?.metadata?.parentSessionId as
            | string
            | undefined;
          if (parentSessionId) {
            const parentIntegration =
              this.rollbackIntegrations.get(parentSessionId);
            if (parentIntegration) {
              // 只合并 Shell 副作用产生的 created / deleted 类型变更
              // modified 类型已通过 ChatManager 工具拦截（Write/Edit）直接转发
              const shellChanges = snapshot.changedFiles.filter(
                (c: { type: string }) =>
                  c.type === 'created' || c.type === 'deleted'
              );
              if (shellChanges.length > 0) {
                parentIntegration.mergeChanges(shellChanges);
                logger.debug('子Agent操作继承：Shell副作用已合并到父会话', {
                  childSessionId: sessionId,
                  parentSessionId,
                  changeCount: shellChanges.length,
                });
              }
            }
          }
        } catch (err) {
          // 非关键路径，继承失败不影响子 Agent 自身的回滚
          logger.debug('subAgent mergeChanges skipped', { error: String(err) });
        }
      }
    }
  }

  /**
   * 执行文件回滚 — 撤消指定轮次之后的文件操作
   * 用于 truncateMessages（回退消息）时的文件系统级联回滚
   * @param sessionId 会话 ID
   * @param sinceRoundId 从该轮次之后开始撤消
   * @param maxRound 最大轮次编号
   * @param roundIndex 消息ID→轮次ID映射（用于清理）
   * @returns 每个轮次的 undo 结果
   */
  async undoRoundsSince(
    sessionId: string,
    sinceRoundId: number,
    maxRound: number,
    roundIndex: Record<string, number>
  ): Promise<Array<{ roundId: number; success: boolean; error?: string }>> {
    const integration = this.rollbackIntegrations.get(sessionId);
    if (!integration) return [];

    const results: Array<{
      roundId: number;
      success: boolean;
      error?: string;
    }> = [];

    // 倒序撤消（从最新轮次往最早）
    for (let r = maxRound; r > sinceRoundId; r--) {
      try {
        await integration.undoRound(r);
        results.push({ roundId: r, success: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ roundId: r, success: false, error: errorMsg });
        // 失败不阻塞后续回滚
      }
      // 清理 roundIndex 中对应轮次的条目
      for (const [msgId, rid] of Object.entries(roundIndex)) {
        if (rid === r) {
          delete roundIndex[msgId];
        }
      }
    }

    return results;
  }

  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  async executeTool(
    toolCall: ToolCall,
    opts?: { useErrorHandler?: boolean }
  ): Promise<ToolResult> {
    const otel = getOTelTracing();
    const toolSpan = otel.startSpan(`chat.executeTool.${toolCall.name}`, {
      'tool.name': toolCall.name,
    });
    try {
      // Phase 2: ErrorHandler 双路径
      if (opts?.useErrorHandler && this.ENABLE_ERROR_HANDLER) {
        try {
          const handled = await ErrorHandler.handleAsync(
            () => this._executeToolInternal(toolCall),
            { recoveryStrategy: 'retry', maxRetries: 2 }
          );
          return handled.success && handled.result
            ? handled.result
            : {
                toolCallId: toolCall.id ?? '',
                toolName: toolCall.name,
                error: handled.error
                  ? String(handled.error)
                  : 'Tool execution failed',
              };
        } catch (err) {
          // ErrorHandler 自身异常 → 降级为原逻辑
          await handleError(err, {
            module: 'chat:ChatManager',
            action: 'executeTool_errorHandler_fallback',
          });
          logger.warn('ErrorHandler failed, falling back to direct execution', {
            error: err instanceof Error ? err.message : String(err),
          });
          return this._executeToolInternal(toolCall);
        }
      }
      const result = await this._executeToolInternal(toolCall);
      // Phase 2: 收敛检测 — 记录工具调用
      try {
        convergenceDetector.recordToolCall(
          toolCall.sessionId ?? '',
          toolCall.name,
          !result.error,
          toolCall.arguments as Record<string, unknown> | undefined
        );
      } catch (err) {
        // @ignore-catch — best-effort，收敛检测失败不影响主流程
        logger.debug('convergenceDetector.recordToolCall skipped', {
          toolName: toolCall.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    } catch (err) {
      await handleError(err, {
        module: 'chat:ChatManager',
        action: 'executeTool_fallback',
      });
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      toolSpan.end();
    }
  }

  /**
   * 工具执行内部实现（原 executeTool 逻辑）
   */
  private async _executeToolInternal(toolCall: ToolCall): Promise<ToolResult> {
    // 工具参数由 LLM 生成，不需要 Unicode 清理（用户输入在进入 LLM 前已清理）
    // 注意: 对工具参数做 NFKC 归一化会破坏文件路径中的全角字符（如 （）→()），导致文件找不到
    const normalizedToolCall = {
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments as Record<string, unknown>,
    };

    // 本地查询工具：直接从注册表返回，不经过工具注册表执行
    if (normalizedToolCall.name === 'get_tool_result') {
      const targetId = normalizedToolCall.arguments.tool_call_id as string;
      const stored = toolResultRegistry.findByCallId(targetId);
      logger.info('LLM 查询工具结果', {
        toolCallId: toolCall.id,
        targetId,
        found: !!stored,
      });
      if (!stored) {
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: { found: false, toolCallId: targetId },
          error: undefined,
        };
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: { found: true, toolCall: stored },
        error: undefined,
      };
    }

    if (normalizedToolCall.name === 'list_tool_calls') {
      const targetRound = normalizedToolCall.arguments.round as
        | number
        | undefined;
      const sessionId =
        (normalizedToolCall.arguments.sessionId as string) ||
        this._currentSessionId ||
        '';
      let calls: Array<{
        toolCallId: string;
        toolName: string;
        round: number;
        hasError: boolean;
        timestamp: number;
      }>;
      if (targetRound && sessionId) {
        calls = toolResultRegistry
          .listByRound(sessionId, targetRound)
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }));
      } else if (sessionId) {
        calls = toolResultRegistry.listBySession(sessionId).map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          round: c.round,
          hasError: !!c.result.error,
          timestamp: c.timestamp,
        }));
      } else {
        // 无 sessionId → 尝试跨所有 session 查找
        calls = toolResultRegistry
          .listAll()
          .map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            round: c.round,
            hasError: !!c.result.error,
            timestamp: c.timestamp,
          }))
          .slice(0, 50);
      }
      return {
        toolCallId: toolCall.id,
        toolName: normalizedToolCall.name,
        result: {
          toolCalls: calls,
          total: calls.length,
          sessionId: sessionId || undefined,
        },
        error: undefined,
      };
    }

    // 检查工具权限（P0-2 三态化：allow 执行 / ask 提交审批卡片 / deny 拦截）
    if (this.permissionManager) {
      const pm = this.permissionManager as {
        checkPermissionForTool: (
          name: string,
          args: Record<string, unknown>,
          context?: { sessionId?: string }
        ) => Promise<{
          allowed: boolean;
          reason?: string;
          decision?: { behavior: string; reason?: string };
          /** P1-2: 审批卡片是否已由 PermissionChecker 提交到 Inbox */
          submittedToInbox?: boolean;
        }>;
      };
      const permissionResult = await pm.checkPermissionForTool(
        normalizedToolCall.name,
        normalizedToolCall.arguments,
        // P1-2: 透传 sessionId，供 PermissionChecker 统一提交审批卡片
        { sessionId: toolCall.sessionId }
      );

      if (!permissionResult.allowed) {
        // ask 决策（评审：decision.behavior === 'ask'）→ 消费统一提交的审批卡片
        if (permissionResult.decision?.behavior === 'ask') {
          // P0-6: 已批准命令命中放行缓存（session+hash 精确匹配）→ 跳过 ask 直接执行，
          // 避免批准后 LLM 重发同一命令时重复弹审批卡片（评审缺口 G 闭环）
          const approvedHit = await this._isCommandApproved(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId
          );
          if (!approvedHit) {
            // P1-2: 卡片已由 PermissionChecker._submitToInbox 统一提交（决策携带 submittedToInbox）
            if (permissionResult.submittedToInbox === true) {
              // 非失败语义：SSE 流不标记 error，前端据此渲染"⏳ 等待审批"
              const approvalResult = {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批，已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
              } as const;
              // P2-2: 通过 tool:completed 事件把 pendingApproval 信号传给前端
              // （CoreAPIImpl 缓存进 tool_call 块 result，chat-handlers 转发 tool_completed SSE chunk）
              eventNotificationService.emitCustomEvent('tool:completed', {
                toolName: normalizedToolCall.name,
                sessionId: toolCall.sessionId,
                toolCallId: toolCall.id,
                resultData: approvalResult,
              });
              return {
                toolCallId: toolCall.id,
                toolName: normalizedToolCall.name,
                result: approvalResult,
                error: undefined,
              };
            }
            // Inbox 未提交（不可用/开关关闭）：返回普通 ask 文本（P1-3）
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `需要用户确认: ${permissionResult.reason || 'Tool requires approval'}`,
            };
          }
          // approvedHit：视为已授权，继续向下执行
        } else {
          // deny → 拦截
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result: null,
            error: `Permission denied: ${permissionResult.reason || 'Tool execution not allowed'}`,
          };
        }
      }
    }

    // 回滚：拦截文件工具操作（Write / Edit）
    // 在工具执行前记录文件的"操作前状态"
    if (
      normalizedToolCall.name === FILE_WRITE_TOOL_NAME ||
      normalizedToolCall.name === FILE_EDIT_TOOL_NAME
    ) {
      const filePath = normalizedToolCall.arguments?.file_path as
        | string
        | undefined;
      if (filePath && toolCall.sessionId) {
        const integration = this.rollbackIntegrations.get(toolCall.sessionId);
        if (integration) {
          const op: FileOperation = {
            path: filePath,
            type: 'modified',
          };
          integration.onToolBeforeExecute(op).catch((err) => {
            logger.warn('回滚：文件操作前追踪失败', { error: String(err) });
            // @ignore-catch — handleError已处理，回滚工具追踪异步抛错无需再处理
            handleError(err, {
              module: 'chat:ChatManager',
              action: 'rollback:onToolBeforeExecute',
            }).catch(() => {});
          });
        }

        // P1: 子 Agent 操作继承 — 同时记录到父会话的 tracker
        this.sessionGateway
          .getSession(toolCall.sessionId)
          .then((sess) => {
            const parentId = sess?.metadata?.parentSessionId as
              | string
              | undefined;
            if (parentId) {
              const parentIntegration = this.rollbackIntegrations.get(parentId);
              if (parentIntegration) {
                const op: FileOperation = {
                  path: filePath,
                  type: 'modified',
                };
                parentIntegration.onToolBeforeExecute(op).catch((err) => {
                  logger.debug('子Agent操作继承失败', {
                    error: String(err),
                    parentSessionId: parentId,
                  });
                });
              }
            }
          })
          .catch(() => {
            // 非关键路径，获取会话失败不影响主流程
          });
      }
    }

    // inputPath 安全校验：对图像类工具校验输入路径是否在已知路径集合中
    // 注意：生成类工具（image_svg_generate/canvas）不需要 inputPath，仅需输入路径的
    // 工具（image_analysis/image）才走校验与自动补全逻辑
    const IMAGE_INPUT_TOOLS = new Set(['image_analysis', 'image']);
    const IMAGE_TOOL_NAMES = new Set([
      ...IMAGE_INPUT_TOOLS,
      'image_svg_generate',
      'canvas',
    ]);
    if (IMAGE_INPUT_TOOLS.has(normalizedToolCall.name) && toolCall.sessionId) {
      const args = normalizedToolCall.arguments;
      let inputPath = (args.inputPath || args.file_path || args.path) as
        | string
        | undefined;

      if (!inputPath && normalizedToolCall.name === 'canvas') {
        // canvas import 使用 elements[0].src 作为图片路径
        const elements = args.elements as Array<{ src?: string }> | undefined;
        if (Array.isArray(elements) && elements.length > 0 && elements[0].src) {
          inputPath = elements[0].src;
        }
      }

      if (!inputPath) {
        // inputPath 为空时，从 imageContext 自动回退补全
        const ctx = this.imageContextService.getImageContext(
          toolCall.sessionId
        );
        if (ctx) {
          if (normalizedToolCall.name === 'image') {
            inputPath =
              ctx.lastEditedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastAnalyzedImage?.filePath;
          } else {
            inputPath =
              ctx.lastAnalyzedImage?.filePath ||
              ctx.lastGeneratedImage?.filePath ||
              ctx.lastEditedImage?.filePath;
          }
          if (inputPath) {
            logger.info('工具调用 inputPath 为空，从 imageContext 自动补全', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              autoFilledPath: inputPath,
            });
            normalizedToolCall.arguments = {
              ...args,
              inputPath,
            };
          }
        }
      }

      if (inputPath) {
        const knownPaths = this.imageContextService.getKnownImagePaths(
          toolCall.sessionId
        );

        if (knownPaths.length > 0 && !knownPaths.includes(inputPath)) {
          const closestPath = this.imageContextService.findClosestPath(
            inputPath,
            knownPaths
          );

          if (closestPath) {
            logger.warn('工具调用路径不匹配，自动修正为最接近的已知路径', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              correctedPath: closestPath,
            });
            normalizedToolCall.arguments = {
              ...args,
              inputPath: closestPath,
            };
          } else {
            logger.error('工具调用路径不在已知集合中，拒绝执行', {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              inputPath,
              knownPaths,
            });
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: null,
              error: `Invalid path: ${inputPath} is not in known image paths. Available paths: ${knownPaths.join(', ')}`,
            };
          }
        }
      }
    }

    if (this.toolRegistry) {
      // 直接使用工具注册表执行
      try {
        const context = {
          toolUseId: normalizedToolCall.id,
          // AA-2: 透传 sessionId 供 BashTool 查放行缓存（isApproved(sessionId, hash)），
          // 否则内层安全检查看不到批准记录，放行缓存结构性失效。
          sessionId: toolCall.sessionId,
          options: {
            cwd: resolveProjectRoot(),
            env: process.env as Record<string, string>,
          },
        };

        const registry = this.toolRegistry as unknown as {
          executeTool: (
            params: {
              toolName: string;
              input: Record<string, unknown>;
            },
            context: {
              toolUseId: string;
              options: Record<string, unknown>;
            }
          ) => Promise<{
            result?: unknown;
            data?: unknown;
            error?: string;
            metadata?: { error?: string };
            output?: string;
            status?: string;
            requireApproval?: boolean;
            approvalReason?: string;
          }>;
        };
        const toolResult = await registry.executeTool(
          {
            toolName: normalizedToolCall.name,
            input: normalizedToolCall.arguments,
          },
          context
        );

        // P1-1: 工具返回"需要审批"结果（如 media:delete 删除文件、knowledge:write 覆盖）
        // → 转会话内审批卡片，而非直接把"需审批"文本回喂 LLM
        if (
          (toolResult as { requireApproval?: boolean }).requireApproval ===
            true ||
          (toolResult as { status?: string }).status === 'requires_approval'
        ) {
          const approvalReason = (toolResult as { approvalReason?: string })
            .approvalReason;
          const submitted = await this._submitToolApproval(
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            toolCall.sessionId,
            toolCall.id,
            approvalReason
          );
          if (submitted) {
            return {
              toolCallId: toolCall.id,
              toolName: normalizedToolCall.name,
              result: {
                status: 'awaiting_approval',
                message: `工具 '${normalizedToolCall.name}' 需要审批（${
                  approvalReason || '高风险操作'
                }），已提交审批卡片等待用户批准。用户批准后可继续执行，请勿编造替代方案。`,
                pendingApproval: true,
              },
              error: undefined,
            };
          }
          // Inbox 不可用降级：返回工具原始"需审批"结果文本
          const rawError =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : toolResult.metadata?.error
                ? String(toolResult.metadata.error)
                : undefined;
          return {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
            result:
              (toolResult as { output?: string }).output ||
              toolResult.data ||
              toolResult.result,
            error: rawError,
          };
        }

        // 检查工具执行结果是否包含错误
        let error: string | undefined;
        if (toolResult.error) {
          error =
            typeof toolResult.error === 'string'
              ? toolResult.error
              : JSON.stringify(toolResult.error);
        } else if (toolResult.metadata?.error) {
          error =
            typeof toolResult.metadata.error === 'string'
              ? toolResult.metadata.error
              : JSON.stringify(toolResult.metadata.error);
        }

        // 注册图像工具输出路径到已知路径集合
        const resultData = (toolResult.data || toolResult.result) as
          | Record<string, unknown>
          | undefined;
        if (resultData && !error && toolCall.sessionId) {
          const extractedPaths =
            this.imageContextService.extractImagePathsFromResult(
              normalizedToolCall.name,
              resultData
            );
          if (extractedPaths.length > 0) {
            this.imageContextService.registerImagePaths(
              toolCall.sessionId,
              extractedPaths
            );
          }

          // 更新会话级图像上下文
          this.imageContextService.updateImageContext(
            toolCall.sessionId,
            normalizedToolCall.name,
            normalizedToolCall.arguments,
            resultData
          );

          // glob/FileSearch 结果注册到 SessionConfirmedPaths（方案 4）
          if (
            (normalizedToolCall.name === 'glob' ||
              normalizedToolCall.name === 'FileSearch') &&
            Array.isArray(resultData) &&
            toolCall.sessionId
          ) {
            const searchPath =
              (normalizedToolCall.arguments?.path as string) || process.cwd();
            this.imageContextService.confirmedPaths.addDirectoryListing(
              searchPath,
              resultData as string[]
            );
          }

          // 多媒体展示/生成完成后通知前端刷新 + create_project 完成后通知跳转
          if (
            normalizedToolCall.name === 'image_generate' ||
            normalizedToolCall.name === 'image_display' ||
            normalizedToolCall.name === 'video_display' ||
            normalizedToolCall.name === 'audio_play' ||
            normalizedToolCall.name === 'create_project'
          ) {
            eventNotificationService.emitCustomEvent('tool:completed', {
              toolName: normalizedToolCall.name,
              sessionId: toolCall.sessionId,
              toolCallId: toolCall.id,
              images: (resultData as Record<string, unknown>).images,
              resultData,
            });
          }
        }

        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: toolResult.data || toolResult.result,
          error,
          metadata: toolResult.metadata as Record<string, unknown> | undefined,
        };
      } catch (error) {
        handleError(error, {
          module: 'chat:manager',
          action: '工具执行失败',
          context: {
            toolCallId: toolCall.id,
            toolName: normalizedToolCall.name,
          },
        }).catch(() => {});
        return {
          toolCallId: toolCall.id,
          toolName: normalizedToolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else if (this.toolIntegration) {
      try {
        return this.toolIntegration.executeTool(toolCall);
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      throw new AppError(
        'No tool integration or tool registry initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
  }

  /**
   * 检查命令是否已批准放行（P0-6 放行缓存）
   *
   * 命中 ApprovedCommandRegistry（session 隔离 + 规范化 hash 精确匹配）视为已授权，
   * 仅对命令类工具生效（bash/shell/command）。批准后 LLM 重发同一命令时跳过 ask，
   * 避免重复弹审批卡片。
   */
  private async _isCommandApproved(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined
  ): Promise<boolean> {
    try {
      if (
        toolName !== 'bash' &&
        toolName !== 'shell' &&
        toolName !== 'command'
      ) {
        return false;
      }
      const command = typeof input.command === 'string' ? input.command : '';
      if (!command || !sessionId) return false;
      // P0-2: 统一 hashCommandForExecution，与提交审批端（PermissionChecker）hash 一致
      // P0-3: 精确 hash 命中 或 命令名级放行命中（非危险命令，安全层仍兜底）→ 跳过 ask 弹卡
      const { getApprovedCommandRegistry, hashCommandForExecution } =
        await import('@modules/permission');
      const registry = getApprovedCommandRegistry();
      return (
        registry.isApproved(sessionId, hashCommandForExecution(command)) ||
        registry.isCommandNameApproved(sessionId, command)
      );
    } catch {
      // registry 不可用时按未批准处理，不影响安全底线（ask 仍会提交卡片）
      return false;
    }
  }

  /**
   * 提交工具审批卡片到 Inbox（P0-2 工具执行审批链路）
   *
   * ask 决策 → 会话内审批卡片（InboxBlock）→ 用户批准后：
   * - inbox-handlers 将 metadata.commandHash 写入 ApprovedCommandRegistry（放行缓存）
   * - 前端 InboxBlock 向会话发送批准消息，触发 LLM 重新发起
   *
   * @returns 是否提交成功（Inbox 不可用时降级为 false，上层返回普通 ask 文本）
   */
  private async _submitToolApproval(
    toolName: string,
    input: Record<string, unknown>,
    sessionId: string | undefined,
    toolCallId: string,
    approvalReason?: string
  ): Promise<boolean> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      // P0-2: 统一 hashCommandForExecution，与执行端 BashTool hash 一致
      const { hashCommandForExecution } = await import('@modules/permission');
      const command = typeof input.command === 'string' ? input.command : '';
      const sid = sessionId || 'default';
      await inboxManager.submit(
        {
          sessionId: sid,
          type: 'approval',
          title: `工具审批: ${toolName}`,
          message:
            (approvalReason ? `${approvalReason}\n` : '') +
            `工具 '${toolName}' 请求执行（需人工确认）\n${
              command
                ? `命令: ${command}`
                : `参数: ${JSON.stringify(input).slice(0, 300)}`
            }`,
          options: ['approve', 'deny'],
          offlineCapable: true,
          source: 'permission',
          metadata: {
            toolName,
            sessionId: sid,
            toolCallId,
            commandHash: command ? hashCommandForExecution(command) : undefined,
            // P0-3: 携带原始命令，批准后写入放行缓存时提取命令名供命令名级放行
            command: command || undefined,
            inputPreview: JSON.stringify(input).slice(0, 300),
          },
        },
        sid
      );
      return true;
    } catch (err) {
      // P1-3：Inbox 提交失败降级为普通 ask 文本，不静默
      logger.warn('工具审批提交失败，降级为 ask 文本', {
        toolName,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * 创建新会话
   * @param params 创建会话的参数
   * @returns 会话对象
   */
  async createSession(params: CreateSessionParams): Promise<ChatSession> {
    const now = new Date();
    const sessionId =
      params.id ||
      'session_' +
        Date.now().toString(36) +
        Math.random().toString(36).slice(2);
    const session: ChatSession = {
      id: sessionId,
      title: params.title,
      state: SessionState.ACTIVE,
      metadata: {
        title: params.title,
        description: params.description,
        tags: params.tags,
        mode: params.mode,
        model: params.model,
        creator: params.creator,
        lastActivityAt: now,
        totalMessages: params.initialMessages?.length || 0,
        totalTokens: 0,
        totalCost: 0,
        titleAutoGenerated: false,
        ...params.metadata,
      },
      messages: params.initialMessages || [],
      createdAt: now,
      updatedAt: now,
    };

    this._chatSessions.set(session.id, session);
    this._currentSessionId = session.id;

    // 持久化会话到 FileSystemUnifiedStorage
    await this.sessionGateway
      .createSession({
        id: session.id,
        title: params.title ?? session.title,
        metadata: {},
      })
      .catch((e) => {
        handleError(e, {
          module: 'chat:manager',
          action: '持久化会话创建失败',
        });
      });

    // 触发 ChatSessionStart Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-start',
      data: { sessionId: session.id },
      sessionId: session.id,
    });

    // 追踪会话活跃度
    this.sessionAccess.trackActivityStart(session.id);

    return session;
  }

  /**
   * 确保会话已加载（内存缓存 → Gateway 降级 → 创建新会话）
   */
  private async _ensureSessionLoaded(sessionId: string): Promise<ChatSession> {
    // Step 1: 内存缓存命中
    const cached = this._chatSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    // Step 2: 尝试从 Gateway（持久化存储）加载
    try {
      const storedSession = await this.sessionGateway.getSession(sessionId);
      if (storedSession) {
        const storedMessages = await this.sessionGateway.getMessages(sessionId);
        const messages: Message[] = (storedMessages || []).map((m) => {
          let content: string;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const textBlocks = m.content.filter((b) => b.type === 'text');
            content =
              textBlocks.length > 0
                ? textBlocks
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                : '';
          } else {
            content = '';
          }
          return {
            id: m.id,
            role: m.role,
            content,
            createdAt: new Date(m.timestamp),
            updatedAt: new Date(m.timestamp),
            sessionId: storedSession.id,
            toolCallId: m.metadata?.toolCallId,
            metadata: m.metadata as Record<string, unknown> | undefined,
            blocks: m.blocks as unknown as
              | Record<string, unknown>[]
              | undefined,
            tool_calls: m.metadata?.tool_calls,
          } as Message;
        });
        const chatSession: ChatSession = {
          id: storedSession.id,
          title: storedSession.title,
          state: mapSessionStatusToState(storedSession.status),
          metadata: {
            title: storedSession.title || '',
            ...storedSession.metadata,
            totalMessages: messages.length,
            lastActivityAt: new Date(storedSession.lastActivityAt),
          },
          messages,
          createdAt: new Date(storedSession.createdAt),
          updatedAt: new Date(storedSession.updatedAt),
        };
        this._chatSessions.set(storedSession.id, chatSession);
        logger.info('从 Gateway 降级加载会话成功', { sessionId });
        return chatSession;
      }
    } catch (e) {
      logger.warn('Gateway 降级加载失败，将创建新会话', {
        sessionId,
        error: String(e),
      });
    }

    // Step 3: Gateway 也未找到 → 创建新会话
    logger.warn('会话未找到，创建新会话', { sessionId });
    return await this.createSession({
      title: 'New Session',
      id: sessionId,
    });
  }

  /**
   * 统一获取或加载会话（替代 _getLocalSession || createSession 模式）
   */
  private async _getOrLoadSession(
    sessionId: string,
    metadata?: Record<string, unknown>
  ): Promise<ChatSession> {
    const cached = this._chatSessions.get(sessionId);
    if (cached) {
      return cached;
    }

    try {
      const storedSession = await this.sessionGateway.getSession(sessionId);
      if (storedSession) {
        const storedMessages = await this.sessionGateway.getMessages(sessionId);
        const messages: Message[] = (storedMessages || []).map((m) => {
          let content: string;
          if (typeof m.content === 'string') {
            content = m.content;
          } else if (Array.isArray(m.content)) {
            const textBlocks = m.content.filter((b) => b.type === 'text');
            content =
              textBlocks.length > 0
                ? textBlocks
                    .map((b) => (b as { type: 'text'; text: string }).text)
                    .join('')
                : '';
          } else {
            content = '';
          }
          return {
            id: m.id,
            role: m.role,
            content,
            createdAt: new Date(m.timestamp),
            updatedAt: new Date(m.timestamp),
            sessionId: storedSession.id,
            toolCallId: m.metadata?.toolCallId,
            metadata: m.metadata as Record<string, unknown> | undefined,
            blocks: m.blocks as unknown as
              | Record<string, unknown>[]
              | undefined,
            tool_calls: m.metadata?.tool_calls,
          } as Message;
        });
        const chatSession: ChatSession = {
          id: storedSession.id,
          title: storedSession.title,
          state: mapSessionStatusToState(storedSession.status),
          metadata: {
            title: storedSession.title || '',
            ...storedSession.metadata,
            totalMessages: messages.length,
            lastActivityAt: new Date(storedSession.lastActivityAt),
          },
          messages,
          createdAt: new Date(storedSession.createdAt),
          updatedAt: new Date(storedSession.updatedAt),
        };
        this._chatSessions.set(storedSession.id, chatSession);

        // Session State Hydration
        try {
          const hydrated = this.sessionAccess.hydrateSession(chatSession);
          if (hydrated.todos || (hydrated.recentFiles?.length ?? 0) > 0) {
            chatSession.metadata = {
              ...chatSession.metadata,
              hydratedTodos: hydrated.todos,
              hydratedRecentFiles: hydrated.recentFiles,
              hydratedDecisions: hydrated.recentDecisions,
            };
          }
        } catch (err) {
          // 回灌失败不影响
          handleError(err, {
            module: 'chat:manager',
            action: 'hydrateDecisions_loadGateway',
          });
        }
        return chatSession;
      }
    } catch (e) {
      logger.warn('Gateway 加载失败，将创建新会话', {
        sessionId,
        error: String(e),
      });
    }

    return await this.createSession({
      title: 'New Session', // <-- loadSession fallback
      id: sessionId,
      metadata,
    });
  }

  /**
   * 切换会话
   * @param sessionId 会话ID
   */
  async switchSession(sessionId: string): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('ChatManager.switchSession', {
      'session.id': sessionId,
    });
    try {
      // 记录离开当前会话的时间戳（用于回切召回）
      if (this._currentSessionId && this._currentSessionId !== sessionId) {
        this._sessionLeaveTimes.set(this._currentSessionId, Date.now());
      }

      await this._ensureSessionLoaded(sessionId);
      this._currentSessionId = sessionId;

      // 会话切换时清理路径校验缓存
      clearPathCheckCache();

      // 检测回切：离开超过 30 秒时发射召回事件
      const leaveTime = this._sessionLeaveTimes.get(sessionId);
      if (leaveTime && Date.now() - leaveTime > 30_000) {
        this._sessionLeaveTimes.delete(sessionId);
        eventNotificationService.emitCustomEvent('agent:memory:recalling', {
          sessionId,
          awayMs: Date.now() - leaveTime,
        });
      }

      logger.info('会话切换成功', { sessionId });
      otel.endSpan(span);
    } catch (e) {
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR);
      await handleError(e, {
        module: 'chat:ChatManager',
        action: 'switchSession',
        context: { sessionId },
        rethrow: false,
      });
    }
  }

  /**
   * 获取当前会话
   * @returns 当前会话对象
   */
  getCurrentSession(): ChatSession | undefined {
    return this._getLocalSession(this._currentSessionId);
  }

  /**
   * 获取所有会话
   * @returns 会话列表
   */
  getSessions(): ChatSession[] {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 删除会话
   * @param sessionId 会话ID
   */
  deleteSession(sessionId: string): void {
    // 触发 ChatSessionEnd Hook
    this.hookChainManager.execute('chat', {
      event: 'chat.session-end',
      data: { sessionId },
      sessionId,
    });

    this._chatSessions.delete(sessionId);
    if (this._currentSessionId === sessionId) {
      this._currentSessionId = null;
    }

    // 停止会话活跃度追踪
    this.sessionAccess.trackActivityEnd(sessionId);

    // 同步删除持久化存储
    this.sessionGateway.deleteSession(sessionId).catch((e) => {
      handleError(e, {
        module: 'chat:manager',
        action: '从Gateway删除会话失败',
      });
    });
  }

  /**
   * 清除所有会话
   */
  async clearAllSessions(): Promise<void> {
    const sessionIds = Array.from(this._chatSessions.keys());
    for (const id of sessionIds) {
      this.hookChainManager.execute('chat', {
        event: 'chat.session-end',
        data: { sessionId: id },
        sessionId: id,
      });
    }
    this._chatSessions.clear();
    this._currentSessionId = null;

    // 清理持久化存储
    const storedSessions = await this.sessionGateway.listSessions();
    for (const stored of storedSessions) {
      // @ignore-catch — 清理阶段best-effort删除会话，单个失败不阻塞其他
      await this.sessionGateway.deleteSession(stored.id).catch(() => {});
    }
  }

  /**
   * 保存会话
   * @param session 会话对象
   */
  async saveSession(session: ChatSession): Promise<void> {
    this._chatSessions.set(session.id, session);
  }

  /**
   * 加载会话
   * @param sessionId 会话ID
   * @returns 会话对象
   */
  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    return this._getLocalSession(sessionId);
  }

  /**
   * 加载所有会话
   * @returns 会话列表
   */
  async loadSessions(): Promise<ChatSession[]> {
    return Array.from(this._chatSessions.values());
  }

  /**
   * 添加消息到会话
   * @param sessionId 会话ID
   * @param message 消息对象
   */
  addMessage(sessionId: string, message: Message): void {
    this._addAndPersistMessage(sessionId, message);
  }

  /**
   * 获取会话消息
   * @param sessionId 会话ID
   * @returns 消息列表
   */
  getSessionMessages(sessionId: string): Message[] {
    const session = this._getLocalSession(sessionId);
    return session?.messages || [];
  }

  /**
   * 搜索消息
   * @param query 搜索查询
   * @param sessionId 会话ID（可选）
   * @returns 消息列表
   */
  searchMessages(query: string, sessionId?: string): Message[] {
    if (sessionId) {
      const session = this._getLocalSession(sessionId);
      if (session) {
        return this.messageService.searchMessages(session.messages, query);
      }
      return [];
    } else {
      const allMessages: Message[] = [];
      for (const session of this._chatSessions.values()) {
        allMessages.push(...session.messages);
      }
      return this.messageService.searchMessages(allMessages, query);
    }
  }

  /**
   * 获取消息服务
   * @returns 消息服务
   */
  getMessageService(): MessageService {
    return this.messageService;
  }

  /**
   * 获取流服务
   * @returns 流服务
   */
  getStreamService(): StreamService {
    return this.streamService;
  }

  /**
   * 获取会话网关（持久化存储）
   * @returns 会话网关
   */
  getSessionGateway(): SessionGateway {
    return this.sessionGateway;
  }

  /**
   * 获取会话管理器
   * @returns 会话管理器
   */
  getSessionManager(): any {
    return {
      getSession: (id: string) => this._getLocalSession(id),
      getCurrentSession: () => this._getLocalSession(this._currentSessionId),
      setCurrentSession: (id: string) => {
        this._currentSessionId = id;
      },
      getSessions: () => Array.from(this._chatSessions.values()),
      addMessage: (id: string, msg: Message) =>
        this._addAndPersistMessage(id, msg),
      deleteSession: (id: string) => {
        this._chatSessions.delete(id);
      },
      saveSession: (s: ChatSession) => {
        this._chatSessions.set(s.id, s);
      },
      loadSession: (id: string) => Promise.resolve(this._getLocalSession(id)),
      loadSessions: () =>
        Promise.resolve(Array.from(this._chatSessions.values())),
      createCheckpoint: (sessionId: string, label?: string) =>
        this._checkpointService
          .saveCheckpointWithData(
            sessionId,
            this._getLocalSession(sessionId)?.messages || [],
            this._getLocalSession(sessionId)?.metadata || { title: '' },
            this._getLocalSession(sessionId)?.state || SessionState.ACTIVE,
            label
          )
          .then((cp) => cp.id),
      listCheckpoints: (sessionId: string) =>
        this._checkpointService.listCheckpoints(sessionId),
      rollbackToCheckpoint: (checkpointId: string) =>
        this._checkpointService.rollbackToCheckpoint(checkpointId, {
          messages: [],
          metadata: { title: '' },
          state: SessionState.ACTIVE,
        }),
      deleteCheckpoint: (checkpointId: string) =>
        this._checkpointService.deleteCheckpoint(checkpointId),
      deleteSessionCheckpoints: (sessionId: string) =>
        this._checkpointService.deleteSessionCheckpoints(sessionId),
      getLatestCheckpoint: (sessionId: string) =>
        this._checkpointService.getLatestCheckpoint(sessionId),
    };
  }

  /**
   * 根据模型名获取对应的 LLM 客户端
   * 如果模型属于其他 Provider（如 Ollama），自动创建对应的 ToolAwareClient
   */
  private getClientForModel(model?: string): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!model) return this.llmClient;

    const currentProviderId = this.llmClient.getProviderId();
    const resolvedProvider = providerRegistry.getByModel(model);

    if (resolvedProvider && resolvedProvider.id !== currentProviderId) {
      return new ToolAwareClient(
        resolvedProvider,
        this
          .toolRegistry as unknown as import('@modules/ai/interfaces/ToolExecutor').ToolRegistry,
        this.toolExecutor
      );
    }

    return this.llmClient;
  }

  /**
   * 获取LLM客户端
   * @returns LLM客户端
   */
  getLLMClient(): ToolAwareClient {
    if (!this.llmClient) {
      throw new AppError(
        'LLM client not initialized',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    return this.llmClient;
  }

  /**
   * 获取工具集成
   * @returns 工具集成
   */
  getToolIntegration(): ToolIntegration | undefined {
    return this.toolIntegration;
  }

  /**
   * 设置工具集成
   * @param toolIntegration 工具集成
   */
  setToolIntegration(toolIntegration: ToolIntegration): void {
    this.toolIntegration = toolIntegration;
  }

  /**
   * 设置LLM客户端
   * @param llmClient LLM客户端
   */
  setLLMClient(llmClient: ToolAwareClient): void {
    this.llmClient = llmClient;
  }

  /**
   * 设置工具注册表
   * @param registry 工具注册表
   */
  setToolRegistry(registry: ToolRegistry | null): void {
    this.toolRegistry = registry;
  }

  /**
   * 获取工具注册表
   * @returns 工具注册表
   */
  getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  /**
   * 设置权限管理器
   * @param permissionManager 权限管理器
   */
  setPermissionManager(permissionManager: unknown): void {
    this.permissionManager = permissionManager;
  }

  /**
   * 获取权限管理器
   * @returns 权限管理器
   */
  getPermissionManager(): unknown {
    return this.permissionManager;
  }

  /**
   * 设置工具执行器
   * @param toolExecutor 工具执行器
   */
  setToolExecutor(toolExecutor: IToolExecutor | null): void {
    this.toolExecutor = toolExecutor;
  }

  /**
   * 获取工具执行器
   * @returns 工具执行器
   */
  getToolExecutor(): IToolExecutor | null {
    return this.toolExecutor;
  }

  /**
   * 设置子Agent管理器
   * @param subAgentManager 子Agent管理器
   */
  setSubAgentManager(subAgentManager: unknown): void {
    this.subAgentManager = subAgentManager;
  }

  /**
   * 获取子Agent管理器
   * @returns 子Agent管理器
   */
  getSubAgentManager(): unknown {
    return this.subAgentManager;
  }

  /**
   * 获取会话元数据服务
   * @returns 会话元数据服务
   */
  getSessionMetadataService(): typeof sessionMetadataService {
    return sessionMetadataService;
  }

  /**
   * 获取事件通知服务
   * @returns 事件通知服务
   */
  getEventNotificationService(): typeof eventNotificationService {
    return eventNotificationService;
  }

  /**
   * 获取消息处理服务
   * @returns 消息处理服务
   */
  getMessageProcessingService(): typeof messageProcessingService {
    return messageProcessingService;
  }

  /**
   * 获取权限模式集成服务
   * @returns 权限模式集成服务
   */
  getPermissionModeIntegrationService(): typeof permissionModeIntegrationService {
    return permissionModeIntegrationService;
  }

  /**
   * 获取性能优化服务
   * @returns 性能优化服务
   */
  getPerformanceOptimizationService(): typeof performanceOptimizationService {
    return performanceOptimizationService;
  }

  /**
   * 获取安全服务
   * @returns 安全服务
   */
  getSecurityService(): typeof securityService {
    return securityService;
  }

  /**
   * 获取查询引擎
   * @returns QueryEngine实例
   */
  getQueryEngine(): QueryEngine {
    if (!this.queryEngine) {
      this.queryEngine = createQueryEngine(this, this.queryEngineConfig);
    }
    return this.queryEngine;
  }

  /**
   * 设置查询引擎配置
   * @param config 查询引擎配置
   */
  setQueryEngineConfig(config: QueryEngineConfig): void {
    this.queryEngineConfig = config;
    if (this.queryEngine) {
      this.queryEngine = createQueryEngine(this, config);
    }
  }

  /**
   * 使用查询引擎处理消息
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生消息块
   */
  async *query(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId ||
      (await this.createSession({ title: 'Query Session' })).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        yield message.content;
      } else if (message.type === 'tool_use' && message.toolUse) {
        yield `[工具调用: ${message.toolUse.name}]`;
      } else if (message.type === 'tool_result' && message.toolResult) {
        yield `[工具结果: ${message.toolResult.content}]`;
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    return undefined;
  }

  /**
   * 获取查询状态
   * @returns 查询状态
   */
  getQueryState(): string {
    if (!this.queryEngine) {
      return 'idle';
    }
    return this.queryEngine.getQueryState();
  }

  /**
   * 使用查询引擎进行流式查询
   * @param content 消息内容
   * @param options 选项
   * @returns 异步生成器，产生流式消息块
   */
  async *streamQuery(
    content: string,
    options?: {
      sessionId?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
      onChunk?: (chunk: string) => void;
      onComplete?: (result: unknown) => void;
    }
  ): AsyncGenerator<string, unknown, unknown> {
    const queryEngine = this.getQueryEngine();

    // 构建配置
    const config: QueryEngineConfig = {
      maxTurns: options?.maxTurns || this.queryEngineConfig?.maxTurns,
      maxBudgetUsd:
        options?.maxBudgetUsd || this.queryEngineConfig?.maxBudgetUsd,
    };

    // 更新配置
    this.setQueryEngineConfig(config);

    // 创建或获取会话
    const sessionId =
      options?.sessionId ||
      (await this.createSession({ title: 'Stream Query Session' })).id;

    // 使用QueryEngine处理消息
    const messages = queryEngine.submitMessage(content, { sessionId });

    let accumulatedResult: unknown[] = [];

    for await (const message of messages) {
      if (message.type === 'text' && message.content) {
        // 流式输出文本内容
        for (let i = 0; i < message.content.length; i += 10) {
          const chunk = message.content.slice(
            i,
            Math.min(i + 10, message.content.length)
          );
          options?.onChunk?.(chunk);
          yield chunk;
        }
        accumulatedResult.push({ type: 'text', content: message.content });
      } else if (message.type === 'tool_use' && message.toolUse) {
        const toolInfo = `[工具调用: ${message.toolUse.name}]`;
        options?.onChunk?.(toolInfo);
        yield toolInfo;
        accumulatedResult.push({ type: 'tool_use', toolUse: message.toolUse });
      } else if (message.type === 'tool_result' && message.toolResult) {
        const resultContent = `[工具结果: ${message.toolResult.content}]`;
        options?.onChunk?.(resultContent);
        yield resultContent;
        accumulatedResult.push({
          type: 'tool_result',
          toolResult: message.toolResult,
        });
      } else if (message.type === 'error') {
        throw new AppError(
          message.error || '查询错误',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
    }

    // 调用完成回调
    options?.onComplete?.({
      sessionId,
      result: accumulatedResult,
      state: this.getQueryState(),
    });

    return accumulatedResult;
  }

  /**
   * 检查是否需要压缩
   * @param sessionId 会话ID
   * @returns 压缩边界信息或null
   */
  async checkCompactBoundary(
    sessionId?: string
  ): Promise<CompactBoundary | null> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return null;
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return null;
    }

    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    return this.compactService.detectCompactBoundary(
      targetSessionId,
      sessionMessages
    );
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    const targetSessionId =
      sessionId || this._getLocalSession(this._currentSessionId)?.id;
    if (!targetSessionId) {
      return [];
    }

    const session = this._getLocalSession(targetSessionId);
    if (!session) {
      return [];
    }

    // 转换消息格式
    const sessionMessages: SessionMessage[] = session.messages.map((msg) => ({
      id: msg.id,
      type: msg.role as SessionMessage['type'],
      content:
        typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content),
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })) as unknown as SessionMessage[];

    const artifacts = await this.compactService.performCompact(
      targetSessionId,
      sessionMessages
    );

    // 如果有压缩产物，注入到会话中
    if (artifacts.length > 0) {
      await this.compactService.reinjectArtifacts(targetSessionId, artifacts);
    }

    return artifacts;
  }

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl {
    return this.compactService;
  }

  async createCheckpoint(sessionId: string, label?: string): Promise<string> {
    const session = this._getLocalSession(sessionId);
    if (!session) {
      throw new AppError(
        'Session not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1004'
      );
    }

    const cp = await this._checkpointService.saveCheckpointWithData(
      sessionId,
      session.messages,
      session.metadata,
      session.state,
      label
    );

    return cp.id;
  }

  async listCheckpoints(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint[]> {
    return this._checkpointService.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('./types/checkpoint').CheckpointDiff;
  }> {
    const checkpoint =
      await this._checkpointService.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new AppError(
        'Checkpoint not found',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1005'
      );
    }

    await this._checkpointService.rollbackToCheckpoint(checkpointId, {
      messages: checkpoint.messages || [],
      metadata: checkpoint.metadata || { title: '' },
      state: SessionState.ACTIVE,
    });

    return {
      session:
        this._getLocalSession(checkpoint.sessionId) ||
        (await this.createSession({ title: 'Rollback Session' })),
      diff: {
        addedMessages: 0,
        removedMessages: checkpoint.messages?.length || 0,
        stateChanged: true,
        metadataChanged: true,
        summary: `Rolled back to checkpoint: ${checkpointId}`,
      },
    };
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this._checkpointService.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint | null> {
    return this._checkpointService.getLatestCheckpoint(sessionId);
  }

  /**
   * Session Memory 累计 + 阈值检测 + 触发提炼
   * 每轮对话后调用，fire-and-forget 不阻塞响应
   */
  private _accumulateSessionMemory(
    sessionId: string,
    userMessage: string,
    assistantResponse: string,
    tokens: number,
    toolCalls: number
  ): void {
    try {
      const mm = this.sessionAccess.getMemoryManager();
      let memory = mm.loadMemory(sessionId);
      if (memory.items.length === 0) {
        mm.initMemory(sessionId);
      }

      const input = {
        userMessage,
        assistantResponse,
        tokens,
        toolCalls,
      };
      const result = mm.accumulateTurn(memory, input);

      if (result.shouldTrigger) {
        // fire-and-forget: LLM 智能提炼 → memory.md
        const llmClient = this.llmClient;
        const session = this._chatSessions.get(sessionId);
        if (llmClient && session) {
          setImmediate(async () => {
            try {
              // 构建最近对话文本
              const recentMsgs = (session.messages || []).slice(-10);
              const conversationText = recentMsgs
                .map(
                  (m) =>
                    `[${m.role}]: ${typeof m.content === 'string' ? m.content.slice(0, 500) : ''}`
                )
                .join('\n');

              const existingMemory =
                mm.readRawMemory(sessionId) ||
                this.sessionAccess
                  .getMemoryTemplate()
                  .replace('{{lastExtraction}}', new Date().toISOString());

              // LLM 提炼
              const extractor = this.sessionAccess.createMemoryExtractor({
                sendMessage: (msgs) =>
                  llmClient
                    .sendMessage(msgs as ChatMessage[])
                    .then((r) => r.content),
              });
              const memoryContent = await extractor.extract(
                conversationText,
                existingMemory
              );

              mm.writeRawMemory(sessionId, memoryContent);
              logger.info('Session Memory LLM 提炼完成', { sessionId });
            } catch (err) {
              logger.warn('Session Memory LLM 提炼失败', {
                sessionId,
                error: String(err),
              });
              // 降级：简单追加用户消息摘要
              try {
                mm.appendToMemory(result.memory, [
                  {
                    type: 'discussion' as const,
                    content: userMessage.slice(0, 200),
                  },
                ]);
              } catch (err) {
                // 降级也失败，放弃
                handleError(err, {
                  module: 'chat:manager',
                  action: 'fallback_summarize',
                });
              }
            }
          });
        } else {
          // 无 LLM 可用：简单降级
          setImmediate(() => {
            try {
              mm.appendToMemory(result.memory, [
                {
                  type: 'discussion' as const,
                  content: userMessage.slice(0, 200),
                },
              ]);
            } catch (err) {
              /* 忽略 */
              logger.debug(
                'Memory append skipped (discussion fallback failed)',
                {
                  sessionId,
                  error: err instanceof Error ? err.message : String(err),
                }
              );
            }
          });
        }
      }
    } catch (err) {
      // 记忆系统失败不影响主流程
      logger.debug('Session Memory accumulation skipped', {
        sessionId,
        error: String(err),
      });
    }
  }
}

/**
 * 创建聊天管理器实例
 * @returns 聊天管理器实例
 */
export function createChatManager(): ChatManager {
  return new ChatManagerImpl();
}

/**
 * 将工具执行异常转换为用户友好提示。
 * 过滤 OpenAI SDK / fetch 级别的技术错误（如 socket 关闭），
 * 避免向用户暴露底层实现细节。
 */
function getToolExecErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return `工具执行异常: ${String(err).slice(0, 200)}`;
  }
  const msg = err.message;
  const lower = msg.toLowerCase();

  // ── 服务商过载/不可用 ──
  if (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('too busy') ||
    lower.includes('server error') ||
    lower.includes('service unavailable') ||
    lower.includes('capacity')
  ) {
    let detail = '';
    try {
      const jsonMatch = msg.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const body = JSON.parse(jsonMatch[0]);
        if (body.code) detail = ` (${body.code})`;
        if (body.message) detail = ` (${body.code || ''}: ${body.message})`;
      }
    } catch {
      /* ignore */
    }
    return `AI 服务繁忙，请稍后重试${detail}`;
  }

  // ── 频率限制 ──
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return '请求过于频繁，请稍后重试';
  }

  // ── 认证/权限 ──
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key')
  ) {
    return 'AI 服务认证失败，请检查模型配置中的 API Key';
  }

  // ── 上下文溢出 ──
  if (
    lower.includes('context length') ||
    lower.includes('too long') ||
    lower.includes('maximum context') ||
    lower.includes('token limit')
  ) {
    return '输入内容过长，请缩短输入或开启会话压缩';
  }

  // ── 超时 ──
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'AI 服务响应超时，请稍后重试';
  }

  // ── mutex 死锁 ──
  if (lower.includes('simplemutex') || lower.includes('acquire timeout')) {
    return '会话正在处理中，请等待上一条消息完成后重试';
  }

  // socket 连接意外关闭 → AI 服务响应中断
  if (msg.includes('socket connection was closed')) {
    return 'AI 服务响应中断，请重试';
  }
  // fetch 超时 / 网络错误
  if (
    msg.includes('fetch failed') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ENOTFOUND')
  ) {
    return '连接 AI 服务失败，请检查网络后重试';
  }

  // 超过 200 字符的未知错误也截断
  return `工具执行异常: ${msg.slice(0, 200)}`;
}

// 向后兼容导出
export type { ChatManager } from './ChatManagerInterface.js';
