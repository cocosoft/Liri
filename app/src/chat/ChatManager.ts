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

import { configManager } from '@modules/config';
import { getLogger, getOTelTracing } from '@modules/monitoring';
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
import { stripBareExploration } from './services/bareExplorationStripper';
import { SessionAccessFacade } from './services/SessionAccessFacade';
import { SessionLifecycleManager } from './services/SessionLifecycleManager.js';
import { ResumeCoordinator } from './services/ResumeCoordinator.js';
import { ContextCompactor } from './services/ContextCompactor.js';
import { SessionSummarizer } from './services/SessionSummarizer';
import { SessionMemoryManager } from './services/SessionMemoryManager';
import { TaskFacade } from './facades/TaskFacade';
import { PdcaLauncher } from './launchers/PdcaLauncher';
import { ChatOrchestrator } from './orchestrator/ChatOrchestrator.js';

const logger = getLogger('chat:manager');
import { SimpleMutex } from '@modules/core/SimpleMutex';
import { ImplicitEngineHook } from '../project/ImplicitEngineHook';
import { createProjectStore } from '../workspace/ProjectStore.js';
import { WorkItemStore } from '../workspace/WorkItemStore.js';
import { resolveDataDir } from '@modules/core/paths';
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
import { DataSessionStatus } from '@modules/core/data-models';
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
import { PlainTextCheckpoint } from './services/PlainTextCheckpoint.js';
import { isCheckpointLogEnabled } from '../config/settings/CheckpointLogConfig';
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
import {
  PlanDrivenLoop,
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
} from '../core/loop/PlanDrivenLoop.js';
import type { PlanDrivenLoopResult } from '../core/loop/PlanDrivenLoop.js';
import { ReActToolLoop } from './ReActToolLoop.js';
import type { ToolLoopContext } from './ToolLoopRunner.js';
import { withToolTimeout } from './services/ToolTimeoutWrapper.js';
import { ToolExecutionService } from './services/ToolExecutionService.js';
import type { ToolExecutionDeps } from './services/ToolExecutionService.js';
import { StreamPipeline } from './pipeline/StreamPipeline.js';
import type { PipelineContext } from './pipeline/StreamPipeline.js';
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
   * S1: 中止指定会话的流式请求
   * 用于 req.on('close') → 通知后端停止工具执行
   */
  public abortSessionStream(sessionId: string): void {
    const controller = this._sessionAbortControllers.get(sessionId);
    if (controller) {
      logger.info('req.on(close) 触发 — 中止会话流', { sessionId });
      controller.abort();
      // P2 修复（AB-2）：中止后立即清理条目，防止 isSessionStreaming() 恒 true
      // （幽灵块永久误报）。正常路径由 _finalizeStreamMessage（L2342-2346）删除，
      // 此处兜底幂等；若内层生成器被遗弃、_finalizeStreamMessage 永不执行，
      // 旧条目也会在此清理。
      if (this._sessionAbortControllers.get(sessionId) === controller) {
        this._sessionAbortControllers.delete(sessionId);
      }
    }
  }

  /**
   * P1-4: 确定性等待旧流中止后的清理（替代硬编码 setTimeout 100ms）
   * abort() 同步设置 signal.aborted，旧流在下一个 await 点感知并进入清理
   * （Provider 层取消 reader → 抛错 → finally 释放锁 → _finalizeStreamMessage 删 controller）。
   * 轮询 _sessionAbortControllers 直到旧流被移除；500ms 兜底——若 Provider 不响应
   * signal（仅靠 60s 无数据超时），不再无限等待，新流直接开始（互不阻塞，锁独立）。
   */
  private async _waitForAbortSettled(
    sessionId: string,
    controller: AbortController
  ): Promise<void> {
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      if (this._sessionAbortControllers.get(sessionId) !== controller) return;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /**
   * 传统工具循环最大轮次（防止无 TAORLoop 保护时的死循环）
   * 可通过环境变量 MAX_TAOR_TURNS 或 MAX_TOOL_TURNS 覆盖，默认 300
   */
  private readonly MAX_TOOL_TURNS = (() => {
    const env =
      configManager.env('MAX_TAOR_TURNS') ||
      configManager.env('MAX_TOOL_TURNS');
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
   * 工具执行服务（P3：从 ChatManager 提取 executeTool + _executeToolInternal）
   */
  private _toolExecutionService: ToolExecutionService | null = null;

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
   * 待处理的用户交互（工具暂停/恢复机制）— 按 sessionId 隔离（P0-1）
   * 当工具需要用户输入时，streamMessage 会 yield question 分块，
   * 然后 await 此 Promise，直到 UI 层调用 resolveInteraction() 解析
   * 多会话并行时互不覆盖（原为单例，会话 B 的交互会覆盖 A 的 Promise）
   */
  private _pendingInteractions = new Map<
    string,
    {
      questionId: string;
      promise: Promise<string[]>;
      resolve: (answers: string[]) => void;
    }
  >();

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
    configManager.env('ENABLE_AGENT_TELEMETRY') === 'true';
  private readonly ENABLE_TRAJECTORY =
    configManager.env('ENABLE_TRAJECTORY') === 'true';
  private readonly ENABLE_ERROR_HANDLER =
    configManager.env('ENABLE_ERROR_HANDLER') === 'true';
  /**
   * RC-E（08-09）：PlanDrivenLoop 开关（默认 false，灰度启用）
   * 启用后，_launchImplicitPdca 使用 PlanDrivenLoop 替代 LongRunningTaskOrchestrator。
   */
  private readonly ENABLE_PLAN_DRIVEN_LOOP =
    configManager.env('ENABLE_PLAN_DRIVEN_LOOP') === 'true';

  /**
   * RC-D（08-09）：Durable Resume 灰度开关（默认启用）
   * 关闭后跳过启动时的断点续传扫描。
   * 可通过 ENABLE_DURABLE_RESUME=false 关闭。
   */
  private readonly ENABLE_DURABLE_RESUME =
    configManager.env('ENABLE_DURABLE_RESUME') !== 'false';

  /**
   * Phase 2: TAORLoop 统一编排器开关（RC-A 08-09：默认全量启用）
   * 启用后 sendMessage/streamMessage 委托 TAORLoop 编排工具调用循环。
   * 可通过 ENABLE_LOOP_V8_PHASE2=false 关闭。
   */
  private readonly ENABLE_LOOP_V8_PHASE2 =
    configManager.env('ENABLE_LOOP_V8_PHASE2') !== 'false';

  /**
   * P2-3: TAORLoop 流量百分比（0~100，RC-A 08-09：默认 100 全量）
   * 仅在 ENABLE_LOOP_V8_PHASE2=true 时生效。
   * 按 sessionId hash 决定是否走 TAORLoop 路径。
   * 可通过 TAORLOOP_TRAFFIC_PERCENT 降级。
   */
  private readonly _taorLoopTrafficPercent: number = (() => {
    const raw = configManager.env('TAORLOOP_TRAFFIC_PERCENT');
    const val = raw && !isNaN(Number(raw)) ? Number(raw) : 100;
    return Math.min(100, Math.max(0, val));
  })();

  /**
   * P2-3: 按 sessionId hash 决定是否走 TAORLoop 路径
   * RC-A（08-09）：默认 100% 全量，hash 逻辑仅在降级时生效。
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
   * S3（P1-5 §5 S3）：快速路径流量百分比（0~100，灰度期默认 10）
   * 仅在 ENABLE_PLAN_DRIVEN_LOOP=true 时生效，按 message 粒度 hash 分流。
   * 可通过 PLAN_DRIVEN_LOOP_TRAFFIC_PERCENT 调整。
   */
  private readonly _planDrivenLoopTrafficPercent: number = (() => {
    const raw = configManager.env('PLAN_DRIVEN_LOOP_TRAFFIC_PERCENT');
    const val = raw && !isNaN(Number(raw)) ? Number(raw) : 10;
    return Math.min(100, Math.max(0, val));
  })();

  /**
   * S3（2026-08-13，P1-5 §5 S3）：PlanDrivenLoop 快速路径两层分流
   * ① isEligibleForFastPath：复杂度门（isSimpleTask，S0 冻结判定）+ 危险工具准入筛除
   * ② 剩余合格任务按 message 粒度 hash 分流（默认 10%，避免 sessionId 与任务类型相关偏差）
   * 日志可观测：筛除数（第一层剔除）+ 分流数（第二层 hash 命中）。
   */
  private _shouldUsePlanDrivenLoop(message: string): boolean {
    if (!this.ENABLE_PLAN_DRIVEN_LOOP) return false;
    if (!isEligibleForFastPath(message)) {
      logger.debug('PlanDrivenLoop 分流：复杂度门/危险工具筛除', {
        messagePreview: message.slice(0, 50),
        complexity: classifyTaskComplexity(message),
        dangerousTool: hasDangerousToolIntent(message),
      });
      return false;
    }
    if (this._planDrivenLoopTrafficPercent >= 100) return true;
    if (this._planDrivenLoopTrafficPercent <= 0) return false;
    // message 粒度 hash（与 sessionId 解耦）
    const hash = this._hashMessage(message);
    const shouldUse = hash < this._planDrivenLoopTrafficPercent;
    logger.info('PlanDrivenLoop 分流', {
      messagePreview: message.slice(0, 50),
      hash,
      trafficPercent: this._planDrivenLoopTrafficPercent,
      fastPath: shouldUse,
    });
    return shouldUse;
  }

  /** message 粒度 hash（S3：字符串散列 → 0~99，避开 sessionId 偏差） */
  private _hashMessage(message: string): number {
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      hash = (hash * 31 + message.charCodeAt(i)) >>> 0;
    }
    return hash % 100;
  }

  /**
   * P0 修复（2026-08-14 排查）：TAORLoop 按 sessionId 的 Map 缓存——原单例 `_taorLoop`
   * 首次调用固化了 sessionId，若首个检查点 sessionId 为空（脏数据），之后所有会话
   * 共用绑定空 id 的 TAORLoop → steering 队列/检查点跨会话串扰。Map 化 + 非空校验根治。
   */
  private readonly _taorLoops = new Map<string, TAORLoop>();

  /**
   * RC-E（08-09）：PlanDrivenLoop 实例（懒初始化，仅在 ENABLE_PLAN_DRIVEN_LOOP 时创建）
   */
  private _planDrivenLoop?: PlanDrivenLoop;

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

  /** 会话生命周期门面（SessionLifecycleManager 拆分） */
  private sessionLifecycle: SessionLifecycleManager;

  /** 检查点/恢复门面（ResumeCoordinator 拆分） */
  private resumeCoordinator: ResumeCoordinator;

  /** 上下文压缩门面（ContextCompactor 拆分） */
  private contextCompactor: ContextCompactor;

  /** 消息编排门面（ChatOrchestrator 拆分） */
  private chatOrchestrator: import('./orchestrator/ChatOrchestrator.js').ChatOrchestrator;

  /** 第一阶段收敛：会话摘要生成器 */
  private _summarizer: SessionSummarizer | null = null;

  /** 第一阶段收敛：Session Memory 管理器 */
  private _memoryManager: SessionMemoryManager | null = null;

  /** 第一阶段收敛：PDCA 启动器 */
  private _pdcaLauncher: PdcaLauncher | null = null;

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

    // 第一阶段收敛：初始化提取的服务
    this._summarizer = new SessionSummarizer(this.llmClient);
    this._memoryManager = new SessionMemoryManager(
      this.sessionAccess,
      this.llmClient,
      this._chatSessions
    );
    this._pdcaLauncher = new PdcaLauncher({
      enablePlanDrivenLoop: this.ENABLE_PLAN_DRIVEN_LOOP,
      taorLoopFactory: (sid) => this._getOrCreateTAORLoop(sid),
      buildTAORContext: (sid, defs, opts) =>
        this._buildTAORContext(sid, defs, opts),
      sessionMap: this._chatSessions,
      messageService: this.messageService,
      persistMessage: (sid, msg) => this._addAndPersistMessage(sid, msg),
    });

    // 第三阶段收敛：初始化工具执行服务
    this._toolExecutionService = new ToolExecutionService({
      getToolRegistry: () => this.toolRegistry,
      getToolIntegration: () => this.toolIntegration ?? null,
      getPermissionManager: () => this.permissionManager,
      imageContextService: this.imageContextService,
      rollbackIntegrations: this.rollbackIntegrations,
      sessionGateway: this.sessionGateway,
      chatSessions: this._chatSessions,
      currentSessionId: this._currentSessionId ?? '',
      enableErrorHandler: this.ENABLE_ERROR_HANDLER,
      submitToolApproval: this._submitToolApproval.bind(this),
      getSessionWorkspacePath: this.getSessionWorkspacePath.bind(this),
      getSessionWorkspaceId: this.getSessionWorkspaceId.bind(this),
      isCommandApproved: this._isCommandApproved.bind(this),
    });

    // 会话生命周期门面：与会话状态共享 Map 引用 + currentSessionId 端口
    this.sessionLifecycle = new SessionLifecycleManager({
      chatSessions: this._chatSessions,
      currentSessionIdRef: {
        get: () => this._currentSessionId,
        set: (id) => {
          this._currentSessionId = id;
        },
      },
      sessionLeaveTimes: this._sessionLeaveTimes,
      sessionMutexes: this._sessionMutexes,
      sessionAbortControllers: this._sessionAbortControllers,
      sessionGateway: this.sessionGateway,
      sessionAccess: this.sessionAccess,
      hookChainManager: this.hookChainManager,
      messageService: this.messageService,
    });

    // 检查点/恢复门面：注入 checkpointService + 共享会话 Map + createSession 委托
    this.resumeCoordinator = new ResumeCoordinator({
      checkpointService: this._checkpointService,
      chatSessions: this._chatSessions,
      createSession: (p) => this.createSession(p),
    });

    // 上下文压缩门面：注入 compactService + 共享会话 Map + currentSessionId 端口
    this.contextCompactor = new ContextCompactor({
      compactService: this.compactService,
      chatSessions: this._chatSessions,
      currentSessionIdRef: {
        get: () => this._currentSessionId,
        set: (id) => {
          this._currentSessionId = id;
        },
      },
    });

    // 消息编排门面：注入 host 端口（sendMessage/streamMessage 编排委托）
    const managerRef = this;
    this.chatOrchestrator = new ChatOrchestrator({
      host: {
        chatSessions: this._chatSessions,
        sessionMutexes: this._sessionMutexes,
        sessionAbortControllers: this._sessionAbortControllers,
        currentSessionIdRef: {
          get: () => this._currentSessionId,
          set: (id) => {
            this._currentSessionId = id;
          },
        },
        pendingInteractions: this._pendingInteractions as unknown as Map<
          string,
          unknown
        >,
        streamingCheckpoint: this._streamingCheckpoint,
        get toolRoundCount(): number {
          return managerRef._toolRoundCount;
        },
        get executingPlan(): boolean {
          return managerRef._executingPlan;
        },
        withExecutingPlan: async <T>(
          flag: boolean,
          fn: () => Promise<T>
        ): Promise<T> => {
          const prev = this._executingPlan;
          this._executingPlan = flag;
          try {
            return await fn();
          } finally {
            this._executingPlan = prev;
          }
        },
        ENABLE_TELEMETRY: this.ENABLE_TELEMETRY,
        ENABLE_TRAJECTORY: this.ENABLE_TRAJECTORY,
        ENABLE_PLAN_DRIVEN_LOOP: this.ENABLE_PLAN_DRIVEN_LOOP,
        MAX_TOOL_TURNS: this.MAX_TOOL_TURNS,
        messageService: this.messageService,
        sessionLifecycle: this.sessionLifecycle,
        hookChainManager: this.hookChainManager,
        unifiedTracker: this.unifiedTracker,
        imageContextService: this.imageContextService,
        checkpointService: this._checkpointService,
        memoryManager: this._memoryManager,
        summarizer: this._summarizer,
        pdcaLauncher: this._pdcaLauncher,
        getLLMClient: () => this.llmClient as ToolAwareClient,
        getClientForModel: (model?: string) => this.getClientForModel(model),
        getToolRegistry: () => this.toolRegistry,
        buildToolDefinitions: (schemas: unknown[]) =>
          this._buildToolDefinitions(schemas as ToolSchema[]),
        loopDetector: this
          ._loopDetector as import('../query/LoopDetector.js').LoopDetector,
        addAndPersistMessage: (sid, msg) =>
          this._addAndPersistMessage(sid, msg),
        getSessionMachine: (sid) => this.getSessionMachine(sid),
        getOrAssembleSystemPrompt: (session, content) =>
          this.getOrAssembleSystemPrompt(session, content),
        extractFilePathsFromText: (text) => this.extractFilePathsFromText(text),
        extractMemoryFromChat: (u, a, sid) =>
          this.extractMemoryFromChat(u, a, sid),
        recordChatResponseUsage: (sid, usage) =>
          this.recordChatResponseUsage(sid, usage),
        sanitizeApiMessages: (msgs) => this._sanitizeApiMessages(msgs),
        truncateApiMessages: (msgs, max, sid, outputBudgetTokens) =>
          this._truncateApiMessages(msgs, max, sid, outputBudgetTokens),
        persistTurnSummary: (session) => this._persistTurnSummary(session),
        flushPendingPersists: () => this.flushPendingPersists(),
        shouldUseTAORLoop: (sid) => this._shouldUseTAORLoop(sid),
        getOrCreateTAORLoop: (sid) => this._getOrCreateTAORLoop(sid),
        buildTAORContext: (sid, defs, opts) =>
          this._buildTAORContext(sid, defs, opts),
        executeTool: (tc, opts) => this.executeTool(tc as ToolCall, opts),
        executeStepPrompt: (prompt, session, options) =>
          this.executeStepPrompt(prompt, session, options),
        executePlanSteps: (session, options) =>
          this.executePlanSteps(session, options),
        triggerCouncilDebate: (wid, topic, ctx) =>
          this.triggerCouncilDebate(wid, topic, ctx),
        sendMessageDowngradePath: (session, tcs, msgs, client, options) =>
          this._sendMessageDowngradePath(session, tcs, msgs, client, options),
        shouldTriggerCouncil: (session, content, options) =>
          session.metadata?.is_ultraplan_mode === true ||
          containsComplexKeywords(content) ||
          options?.metadata?.councilTriggeredManually === true,
        triggerCouncilDebateAsync: (session, content, options) => {
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
        },
        endTurnTelemetry: (sessionId, _ok, content) => {
          if (this.ENABLE_TELEMETRY) {
            try {
              agentTelemetry.endTurn(sessionId, 'completed');
            } catch (err) {
              logger.debug('Telemetry recording skipped', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
          if (this.ENABLE_TRAJECTORY) {
            try {
              trajectoryRecorder.recordStep(sessionId, {
                phase: 'response',
                output: content ? content.slice(0, 500) : '',
              });
              trajectoryRecorder.completeSession(sessionId);
              trajectoryRuntime.completeSession(sessionId);
            } catch (err) {
              logger.debug('Telemetry recording skipped', {
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        },
        onTurnEnd: () => this.onTurnEnd?.(),
        _prepareStreamSession: (content, options) =>
          this._prepareStreamSession(content, options),
        _buildApiMessagesForStream: (msgs) =>
          this._buildApiMessagesForStream(msgs),
        _createStreamPipeline: (session, content, options) =>
          this._createStreamPipeline(session, content, options),
        _finalizeStreamMessage: (
          session,
          content,
          acc,
          am,
          fr,
          abortCtl,
          span,
          options
        ) =>
          this._finalizeStreamMessage(
            session,
            content,
            acc,
            am,
            fr as ChatResponse,
            abortCtl,
            span as ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
            options
          ),
        startRollbackRound: (sid, roundId) =>
          this._startRollbackRound(sid, roundId),
        endRollbackRound: (sid, content, firstContent) =>
          this._endRollbackRound(sid, content, firstContent),
        buildToolRoundMessages: (msgs, am, tcs, prs) =>
          this._buildToolRoundMessages(msgs, am, tcs, prs),
      },
    });
  }

  /**
   * 获取或创建 TAORLoop 实例（懒初始化）
   * 仅在 ENABLE_LOOP_V8_PHASE2 启用时调用
   */
  private _getOrCreateTAORLoop(sessionId: string): TAORLoop {
    // P0 修复（2026-08-14 排查）：空 sessionId 拒绝创建——原单例首次调用固化空 id，
    // 导致所有会话串扰同一 TAORLoop。改为按 sessionId 的 Map 缓存 + 非空校验。
    if (!sessionId) {
      logger.warn(
        '_getOrCreateTAORLoop: 拒绝空 sessionId（防 TAORLoop 串扰污染）'
      );
      throw new Error('TAORLoop requires a non-empty sessionId');
    }
    let taorLoop = this._taorLoops.get(sessionId);
    if (!taorLoop) {
      taorLoop = createTAORLoop(this.getQueryEngine(), {
        sessionId,
        maxTurns: parseInt(configManager.env('MAX_TAOR_TURNS') || '') || 300,
        /** 启用检查点，每 3 轮自动保存（原值：关闭 + 5 轮） */
        enableCheckpoint: true,
        checkpointInterval: 3,
      } satisfies TAORLoopConfig);
      this._taorLoops.set(sessionId, taorLoop);
    }
    return taorLoop;
  }

  /**
   * RC-E（08-09）：获取或创建 PlanDrivenLoop 实例（懒初始化）
   * 仅在 ENABLE_PLAN_DRIVEN_LOOP 启用时调用
   */
  private _getOrCreatePlanDrivenLoop(
    sessionId: string,
    taorContext: ChatManagerTAORContext
  ): PlanDrivenLoop {
    if (!this._planDrivenLoop) {
      const taorLoop = this._getOrCreateTAORLoop(sessionId);
      const deps = createChatManagerTAORDeps(taorContext);
      this._planDrivenLoop = new PlanDrivenLoop({
        taorLoop,
        deps,
        sessionId,
        enableAutoDecompose: true,
        onStepProgress: (progress) => {
          logger.info('PlanDrivenLoop 进度', {
            sessionId,
            ...progress,
          });
        },
      });
    }
    return this._planDrivenLoop;
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
    // P1 修复（2026-08-15）：空正文消息告警 — assistant 消息 content 为空
    // 且 blocks 无 text 块（含纯 thinking 收尾/纯 tool_call 无正文）时，
    // 记录告警供可观测性排查（此前被静默持久化为"成功"，i18n saveEmptyContent
    // 文案长期无调用点）。不阻断持久化（正常返回），仅告警。
    if (
      message.role === 'assistant' &&
      typeof message.content === 'string' &&
      message.content.trim() === ''
    ) {
      const hasTextBlock = (message.blocks ?? []).some(
        (b) => (b as { type?: unknown }).type === 'text'
      );
      if (!hasTextBlock) {
        const blockTypes = (message.blocks ?? [])
          .map((b) => (b as { type?: unknown }).type)
          .filter(Boolean);
        logger.warn('chat:空正文助手消息被持久化', {
          sessionId,
          messageId: message.id,
          contentLen: message.content.length,
          blockTypes,
          hasToolCalls: !!message.tool_calls?.length,
        });
      }
    }
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
      // 排查日志：前端 id 未命中（旧数据无 assistantId 透传时必然发生，属预期），
      // 走兜底取最后一条 assistant；若 P0 根治生效则此处不应出现
      logger.debug(
        'updateMessageBlocks: 前端 id 未命中，走兜底取最后一条 assistant',
        {
          sessionId,
          messageId,
          assistantCount: session.messages.filter((m) => m.role === 'assistant')
            .length,
        }
      );
      message = session.messages.filter((m) => m.role === 'assistant').pop();
    } else {
      logger.debug('updateMessageBlocks: 前端 id 直接命中', {
        sessionId,
        messageId,
        blockCount: blocks.length,
      });
    }

    if (!message) {
      // 边缘场景：流式结束前、后端 msg-xxx 尚未创建时的首次 blocks 保存。
      // 此时只能用前端 UUID 占位创建（id 与后续 updateMessageBlocks 的 messageId 一致，
      // 可命中更新），但流式结束后后端会另建 msg-xxx 消息，刷新后可能出现双条。
      // TODO: CS05-ROOTFIX — 根治方案为前端透传 assistantId，后端 createAssistantMessage 复用。
      logger.warn(
        'updateMessageBlocks: 无 assistant 消息，用前端 UUID 创建占位消息',
        {
          sessionId,
          messageId,
          blockCount: blocks.length,
        }
      );
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
      // P0 修复（2026-08-14 排查）：必须用实际消息 id（msg-xxx）而非调用方传入的
      // 前端 UUID。原实现 storage.updateMessage 按 UUID 查找 → FileSystemUnifiedStorage
      // 找不到 idx 静默 return → blocks 永不落盘 → 刷新后 rebuildBlocksFromContent
      // 从 content 猜测重建，与流式真实时序不一致。
      await this.sessionGateway.updateMessage(
        sessionId,
        message.id,
        unifiedMessage
      );
      // 排查日志：落盘成功（FileSystemUnifiedStorage.updateMessage 命中 idx 时）
      logger.debug('updateMessageBlocks: blocks 已提交落盘', {
        sessionId,
        messageId: message.id,
        requestedId: messageId,
        blockCount: blocks.length,
      });
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

    // Phase 3: Durable Resume — 扫描并恢复中断的会话（RC-D 08-09：默认启用）
    if (this.ENABLE_DURABLE_RESUME) {
      await this._resumePendingSessions().catch((err) => {
        logger.warn('Durable Resume 扫描失败', { error: String(err) });
        // 熔断：连续 3 次失败后跳过自动恢复
        this._resumeFailCount = (this._resumeFailCount ?? 0) + 1;
        if (this._resumeFailCount >= 3) {
          logger.warn(
            'Durable Resume 已熔断 — 跳过后续自动恢复（需手动触发）',
            {
              failCount: this._resumeFailCount,
            }
          );
        }
      });
      // 熔断恢复：启动 1 小时后重置失败计数
      if (this._resumeFailCount && this._resumeFailCount < 3) {
        setTimeout(() => {
          this._resumeFailCount = 0;
        }, 3600_000);
      }
    } else {
      logger.info('Durable Resume 已通过 ENABLE_DURABLE_RESUME=false 关闭');
    }
  }

  /**
   * Durable Resume: 扫描 DB 中的 TAOR 检查点，恢复中断的会话。
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
          // P0 修复（2026-08-14 排查）：空 sessionId 检查点直接跳过——脏数据
          // 若进入 _getOrCreateTAORLoop 会抛错中断整个恢复循环，此处防御性拦截
          if (!cp.sessionId) {
            logger.warn('Durable Resume: 跳过空 sessionId 检查点', {
              checkpointId: cp.id,
            });
            continue;
          }
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
    sessionId?: string,
    outputBudgetTokens?: number
  ): Promise<void> {
    await truncateApiMessages(
      apiMessages,
      maxContextTokens,
      this._chatSessions,
      sessionId,
      outputBudgetTokens
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
    return this.chatOrchestrator.sendMessage(content, options);
  }
  private async _sendMessageDowngradePath(
    session: ChatSession,
    toolCalls: ParsedToolCall[],
    apiMessages: Record<string, unknown>[],
    activeClient: ToolAwareClient,
    options?: SendMessageOptions
  ): Promise<Message> {
    try {
      for (const tc of toolCalls) {
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
          content: JSON.stringify(toolResult.result ?? toolResult.error ?? ''),
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
      const msg = this.messageService.createAssistantMessage(
        stripThinkResponseTags(fallbackContent),
        { sessionId: session.id }
      );
      msg.sessionId = session.id;
      this._addAndPersistMessage(session.id, msg);
      options?.onProgress?.({
        stage: 'completed',
        message: '处理完成（降级路径）',
      });
      return msg;
    } catch (fallbackErr) {
      await handleError(fallbackErr, {
        module: 'chat:manager',
        action: 'TAORLoop降级路径也失败',
      });
      options?.onProgress?.({
        stage: 'completed',
        message: '处理异常，请重试',
      });
      // 降级完全失败，返回错误提示消息
      return this.messageService.createAssistantMessage('处理异常，请重试', {
        sessionId: session.id,
      });
    }
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
    // 验证日志：确认内部调用标记 _fromInternal 已传入（埋点据此不计入 Buddy 用户对话轮数）
    logger.info('executeStepPrompt 内部调用 sendMessage', {
      sessionId: session.id,
      _fromInternal: true,
    });
    await this.sendMessage(prompt, {
      ...options,
      sessionId: session.id,
      _fromInternal: true, // 计划步骤为系统内部调用：不计入 Buddy 用户对话轮数
      _fromInternalSource: 'executeStepPrompt',
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
    // §5.3: 排除 isTaskMessage 消息（任务摘要仅用户可见，不进入 LLM 上下文，避免污染）
    const apiMessages = messages
      .filter((msg) => msg.metadata?.isTaskMessage !== true)
      .map((msg) => {
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
    // 日志刷屏修复（2026-08-14 排查）：与 sendMessageFlow 同款——循环内逐条 info
    // 改为计数后单条 debug 汇总（历史 100+ 条时每轮刷屏 100+ 行）
    let cleanedToolCallCount = 0;
    for (let i = 0; i < lastUserMsgIdx; i++) {
      const msg = apiMessages[i];
      if (msg.role === 'assistant' && msg.tool_calls) {
        delete msg.tool_calls;
        cleanedToolCallCount++;
      }
    }
    if (cleanedToolCallCount > 0) {
      logger.debug('清除旧轮次 assistant tool_calls，防止跨轮污染', {
        cleanedCount: cleanedToolCallCount,
      });
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
    const session = await this.sessionLifecycle.getOrLoadSession(
      sessionId,
      options?.metadata
    );
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

    // 中止同一会话的旧流（P1-4: 确定性等待旧流清理，替代硬编码 100ms）
    const existingAbort = this._sessionAbortControllers.get(session.id);
    if (existingAbort) {
      logger.info('中止同一会话的旧流式请求', { sessionId: session.id });
      existingAbort.abort();
      await this._waitForAbortSettled(session.id, existingAbort);
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

    // 创建用户消息（前端写前落盘后按 id 复用，避免重复持久化）
    let userMessage: Message;
    const prePersisted = options?.messageId
      ? (session.messages.find((m) => m.id === options.messageId) as
          | Message
          | undefined)
      : undefined;
    const prevRoundCount = session.metadata.roundCount ?? 0;
    session.metadata.roundCount = prevRoundCount + 1;
    const fromInternal = options?._fromInternal === true;
    if (!fromInternal) {
      // Buddy 成长：用户发起对话才计数（内部调用不计入，精确"用户真实对话轮数"）
      void import('@modules/buddy')
        .then(({ recordUserSession }) => recordUserSession())
        .catch((err) =>
          logger.warn('Buddy 用户对话轮次埋点失败', { error: String(err) })
        );
    }
    if (fromInternal) {
      // 现场调试断点：内部调用触发时醒目提示（默认日志级别可见）
      logger.info(
        '[内部调用断点] _fromInternal=true，本轮不计入 userSessions',
        {
          sessionId: session.id,
          roundCountFrom: prevRoundCount,
          roundCountTo: session.metadata.roundCount,
          source: options?._fromInternalSource ?? 'unknown',
        }
      );
    }
    logger[fromInternal ? 'debug' : 'info']('用户对话轮次+1（流式）', {
      sessionId: session.id,
      roundCountFrom: prevRoundCount,
      roundCountTo: session.metadata.roundCount,
      model: options?.model ?? null,
      contentLength: content.length,
      prePersisted: !!prePersisted,
      messageId: options?.messageId ?? null,
      _fromInternal: options?._fromInternal ?? false,
      source: fromInternal ? 'internal' : 'user',
    });
    if (prePersisted) {
      userMessage = prePersisted;
    } else {
      userMessage = this.messageService.createUserMessage(content, {
        sessionId: session.id,
        metadata: options?.metadata,
      });
      // AB-14 修复：写前落盘可能失败（断网/后端重启），内存无该 id 时
      // 创建用户消息强制沿用前端 messageId，避免前后端消息 id 漂移。
      // 后端 addMessage 幂等查重会命中同 id，outbox 补发不产生重复。
      if (options?.messageId) {
        userMessage.id = options.messageId;
      }
      this._addAndPersistMessage(session.id, userMessage);
    }
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

    logger.info('streamMessage:会话准备完成', {
      sessionId: session.id,
      model: options?.model ?? null,
      messageCount: session.messages.length,
      userMessageId: userMessage.id,
      contentLength: content.length,
      hasImages: Array.isArray(options?.images) && options.images.length > 0,
      mutexLocked: false,
    });

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
   * P2（08-09）：创建 StreamPipeline 实例
   *
   * 从 ChatManager 注入所有外部依赖到管线上下文。
   */
  private _createStreamPipeline(
    session: ChatSession,
    content: string,
    options?: StreamMessageOptions
  ): StreamPipeline {
    const activeClient = this.getClientForModel(options?.model);
    const ctx: PipelineContext = {
      content,
      session,
      options,
      imageContextService: this.imageContextService,
      llmClient: this.llmClient as PipelineContext['llmClient'],
      activeClient: activeClient as PipelineContext['activeClient'],
      unifiedTracker: this.unifiedTracker as PipelineContext['unifiedTracker'],
      hookChainManager: this
        .hookChainManager as unknown as PipelineContext['hookChainManager'],
      extractFilePathsFromText: this.extractFilePathsFromText.bind(this),
      addAndPersistMessage: (sid, msg) => this._addAndPersistMessage(sid, msg),
      recordChatResponseUsage: (sid, usage) =>
        this.recordChatResponseUsage(sid, usage as Record<string, number>),
      extractMemoryFromChat: (userMsg, aiMsg, sid) =>
        this.extractMemoryFromChat(userMsg, aiMsg, sid),
      messageService: this.messageService as PipelineContext['messageService'],
      apiMessages: [],
      toolDefinitions: [],
      accumulatedContent: '',
      finalResponse: null,
    };
    return new StreamPipeline(ctx);
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
    // P0-fix: 确保助手消息已持久化（非工具调用路径在此处落盘，工具调用路径已由 _buildToolRoundMessages 处理）
    const lastMsg = session.messages[session.messages.length - 1];
    if (!lastMsg || lastMsg.id !== assistantMessage.id) {
      await this._addAndPersistMessage(session.id, assistantMessage);
    }

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
    this._memoryManager!.accumulate(
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
            this._pdcaLauncher!.launch(
              session.metadata.projectId as string,
              assistantMessage.content as string,
              session.id,
              lastUserContent || undefined,
              // S3（P1-5 §5 S3）：两层分流决策（复杂度门 + 危险工具 + message 粒度 hash 10%）
              this._shouldUsePlanDrivenLoop(lastUserContent || '')
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
      this._summarizer!.summarize(session, assistantMessage).catch(() => {
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
   * P2-4: 获取会话绑定的工作区路径（仅项目模块会话有值 = sandboxPath）
   * 用于工具默认 cwd 的会话上下文化，替代全局 SandboxConfigBuilder.defaultWorkspacePath
   */
  private getSessionWorkspacePath(sessionId?: string): string | undefined {
    if (!sessionId) return undefined;
    const session = this._chatSessions.get(sessionId);
    const metadata = session?.metadata as Record<string, unknown> | undefined;
    const workspacePath = metadata?.workspacePath as string | undefined;
    // P2-2 收尾：仅接受绝对路径。存量会话的 workspacePath 可能是修复前的项目名（非路径），
    // 不能作为工具默认 cwd；自动建项目沙箱路径为绝对路径（homedir 展开），校验通过
    if (workspacePath && path.isAbsolute(workspacePath)) {
      return workspacePath;
    }
    return undefined;
  }

  /**
   * P0-D 配套: 获取会话绑定的真实工作区 ID（项目模块会话 = projectId）
   * 供 create_project 工具使用，避免 AI 建的项目挂到 sessionId 名下（前端 projects 列表不可见）
   */
  private getSessionWorkspaceId(sessionId?: string): string | undefined {
    if (!sessionId) return undefined;
    const session = this._chatSessions.get(sessionId);
    const metadata = session?.metadata as Record<string, unknown> | undefined;
    const workspaceId = metadata?.workspaceId as string | undefined;
    if (!workspaceId) return undefined;
    // 项目模块下 workspaceId === projectId（sessionSlice 约定），返回真实工作区 ID
    return workspaceId;
  }

  /**
   * P0-D: 将内存 session 的 metadata（含 projectId/workspaceId/moduleType）持久化到 gateway 存储
   * 自动建项目/跨会话去重关联项目/工具建项目后调用，防止重启后 projectId 丢失
   */
  async persistSessionMetadata(session: ChatSession): Promise<void> {
    try {
      const stored = await this.sessionGateway.getSession(session.id);
      if (stored) {
        stored.metadata = { ...stored.metadata, ...session.metadata };
        await this.sessionGateway.updateSession(stored);
      }
    } catch (e) {
      handleError(e, {
        module: 'chat:manager',
        action: '持久化会话 metadata 失败',
      });
    }
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
          // P0-D: 持久化 projectId 到 gateway 存储，防止重启后丢失
          await this.persistSessionMetadata(session);
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

      // P0-D: 持久化 projectId 到 gateway 存储，防止重启后丢失
      await this.persistSessionMetadata(session);

      // S5b: 项目上下文文件由 ProjectStore.create() 统一写入
      // P0: 迁移已有 context/artifacts 到新项目目录
      try {
        const {
          mkdirSync,
          copyFileSync,
          existsSync: _exists,
        } = await import('fs');
        const projDir = join(dataDir, 'projects', project.id);
        mkdirSync(projDir, { recursive: true });

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
      // P2-2: 事件携带 sandboxPath，前端 worktree.path 用真实路径（此前 path=projectId 导致工具默认 cwd 错误）
      const autoCreatedPayload = {
        projectId: project.id,
        name: project.name,
        sandboxPath: project.sandboxPath,
      };
      logger.info('P0 自动建项目事件：emitCustomEvent 发出', {
        event: 'project:auto_created',
        ...autoCreatedPayload,
      });
      eventNotificationService.emitCustomEvent(
        'project:auto_created',
        autoCreatedPayload
      );
      // P0b-3: 同步广播到全局 SSE 事件总线，前端 worktree 同步创建
      try {
        const { broadcastEvent } =
          await import('../infrastructure/http/LocalHTTPServiceSSE');
        await broadcastEvent('project:auto_created', autoCreatedPayload);
        logger.info('P0 自动建项目事件：SSE 广播完成', autoCreatedPayload);
      } catch (e) {
        logger.warn('P0 自动建项目 SSE 广播失败', {
          error: (e as Error)?.message ?? String(e),
        });
        /* SSE 广播失败不影响主流程 */
      }
    } catch (e) {
      logger.warn('P0 自动建项目失败', {
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
    return yield* this.chatOrchestrator.streamMessage(content, options);
  }
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

    // 中断治理（2026-08-15）：resume 时同步恢复会话状态（PAUSED → ACTIVE），
    // 避免崩溃恢复标记的 paused 会话在磁盘上永久冻结；失败不阻断检查点恢复主流程
    try {
      await this.sessionGateway.resumeSession(sessionId);
    } catch (e) {
      // @ignore-catch — 状态恢复失败不影响检查点恢复
      logger.warn('resume 时恢复会话状态失败', {
        sessionId,
        error: String(e),
      });
    }

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
        } as ChatStreamChunk;
      } finally {
        mutex.release();
      }
      return null as unknown as Message;
    }

    const { checkpoint, stepIndex, completedToolCallIds, generatorState } =
      restoreResult;

    // 1. 恢复会话状态
    const session = await this.sessionLifecycle.getOrLoadSession(sessionId);
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

      // 工具执行循环（三轨之一，P1-3）—— 断线恢复简化版（无审批/心跳/残缺重试）。
      // 收敛目标：复用 streamMessage 基线循环（L4047）的检查点入口，消除独立实现。
      while (currentToolCalls.length > 0) {
        if (streamAbortController.signal.aborted) break;
        toolTurnCount++;

        if (toolTurnCount > MAX_TOOL_TURNS) {
          yield {
            type: 'error',
            content: `工具调用次数已达上限 (${MAX_TOOL_TURNS})`,
            sessionId,
          } as ChatStreamChunk;
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
          } as ChatStreamChunk;
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
        // 与主链路 StreamPipeline.repairContent 对齐：断线恢复累积的工具轮叙述
        // 落盘前剥离裸探索段，避免历史加载合并后探索叙述重复出现
        stripBareExploration(
          stripThinkResponseTags(repairImageUrls(accumulatedContent))
        ),
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
  // P0-1: sessionId 可选 — 传入时按会话精确定位；不传时遍历按 questionId 匹配（兼容旧调用方）
  resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): boolean {
    const entry = sessionId
      ? this._pendingInteractions.get(sessionId)?.questionId === questionId
        ? this._pendingInteractions.get(sessionId)
        : undefined
      : Array.from(this._pendingInteractions.entries()).find(
          ([, e]) => e.questionId === questionId
        )?.[1];
    if (entry) {
      const sid =
        sessionId ??
        Array.from(this._pendingInteractions.entries()).find(
          ([, e]) => e.questionId === questionId
        )?.[0];
      logger.info('解析用户交互', { sessionId: sid, questionId, answers });
      // R5 修复：将用户回答持久化为会话消息——原实现只把答案注入等待中的
      // promise，刷新后回答从历史中消失，且 question 块恢复未提交态可重复提交。
      // _addAndPersistMessage 内部已做错误兜底，此处不阻塞回答注入。
      if (sid && answers.length > 0) {
        const answerMsg = this.messageService.createUserMessage(
          answers.join('\n'),
          { sessionId: sid }
        );
        void this._addAndPersistMessage(sid, answerMsg);
      }
      entry.resolve(answers);
      if (sid) this._pendingInteractions.delete(sid);
      return true;
    }
    logger.warn('未找到匹配的待处理交互', { questionId });
    return false;
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
   * P1-2: 构建工具轮次的 LLM 请求消息（纯数据，无 yield，无 this 副作用）
   * 从 streamMessage 工具循环提取，降低巨型方法复杂度
   */
  private _buildToolRoundMessages(
    currentMessages: Record<string, unknown>[],
    currentAssistantMsg: Message,
    currentToolCalls: ParsedToolCall[],
    processedResults: Array<{
      normalizedToolCall: ToolCall;
      result: ToolResult;
    }>
  ): Record<string, unknown>[] {
    return [
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
    // 更新动态依赖
    const svc = this._toolExecutionService!;
    svc.deps.currentSessionId = this._currentSessionId ?? '';
    return svc.execute(toolCall, opts);
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
    return this.sessionLifecycle.createSession(params);
  }

  async switchSession(sessionId: string): Promise<void> {
    return this.sessionLifecycle.switchSession(sessionId);
  }

  getCurrentSession(): ChatSession | undefined {
    return this.sessionLifecycle.getCurrentSession();
  }

  getSessions(): ChatSession[] {
    return this.sessionLifecycle.getSessions();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const startedAt = Date.now();
    logger.info('deleteSession:开始删除会话', { sessionId });
    // BUG-3 修复：持久化删除失败不再吞错——原 try/catch 只记日志不 rethrow，
    // handleDeleteSession 仍返回 200 → 前端本地移除但磁盘残留，刷新后会话"复活"。
    // 错误上抛由 handler 返回 500，前端据此不清理本地记录。
    await this.sessionLifecycle.deleteSession(sessionId);
    logger.info('deleteSession:会话删除完成', {
      sessionId,
      elapsedMs: Date.now() - startedAt,
    });
    // 联动清理该会话全部检查点（不阻塞删除主流程，记录执行情况，避免残留孤儿检查点）
    void this._deleteSessionCheckpoints(sessionId);
  }

  /**
   * 清理指定会话的检查点并记录执行情况（fire-and-forget，不阻塞删除主流程）
   * 耗时日志：listMs（检查点列表查询）/ cleanupMs（删除）/ totalMs（总耗时），供性能分析
   */
  private async _deleteSessionCheckpoints(sessionId: string): Promise<void> {
    let count = 0;
    const startedAt = Date.now();
    try {
      const t0 = Date.now();
      const before = await this._checkpointService.listCheckpoints(sessionId);
      const listMs = Date.now() - t0;
      count = before.length;
      if (count === 0) {
        logger.info('deleteSession:该会话无检查点，跳过清理', {
          sessionId,
          listMs,
        });
        return;
      }
      logger.info('deleteSession:开始清理会话检查点', {
        sessionId,
        count,
        listMs,
      });
      const t1 = Date.now();
      await this._checkpointService.deleteSessionCheckpoints(sessionId);
      const cleanupMs = Date.now() - t1;
      logger.info('deleteSession:会话检查点清理完成', {
        sessionId,
        removed: count,
        listMs,
        cleanupMs,
        totalMs: Date.now() - startedAt,
      });
    } catch (e) {
      logger.warn('deleteSession:会话检查点清理失败', {
        sessionId,
        count,
        elapsedMs: Date.now() - startedAt,
        error: e instanceof Error ? e.message : String(e),
      });
      await handleError(e, {
        module: 'chat:manager',
        action: 'deleteSession:清理检查点失败',
      });
    }
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    const startedAt = Date.now();
    logger.info('clearAllSessions:开始批量清空会话', {
      moduleType: moduleType ?? 'all',
    });
    // 批量删除前先清理所有存储会话的检查点（失败不阻塞清空主流程；按 moduleType 过滤）
    const stored = await this.sessionGateway.listSessions();
    logger.info('clearAllSessions:发现待清理存储会话', {
      count: stored.length,
    });
    await Promise.all(
      stored
        .filter(
          (s) =>
            !moduleType ||
            (s.metadata as Record<string, unknown> | undefined)?.moduleType ===
              moduleType
        )
        .map((s) =>
          this._checkpointService.deleteSessionCheckpoints(s.id).catch((e) =>
            handleError(e, {
              module: 'chat:manager',
              action: 'clearAllSessions:清理检查点失败',
              context: { sessionId: s.id },
            })
          )
        )
    );
    await this.sessionLifecycle.clearAllSessions(moduleType);
    logger.info('clearAllSessions:批量清空完成', {
      sessions: stored.length,
      elapsedMs: Date.now() - startedAt,
    });
  }

  async saveSession(session: ChatSession): Promise<void> {
    return this.sessionLifecycle.saveSession(session);
  }

  async loadSession(sessionId: string): Promise<ChatSession | undefined> {
    return this.sessionLifecycle.loadSession(sessionId);
  }

  async loadSessions(): Promise<ChatSession[]> {
    return this.sessionLifecycle.loadSessions();
  }

  getSessionMessages(sessionId: string): Message[] {
    return this.sessionLifecycle.getSessionMessages(sessionId);
  }

  searchMessages(query: string, sessionId?: string): Message[] {
    return this.sessionLifecycle.searchMessages(query, sessionId);
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
            this._getLocalSession(sessionId)?.state || DataSessionStatus.ACTIVE,
            label
          )
          .then((cp) => cp.id),
      listCheckpoints: (sessionId: string) =>
        this._checkpointService.listCheckpoints(sessionId),
      rollbackToCheckpoint: (checkpointId: string) =>
        this._checkpointService.rollbackToCheckpoint(checkpointId, {
          messages: [],
          metadata: { title: '' },
          state: DataSessionStatus.ACTIVE,
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
    return this.contextCompactor.checkCompactBoundary(sessionId);
  }

  /**
   * 执行会话压缩
   * @param sessionId 会话ID
   * @returns 压缩产物列表
   */
  async compactSession(sessionId?: string): Promise<CompactArtifact[]> {
    return this.contextCompactor.compactSession(sessionId);
  }

  /**
   * 获取压缩服务
   * @returns 压缩服务实例
   */
  getCompactService(): CompactServiceImpl {
    return this.contextCompactor.getCompactService();
  }

  async createCheckpoint(
    sessionId: string,
    label?: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    return this.resumeCoordinator.createCheckpoint(sessionId, label, metadata);
  }

  async listCheckpoints(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint[]> {
    return this.resumeCoordinator.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('./types/checkpoint').CheckpointDiff;
  }> {
    return this.resumeCoordinator.rollbackToCheckpoint(checkpointId);
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this.resumeCoordinator.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<import('./types/checkpoint').SessionCheckpoint | null> {
    return this.resumeCoordinator.getLatestCheckpoint(sessionId);
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
