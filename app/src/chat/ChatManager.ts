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

import { configManager } from '@modules/config';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { repairModelJson } from '@modules/utils/json';
import { abortSessionPlans } from './planAbortRegistry.js';
import { resolveBaseToolTurns } from './loopTurnLimits.js';
import { containsComplexKeywords } from '@modules/workspace/CouncilOrchestrator';
import { ImageContextService } from './services/ImageContextService';
import {
  validatePathsInOutput,
  clearPathCheckCache,
} from './services/PathGuardService';
import {
  mapSessionStatusToState,
  extractTodoData,
  resolveMaxContextTokens,
  repairImageUrls,
  getLocalSession,
  getOrCreateSessionMachine,
} from './services/ChatHelper';
import {
  ChatEventLogStore,
  type SessionLookupArgs,
  type SessionLookupResult,
} from './manager/eventLogStore';
import { ChatRequestPrep } from './manager/requestPrep';
import { ChatRollback, type PendingInteractionEntry } from './manager/rollback';
import { ChatPromptAssembly } from './manager/promptAssembly';
import { ChatBootstrap } from './manager/bootstrap';
import { ChatStreamMessageLifecycle } from './pipeline/streamMessageLifecycle';
import { ChatSessionTeardown } from './manager/sessionTeardown';
import { ChatRecovery } from './manager/recovery';
// U4 历史会话补评（2026-10-06）：磁盘会话的"最近更新优先"排序（纯函数）
import { rankRecentSessionIds } from './quality/sessionScan';
import type { ModelInputSnapshot } from './services/RequestSnapshotService';
import {
  EventLogStorage,
  ReconcileService,
  type EventLogQuery,
  type SessionSummaryRecord,
  type RecoveryReport,
  type YieldRecoveryStats,
} from '@modules/session';
// D 阶段（2026-09-02，v5 P0-⑥）：跨会话记忆适配器——静态导入保证模块加载即触发
// session_summary 类型注册（registerSessionSummaryMemoryType 由构造期显式调用，
// 早于 memory scanner/memdir 扫描；createMemory 不校验 type，注册约束面在扫描/统计路径）
import {
  registerSessionSummaryMemoryType,
  rollupSessionSummaryToLongTerm,
} from '@modules/memory';
import type { LiriEvent, LiriEventData } from '@modules/session/types/events';
// TR-14 / TR-12-A（2026-09-22）：`metric/timing` 事件载荷构造（纯函数，可单测）
import { buildRequestTimingData } from './services/timingEvent';
// P2-2（2026-09-23）：请求边界事件（`request/start` + 请求级 `metric/timing.requestId`）
import {
  finishRequest,
  startRequest,
  type RequestEventAppender,
} from './services/requestBoundary';
import { feature as coreFeature } from '@modules/core';
import { configureCodeRunner } from '@modules/tools';
import {
  persistTurnSummary,
  contextLayeringEnabled,
  ensureThinkResponseTags,
  stripThinkResponseTags,
  stripOrphanToolTags,
} from './services/MessageContextPipeline';
import { StreamingToolCallScrubber } from '@modules/streaming';
import { stripBareExploration } from './services/bareExplorationStripper';
import { SessionAccessFacade } from './services/SessionAccessFacade';
import { SessionLifecycleManager } from './services/SessionLifecycleManager.js';
import { ResumeCoordinator } from './services/ResumeCoordinator.js';
import { ContextCompactor } from './services/ContextCompactor.js';
import { SessionSummarizer } from './services/SessionSummarizer';
import { SessionMemoryManager } from './services/SessionMemoryManager';
import { TaskFacade } from './facades/TaskFacade';
import { PdcaLauncher } from './launchers/PdcaLauncher';
// U-22/S1：PDCA 自动启动簇外移（自动建项目 → launch → 决策轨迹）
import { PdcaLaunchCoordinator } from './manager/pdcaLaunch';
// U-22/S2：流式请求准备段外移（输入净化 → 取会话 → abort/锁 → 用户消息落盘）
import { ChatStreamSetup, type StreamSetupResult } from './manager/streamSetup';
// U-22/S3：消息持久化 / 事件投影簇外移
import { ChatMessagePersistence } from './manager/messagePersistence';
// U-22/S4：流式消息收尾簇外移（`_finalizeStreamMessage` 的实现，见 `manager/streamFinalize.ts`）
import { ChatStreamFinalize } from './manager/streamFinalize';
import { ChatOrchestrator } from './orchestrator/ChatOrchestrator.js';
// R16：每日预算（进程共享单例；S3 后**主口径=金额**，Token 轨只观测）——记账点收敛到本类的 recordChatResponseUsage。
// 债四「换算接线」（2026-10-13）：同一记账点并行记**金额**台账（`recordTurnCostUsd`）。
import { getDailyBudget, recordTurnCostUsd } from '../query/DailyBudgetManager';
// Task 7（2026-10-12，预算挂起续跑）：放行 ⇒ 唤醒挂起会话的进程内协调器。
// `query/budgetSuspend` **不得** import `chat/**`（防环）⇒ 唤醒经注入的 handler 端口（下方装配）。
import { getBudgetSuspendCoordinator } from '../query/budgetSuspend';

const logger = getLogger('chat:manager');

import { SimpleMutex, feature } from '@modules/core';
// T2-8 / `✅-17`（2026-10-13）：编排域只读投影（形态 A）
import { publishOrchestrationProjection } from '../state/engine/orchestrationProjection.js';
import { resolveWorktreeHash } from '@modules/core/paths';
import { join } from 'path';
import { getModelPricing } from '@modules/cost';

import { calculateTotalCost } from '@modules/cost';

import type { ChatManager } from './ChatManagerInterface.js';
// S1-1（2026-10-11）：审批作用域 / 快照类型（**仅类型导入**；判定与存储在 permission 层）
import type { ApprovalScope, ApprovalSnapshot } from '@modules/permission';

/**
 * 聊天管理器
 * 聊天功能的核心管理类，负责整合所有聊天相关的功能
 */
import type {
  Message,
  SendMessageOptions,
  StreamMessageOptions,
  ChatResponse,
} from '@modules/session/types/message.js';
import { createSystemMessage } from '@modules/session/types/message.js';
import type {
  ChatSession,
  CreateSessionParams,
} from '@modules/session/types/session.js';
import { DataSessionStatus } from '@modules/core';
import type {
  ToolCall,
  ToolResult,
  ToolIntegration,
} from '@modules/session/types/tool.js';
import { getToolCallName } from '@modules/session/types/tool.js';
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
import { isCheckpointLogEnabled } from '@modules/config';
import { HookChainManager } from '@modules/hooks';
import { toolResultRegistry } from '../tool/ToolResultRegistry.js';
import { ToolAwareClient } from '@modules/ai';
import { providerRegistry } from '@modules/ai';
import { trackUsage } from '@modules/ai';
import {
  createMaxOutputRetryState,
  advanceMaxOutputRetry,
  type MaxOutputRetryState,
} from '@modules/ai';
import {
  createDegradationState,
  tryDegradeContext,
  getDegradationWarning,
  type DegradationState,
} from '@modules/ai';
import type { IToolExecutor } from '@modules/ai';
import type { ToolRegistry, ToolSchema } from '@modules/tools';
// 13-P1-2（2026-10-05）：非幂等工具失败时的重试告诫（模型是实际"重试方"）
import { resolveToolEffect } from '@modules/tools';
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
import type { MemorySessionContext } from '@modules/memory/types/SessionContext';
import {
  QueryEngine,
  createQueryEngine,
  type QueryEngineConfig,
} from '@modules/query';
import {
  TokenBudgetController,
  TokenBudgetStatus,
  type TokenBudgetParams,
  getDefaultTokenBudget,
} from '@modules/tokenBudget';
import { UnifiedTokenTracker } from '@modules/tokenBudget';
import { ContextTracker } from '@modules/query';
// A8 最后一公里（B1，2026-10-04）：装配入口——assembler → 可执行路由（未接线者显式 unavailable）
// 13-P1-3（2026-10-05）：新增执行配方（recipe）与配方→验证器配置
// I4（最终整支评审）：`buildBudgetResumePrompt` = `pendingToolCalls` 的**运行时消费者**（续跑提示）。
// 经 `@modules/query` 模块出口导入（守 R03-002：不经 `query/taor` 子目录）。
import { buildBudgetResumePrompt } from '@modules/query';
import type { PendingToolCallRef } from '@modules/query';
// 13-P2-1（2026-10-05）：输出侧统一护栏组合根注册（默认关 ⇒ 空注册）
import { registerDefaultOutputGuards } from './outputGuards/index.js';
import { compactionOrchestrator, messageProjector } from '@modules/context';
// 内存水位（2026-09-02，OS kswapd 式；见 dev_docs/内存水位触发机制-详细设计）
import { getMemoryPressureMonitor } from '@modules/monitoring';
import { estimateMessagesTokens } from '@modules/ai';
// G-2（2026-10-11）：降级路径的日预算闸门（非 chat 管线入口的统一判定 + 拒绝对外载体）
import { assertEntryBudget } from '../query/dailyBudgetGate';
import { FileCheckpointStorage } from '@modules/session';
import {
  StopHookManager,
  createStopHookManager,
  DEFAULT_STOP_HOOK_PRIORITIES,
} from '@modules/query';
import type { StopHookReason } from '@modules/query';
import { TAORLoop, createSystemAbortReason } from '@modules/query';
import { createChatAgentLoop } from './createAgentLoop.js';
import { getYieldRegistry, setActiveSubagentRunProbe } from '../session/yield';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { YieldRegistry, YieldWaitingStore } from '../session/yield';
// 阶段 A（A1-e）：yield 恢复通路（子代理结算 → 恢复父会话）
import {
  setYieldResumeHandler,
  // B4-1（2026-09-23）：恢复审计（认领/恢复/放弃）的唯一写入实现
  setYieldRecoveryAuditSink,
} from './yield';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { SettlementOutbox } from './yield/SettlementOutbox';
// 阶段 A（N-26 修复）：SelfWake 唤醒执行器（fire 时真正唤醒会话）
import {
  setSelfWakeResumeHandler,
  setSelfWakeAuditSink,
  // T-②06（2026-10-03）：经验自动演化落盘审计出口
  setEvolutionAuditSink,
  // 2026-10-08：步骤 TAORLoop 工厂出口（长程任务步骤"无工具可用"根因修复；
  // 与上面 setSelfWakeResumeHandler / setGoalEventSink 同一"chat 层注入 sink"手法）
  setStepLoopFactory,
} from '@modules/tasks';
import { setGoalEventSink } from '@modules/tasks';
// P1-19 ①（2026-10-05）：工作流成员级事件实时落盘 —— 本模块持有会话事件日志，
// 故在此注入唯一写入出口（与 setGoalEventSink 同一手法；避免 workflow/ → chat/ 反向依赖）。
import { setWorkflowRunEventSink } from '@modules/workflow';
// PR5-S3（2026-10-09）：Execution 生命周期事件落盘 —— 本模块持有会话事件日志，
// 故在此注入唯一写入出口（同上手法；避免 execution/ → chat/ 反向依赖）。
import { setExecutionEventSink } from '@modules/execution';
// F2（2026-10-12，预算挂起续跑 Task 3）：活跃 TAORLoop 注册表入口（经 infrastructure barrel）。
// 修复前 `registerTAORLoop` 全仓零调用 ⇒ `activeLoops` 恒空 ⇒ checkpoint 恢复端点恒 404。
import { registerTAORLoop, unregisterTAORLoop } from '@modules/infrastructure';
// X8（2026-09-23，Spec §5.5）：**主会话**用量入账到该会话的未终结目标
import { chargeSessionGoalUsage } from '@modules/tasks';
import {
  PlanDrivenLoop,
  classifyTaskComplexity,
  hasDangerousToolIntent,
  isEligibleForFastPath,
  resolveFastPathPolicy,
} from '@modules/tasks';
import type { PlanDrivenLoopResult } from '@modules/tasks';
// 2026-10-01 D-144：core 的 TokenBudgetController 改为 DI ⇒ 由本层注入精确估算器
import { estimateTokens } from '@modules/ai/tokenizer/TokenEstimator.js';
import { ReActToolLoop } from './ReActToolLoop.js';
import type { ToolLoopContext } from './ToolLoopRunner.js';
import { withToolTimeout } from './services/ToolTimeoutWrapper.js';
import { ToolExecutionService } from './services/ToolExecutionService.js';
import type { ToolExecutionDeps } from './services/ToolExecutionService.js';
import { StreamPipeline } from './pipeline/StreamPipeline.js';
import type { PipelineContext } from './pipeline/StreamPipeline.js';
import { LoopDetector } from '@modules/query';
import { createChatManagerTAORDeps } from '@modules/query';
import type { ChatManagerTAORContext } from '@modules/query';
import { agentTelemetry } from '@modules/agent';
import { ErrorHandler } from '@modules/core';
import { convergenceDetector } from './services/ConvergenceDetector.js';
import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '@modules/compaction';
import type { SessionMessage } from '@modules/session';
import { SessionGateway, createSessionGateway } from '@modules/session';
import { resolveProjectRoot, resolveOutputDir } from '@modules/core/paths';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { TaskStatus } from '@modules/tasks/types';

import { RollbackIntegration } from '@modules/security';
import type { FileOperation } from '@modules/security';
import { FILE_WRITE_TOOL_NAME, FILE_EDIT_TOOL_NAME } from '@modules/constants';
import { taskRegistry } from '@modules/tasks';
import { taskOrchestrator } from '@modules/tasks';

/**
 * 崩溃恢复重算 `totalMessages` 是否应**落盘**？（纯判据，2026-09-26）
 *
 * 落盘目的是修正"崩溃前残留在 `metadata` 里的旧计数"。可修正的前提是**本次确实读到了消息**：
 * 去重后为空时，无法区分"会话本就无消息"与"`messages.jsonl` 已丢失"，落盘只会把丢失
 * 固化成 `totalMessages: 0` 并掩盖真相；而旧实现还会借 `persistSession` 的
 * `mkdir(recursive)` 把**已被软删的会话目录重建**出来 ⇒ 与 K-6 自愈构成无终止循环
 * （实测单会话被删 **533 次**、`.trash` 累积 **7002 项**）。
 *
 * @param previous 磁盘上残存的旧计数（可为 undefined）
 * @param recalculated 本次去重后的真实条数
 */
export function shouldPersistRecalculatedTotal(
  previous: number | undefined,
  recalculated: number
): boolean {
  return recalculated > 0 && previous !== recalculated;
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
   * B-05（2026-10-09）：sessionId → 本次执行的 `executionId`（由入口经
   * `ChatRequest.executionId` → `StreamMessageOptions.executionId` 下传）。
   *
   * 与 `_sessionAbortControllers` 同生命周期：流开始登记、流结束清理。
   * **消费者是工具执行器**（`executeTool`）——在每个工具**执行之前**做 `beginToolCall` 记账，
   * 落盘失败 ⇒ **拒绝该工具**（逐工具 fail-closed）。
   */
  private _sessionExecutionIds = new Map<string, string>();

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
    // S4/BUG-7 修复（2026-08-23）：停止会话流时顺带中止该会话的活跃计划循环
    // （方案 A：前端现有停止路径自动生效，无需透传 planId）
    abortSessionPlans(sessionId);
    const controller = this._sessionAbortControllers.get(sessionId);
    if (controller) {
      logger.info('req.on(close) 触发 — 中止会话流', { sessionId });
      // 二期 O2-1（2026-09-24）：本路径由 **HTTP 连接关闭（页面刷新/断线/请求中止）** 触发，
      // 属**系统侧**中止 —— 显式带 reason 声明来源，避免被记成"用户主动放弃"
      //（并据此把 Goal 落成 `system_aborted` 而非 `user_aborted`）。
      // ② 加固（2026-09-25，`.trae/specs/system-abort-reason-hardening.md`）：用**工厂**
      // 传 Error 形态 reason（带真实栈）—— 该 reason 若在下游外泄，栈可定位遗漏的 catch；
      // 每次新实例（禁止共享单例，否则栈全指向模块加载点）。
      controller.abort(createSystemAbortReason());
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
   * 基础阈值解析统一入口：loopTurnLimits.resolveBaseToolTurns（调用方分级基础，
   * 2026-09-01 对标 cc_code）——env MAX_TAOR_TURNS / MAX_TOOL_TURNS 可覆盖，默认 30。
   * 死循环拦截由 LoopDetector 承担（2026-08-30 治理：默认 300→30）。
   */
  private readonly MAX_TOOL_TURNS = resolveBaseToolTurns();

  /**
   * 检查点服务
   */
  private _checkpointService: ReturnType<typeof createCheckpointService>;

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
   * C 阶段（2026-09-02，P1）：最近一次流式请求构建（_buildApiMessagesForStream）
   * 是否发生分页切窗——供 streamMessageFlow 决定是否注入 session_lookup 取回工具。
   * 单值近似（并发多会话构建时以最近一次为准，仅影响工具注入，无正确性风险）。
   */
  private _lastStreamBuildWindowed = false;
  /** D5②（2026-09-02）：最近一次流式构建是否判定为代码/长文档会话（切窗时驱动取回增强） */
  private _lastStreamBuildCodeContext = false;

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
  private _pendingInteractions = new Map<string, PendingInteractionEntry>();

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
   * 会话级工具轮次计数（设计三 2026-08-26）：原全局计数器在并发会话时
   * turn 编号互相跳变（A 会话 turn 5/7/9，6/8 被 B 占用）。改 per-session Map。
   */
  private _toolRoundCounts: Map<string, number> = new Map();

  private incToolRound(sessionId: string): number {
    const next = (this._toolRoundCounts.get(sessionId) ?? 0) + 1;
    this._toolRoundCounts.set(sessionId, next);
    return next;
  }

  private getToolRound(sessionId: string): number {
    return this._toolRoundCounts.get(sessionId) ?? 0;
  }

  private clearToolRound(sessionId: string): void {
    this._toolRoundCounts.delete(sessionId);
  }

  /**
   * 停止钩子管理器（Phase 2：预算检查统一入口）
   */
  private stopHookManager: StopHookManager;

  /**
   * Tracker feature flags（默认 false，灰度控制）
   */
  private readonly ENABLE_TELEMETRY =
    configManager.env('ENABLE_AGENT_TELEMETRY') === 'true';
  private readonly ENABLE_ERROR_HANDLER =
    configManager.env('ENABLE_ERROR_HANDLER') === 'true';
  /**
   * RC-D（08-09）：Durable Resume 灰度开关（默认启用）
   * 关闭后跳过启动时的断点续传扫描。
   * 可通过 ENABLE_DURABLE_RESUME=false 关闭。
   */
  private readonly ENABLE_DURABLE_RESUME =
    configManager.env('ENABLE_DURABLE_RESUME') !== 'false';

  /**
   * 阶段 3 退役（2026-09-01）：ENABLE_LOOP_V8_PHASE2 / TAORLOOP_TRAFFIC_PERCENT /
   * ENABLE_PLAN_DRIVEN_LOOP / PLAN_DRIVEN_LOOP_TRAFFIC_PERCENT 灰度开关已删除，
   * 固化单一路径（TAORLoop 统一编排 + PlanDrivenLoop 快速路径）。
   * 保留 shouldUseTAORLoop 接口签名（host 契约），行为恒为全量启用。
   */
  private _shouldUseTAORLoop(_sessionId: string): boolean {
    return true;
  }

  /**
   * S3（P1-5 §5 S3）：PlanDrivenLoop 快速路径判定。
   * 阶段 3 退役（2026-09-01）：灰度 hash 分流已删除，仅保留业务复杂度门——
   * isEligibleForFastPath（isSimpleTask 复杂度门 + 危险工具准入筛除）。
   * 简单任务走 PlanDrivenLoop 快速路径；复杂/危险任务走经典 PDCA 阶段链。
   */
  private _shouldUsePlanDrivenLoop(message: string): boolean {
    // T-②05（2026-10-03）：判据改为**配置驱动**（GlobalConfig.fastPath；缺省回退原冻结基线）
    const policy = resolveFastPathPolicy();
    if (!isEligibleForFastPath(message, policy)) {
      logger.debug('PlanDrivenLoop 分流：复杂度门/危险工具筛除', {
        messagePreview: message.slice(0, 50),
        complexity: classifyTaskComplexity(message, policy.maxSimpleTaskLength),
        dangerousTool: hasDangerousToolIntent(
          message,
          policy.dangerousIntentPatterns
        ),
      });
      return false;
    }
    return true;
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
   * CM-6（2026-08-25）：Code Mode 自动分流灰度百分比（0~100，默认 0）
   * 首版默认不自动分流——模型显式选择 code_run 工具优先；
   * 可通过 CODE_MODE_TRAFFIC_PERCENT 开启灰度（message 粒度 hash，复用 _hashMessage）。
   */
  private readonly _codeModeTrafficPercent: number = (() => {
    const raw = configManager.env('CODE_MODE_TRAFFIC_PERCENT');
    const val = raw && !isNaN(Number(raw)) ? Number(raw) : 0;
    return Math.min(100, Math.max(0, val));
  })();

  /**
   * CM-6：Code Mode 分流决策（与 _shouldUsePlanDrivenLoop 平级）
   * CODE_MODE feature 关闭 → 恒 false（不注入 code_run 建议）；
   * 灰度命中表示"本轮建议走 code_run 编排"（用于与 PDCA launch 互斥）。
   * 工具注册/模型显式选择 code_run 不受此方法控制（优先级更高）。
   */
  private _shouldUseCodeMode(message: string): boolean {
    if (!coreFeature('CODE_MODE')) return false;
    if (this._codeModeTrafficPercent >= 100) return true;
    if (this._codeModeTrafficPercent <= 0) return false;
    const hash = this._hashMessage(message);
    const shouldUse = hash < this._codeModeTrafficPercent;
    logger.info('Code Mode 分流', {
      messagePreview: message.slice(0, 50),
      hash,
      trafficPercent: this._codeModeTrafficPercent,
      shouldUse,
    });
    return shouldUse;
  }

  /**
   * CM-6：CodeRunner 运行期依赖接线（CODE_MODE 开启时配置）
   * readContext 复用 per-session EventLogStorage.read；
   * writeEvent 复用 appendStreamEvent（seq 取自 EventLogStorage tailSeq）。
   */
  private _wireCodeRunnerDeps(): void {
    if (!coreFeature('CODE_MODE')) return;
    configureCodeRunner({
      readContext: async (opts) => {
        const sid = this._currentSessionId;
        if (!sid) return { unavailable: true, reason: 'no active session' };
        const log = this._getOrCreateEventLog(sid);
        return log.read({ limit: opts?.limit ?? 100 });
      },
      writeEvent: async (type, data) => {
        const sid = this._currentSessionId;
        if (!sid) return;
        const log = this._getOrCreateEventLog(sid);
        const tail = await log.getTailSeq();
        await this.appendStreamEvent(sid, {
          type: type as LiriEvent['type'],
          schemaVersion: 1,
          seq: tail + 1,
          time: Date.now(),
          sessionId: sid,
          data: data as LiriEvent['data'],
        });
      },
      // CM-1 持久化重建：统计会话事件流中 code_run 事件数作为已用轮次
      loadUsedRounds: async () => {
        const sid = this._currentSessionId;
        if (!sid) return 0;
        const log = this._getOrCreateEventLog(sid);
        const events = await log.read({
          types: ['assistant/code_run' as LiriEvent['type']],
          limit: 10000,
        });
        return events.length;
      },
    });
    logger.info('CodeRunner runtime deps wired (CODE_MODE enabled)');
  }

  /**
   * P0 修复（2026-08-14 排查）：TAORLoop 按 sessionId 的 Map 缓存——原单例 `_taorLoop`
   * 首次调用固化了 sessionId，若首个检查点 sessionId 为空（脏数据），之后所有会话
   * 共用绑定空 id 的 TAORLoop → steering 队列/检查点跨会话串扰。Map 化 + 非空校验根治。
   */
  private readonly _taorLoops = new Map<string, TAORLoop>();

  /**
   * I1（最终整支评审）：已登记进进程级注册表（`checkpoint-handlers.activeLoops`）的 sessionId 集合。
   *
   * 为什么需要：`registerTAORLoop` 按 sessionId 注册，而注册表是**进程级**单例 —— 会话拆除
   * （`deleteSession` / `clearAllSessions`）与 `cleanup()` 必须**反向注销**，否则无界增长
   * （内存泄漏 + 僵尸 TAORLoop），且该泄漏**不受功能开关门控**（默认路径即发生）。用本集合
   * 记"本实例注册过谁"（缓存键可能带 `::turnsXn` 后缀，不能直接由 `_taorLoops` 反推）。
   */
  private readonly _registeredTaorSessions = new Set<string>();

  /**
   * G-T3-1（2026-10-12）：**一次性**续跑意图登记（`sessionId` 集合）。
   *
   * `resumeSuspendedSession` 的 taor 分支在触发执行入口前登记；委托路径消费即删
   * （`consumePendingResumeIntent`）⇒ 仅跳过**紧接着那一次**执行的 `taorLoop.reset()`。
   */
  private readonly _pendingResumeIntent = new Set<string>();

  /**
   * RC-E（08-09）：PlanDrivenLoop 实例（懒初始化）
   * B3（2026-09-04）：按 sessionId 的 Map——原单例 `_planDrivenLoop` 首次会话固化
   * taorContext，跨会话复用导致串扰（与 _taorLoops 的 P0 修复同源）。
   */
  private readonly _planDrivenLoops = new Map<string, PlanDrivenLoop>();

  /**
   * P2-3: LoopDetector — 工具调用循环检测器
   * 集成 TAORLoop 的循环检测能力到 streamMessage 工具循环
   */
  private _loopDetector = new LoopDetector();

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
   * 事件日志实例缓存与生命周期（`ChatEventLogStore`，首批提取自本类）。
   *
   * 原字段 `_eventLogCache`、静态常量 `EVENT_LOG_CACHE_MAX` 及 LRU 淘汰/释放逻辑
   * 已随迁至该模块（`chat/manager/eventLogStore.ts`）；本类经同族方法**薄转发**。
   */
  private readonly _eventLogStore = new ChatEventLogStore({
    getCurrentSessionId: () => this._currentSessionId,
    isCodeContext: () => this._lastStreamBuildCodeContext,
    getToolCallSeqMap: () => this._toolCallSeqMap,
    getToolCallSeqMapRebuilt: () => this._toolCallSeqMapRebuilt,
  });

  /**
   * 请求构建 / 快照 / 压缩（`ChatRequestPrep`，A1 批提取自本类）。
   *
   * 原 C14 簇（`extractFilePathsFromText` / `_sanitizeApiMessages` / `requestSnapshot` 家族 /
   * `_buildToolDefinitions` / `_truncateApiMessages` / `_compressToolHistory` /
   * `_estimateArrayTokens` / `_approxJsonLength`）已随迁至该模块；本类经同族方法**薄转发**。
   * 对外签名与日志口径不变（行为等价）；跨簇状态经全 getter 注入（无初始化顺序陷阱）。
   */
  private readonly _requestPrep = new ChatRequestPrep({
    getOrCreateEventLog: (sid) => this._getOrCreateEventLog(sid),
    getChatSessions: () => this._chatSessions,
    getContextTracker: () => this.contextTracker,
    getToolRound: (sid) => this.getToolRound(sid),
  });

  /**
   * 交互解析 + 文件回滚轮次（`ChatRollback`，A2 批提取自本类）。
   *
   * 原 C19 的 5 个成员（`resolveInteraction` / `_getRollbackIntegration` /
   * `_startRollbackRound` / `_endRollbackRound` / `undoRoundsSince`）已随迁至该模块；
   * 本类经同族方法**薄转发**（`_getRollbackIntegration` 无对外调用者 ⇒ 整体迁出）。
   * 对外签名与日志口径不变（行为等价）；跨簇状态经全 getter 注入。
   */
  private readonly _rollback = new ChatRollback({
    getPendingInteractions: () => this._pendingInteractions,
    getMessageService: () => this.messageService,
    addAndPersistMessage: (sid, msg, opts) =>
      this._addAndPersistMessage(sid, msg, opts),
    getRollbackIntegrations: () => this.rollbackIntegrations,
    getPermissionManager: () => this.permissionManager,
    getSessionGateway: () => this.sessionGateway,
  });

  /**
   * 系统提示词组装（`ChatPromptAssembly`，A3 批提取自本类）。
   *
   * 原 C12 的 2 个成员（`getOrAssembleSystemPrompt` / `resolvePromptClientForSystemPrompt`）
   * 已随迁至该模块（`resolvePromptClientForSystemPrompt` 无对外调用者 ⇒ 整体迁出）；
   * 本类经 `getOrAssembleSystemPrompt` **薄转发**。日志/签名不变（行为等价）。
   */
  private readonly _promptAssembly = new ChatPromptAssembly({
    getImageContextService: () => this.imageContextService,
    getSessionAccess: () => this.sessionAccess,
    recordModelInputSnapshot: (sid, input) =>
      this._recordModelInputSnapshot(sid, input),
    getClientForModel: (model?: string) => this.getClientForModel(model),
    getLlmClient: () => this.llmClient,
  });

  /**
   * 启动加载 / 迁移 / 初始化（`ChatBootstrap`，A4a 批提取自本类）。
   *
   * 原 C13 的 6 个成员（`ensureSessionsLoaded` / `_cleanStalePidFiles` /
   * `_migrateHomeFromProjectToUser` / `initialize` / `_resumePendingSessions` /
   * `_loadSessionsFromGateway`）已随迁至该模块；本类经 `ensureSessionsLoaded` /
   * `initialize` 两个**对外入口薄转发**（其余 4 个无对外调用者 ⇒ 整体迁出）。
   * `_sessionsLoaded` / `_resumeFailCount` 随之迁入。日志/签名不变（行为等价）。
   */
  private readonly _bootstrap = new ChatBootstrap({
    getSessionGateway: () => this.sessionGateway,
    getChatSessions: () => this._chatSessions,
    getSessionAccess: () => this.sessionAccess,
    getTokenBudget: () => this.tokenBudget,
    getOrCreateTAORLoop: (sid: string) => this._getOrCreateTAORLoop(sid),
    getLlmClient: () => this.llmClient,
    isDurableResumeEnabled: () => this.ENABLE_DURABLE_RESUME,
    shouldPersistRecalculatedTotal: (before, after) =>
      shouldPersistRecalculatedTotal(before, after),
    // I2（最终整支评审）：启动期重建挂起登记所需的两支扫描入口（流式 = 检查点服务；
    // batch = ResumeManager 单例的 `scanBudgetSuspends`，动态 import 与 bootstrap 既有同款）。
    getCheckpointService: () => this._checkpointService,
    scanBudgetSuspendCheckpoints: async () => {
      const { resumeManager } = await import('../query/ResumeManager.js');
      return resumeManager.scanBudgetSuspends();
    },
    // B3-3：启动登记处一并装配唤醒端口（修「重启后未先发消息即放行 ⇒ 静默无效」）。
    // 装配体仍复用既有惰性入口的实现（幂等：`_budgetSuspendResumeWired` 至多一次）。
    installBudgetSuspendResume: () =>
      this._ensureBudgetSuspendResumeInstalled(),
  });

  /**
   * 流式请求**消息构建**（`ChatStreamMessageLifecycle`，A5a 批提取自本类）。
   *
   * 原 `_buildApiMessagesForStream` / `_buildToolRoundMessages` / `_dedupeToolResultForStub`
   * （含 `_toolResultStubCache`）已随迁至该模块；本类经**薄转发**。
   * 切窗标记 `_lastStreamBuild*` 仍归宿主（被 `streamMessageFlow` 与事件日志 store 读取），
   * 经 setter/getter 注入。日志/签名不变（行为等价）。
   */
  private readonly _streamMessageLifecycle = new ChatStreamMessageLifecycle({
    setLastStreamBuildWindowed: (v) => {
      this._lastStreamBuildWindowed = v;
    },
    setLastStreamBuildCodeContext: (v) => {
      this._lastStreamBuildCodeContext = v;
    },
    getLastStreamBuildCodeContext: () => this._lastStreamBuildCodeContext,
    getCurrentSessionId: () => this._currentSessionId,
  });

  /**
   * 会话拆除 / 级联收口（`ChatSessionTeardown`，A6 批提取自本类）。
   *
   * 原 `deleteSession` / `clearAllSessions` 及三个私有级联助手
   * （`_dismissSessionInboxItems` / `_closeSessionPdca` / `_deleteSessionCheckpoints`）
   * 已随迁至该模块；本类经 2 个对外入口**薄转发**。
   * 其余 C21 成员（`createSession` / `forkSession` / `getSessions` …）**均为 1 行薄委托**
   * （真实实现早已在 `SessionLifecycleManager`）⇒ **不迁**（避免制造薄转发僵尸方法）。
   * 日志/签名不变（行为等价）。
   */
  private readonly _sessionTeardown = new ChatSessionTeardown({
    getSessionLifecycle: () => this.sessionLifecycle,
    getSessionGateway: () => this.sessionGateway,
    getCheckpointService: () => this._checkpointService,
    dropEventLogSession: (sid: string) => this._eventLogStore.dropSession(sid),
    clearToolRound: (sid: string) => this.clearToolRound(sid),
  });

  /**
   * 启动期恢复装配 / yield 恢复器 / 会话内部续跑（`ChatRecovery`，A4b 批提取自本类）。
   *
   * 原 C18 的 5 个成员（`bootstrapYieldRecovery` / `bootstrapRecovery` /
   * `_ensureYieldResumerInstalled` / `_resumeSessionInternally` /
   * `_rebuildTrailingTurnFromEvents`）已随迁至该模块；本类经 `bootstrapYieldRecovery` /
   * `bootstrapRecovery` / `_ensureYieldResumerInstalled` 三个入口**薄转发**
   * （`_resumeSessionInternally` 无宿主调用者 ⇒ 整体迁出；
   * `_rebuildTrailingTurnFromEvents` 仅被宿主 `resumeStream` 调用 ⇒ 经 `_recovery` 直调）。
   * 两个恢复器字段 `_yieldResumerInstalled` / `_yieldResumerUninstall` 仍归宿主
   * （被 `cleanup()` 直接读写）⇒ 经 getter/setter 注入。日志/签名不变（行为等价）。
   */
  private readonly _recovery = new ChatRecovery({
    getSessionGateway: () => this.sessionGateway,
    getStreamMaxTurn: (sid: string) => this.getStreamMaxTurn(sid),
    getUnifiedTracker: () => this.unifiedTracker,
    getYieldResumerInstalled: () => this._yieldResumerInstalled,
    setYieldResumerInstalled: (v: boolean) => {
      this._yieldResumerInstalled = v;
    },
    setYieldResumerUninstall: (fn: (() => void) | null) => {
      this._yieldResumerUninstall = fn;
    },
    streamMessage: (content, options) => this.streamMessage(content, options),
    getOrCreateEventLog: (sid: string) => this._getOrCreateEventLog(sid),
    getSessionLifecycle: () => this.sessionLifecycle,
    getMessageService: () => this.messageService,
  });

  /**
   * M1 事件溯源：toolCallId → seq 映射
   *
   * 用于 tool/result 事件回填 callSeq。
   * key: toolCallId, value: 对应的 assistant/tool_call 事件的 seq
   */
  private _toolCallSeqMap: Map<string, number> = new Map();
  /** T2.2（2026-08-23）：已从 events 重建过 _toolCallSeqMap 的会话集合（懒重建去重） */
  private _toolCallSeqMapRebuilt: Set<string> = new Set();
  /** A-7（2026-08-23）：待对账会话集合（Phase D T-D 对账服务消费） */
  private readonly _pendingReconcileSessions: Set<string> = new Set();

  /**
   * TB-10 修复（2026-09-23）：入队后延迟执行对账的**去抖窗口**（ms）。
   *
   * 语义：append 失败入队后，延迟这段时间再消费一次 —— 既给瞬时 IO 问题留自愈余地
   * （避免"刚失败就去对账"产出误导性漂移报告），也把同一故障窗口内的**多次失败合并为一次**。
   * 声明为 `static` 是为了**测试可覆写**（本仓 app 侧无 fake-timer 基建，见 TB-10 回归用例）。
   */
  static reconcileDrainDelayMs = 3_000;

  /** 待对账去抖定时器（重复入队 ⇒ 重置，只保留最后一次） */
  private _reconcileDrainTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** U-22/S1：PDCA 自动启动簇，方法体见 `manager/pdcaLaunch.ts` */
  private _pdcaLaunch!: PdcaLaunchCoordinator;
  /** U-22/S2：流式请求准备段（`_prepareStreamSession` 的实现，见 `manager/streamSetup.ts`） */
  private _streamSetup!: ChatStreamSetup;
  /** U-22/S3：消息持久化 / 事件投影（`_addAndPersistMessage` 等的实现，见 `manager/messagePersistence.ts`） */
  private _msgPersist!: ChatMessagePersistence;
  /** U-22/S4：流式消息收尾（`_finalizeStreamMessage` 的实现，见 `manager/streamFinalize.ts`） */
  private _streamFinalize!: ChatStreamFinalize;
  /** P0-2（2026-08-25）：正在执行隐性 PDCA launch 的会话集合（会话级锁，防重复任务卡片） */
  private _pdcaLaunchingSessions = new Set<string>();

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
    // 13-P2-1：注册输出侧统一护栏（幂等；`OUTPUT_GUARD=false` 默认 ⇒ 空注册，零行为变更）
    registerDefaultOutputGuards();
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
      defaultBudget.total,
      undefined,
      estimateTokens
    );
    this.unifiedTracker = new UnifiedTokenTracker(
      this.tokenBudget,
      new ContextTracker()
    );
    // C7 收敛：压缩评估统一走 UnifiedTokenTracker（注入到单例编排器）
    compactionOrchestrator.setTracker(this.unifiedTracker);
    // P2-2（2026-09-23）：compaction 的摘要请求**也是一次请求** ⇒ 同样落请求边界事件
    // （与普通请求共用同一编号序列，带 reason='compaction'）。本模块持有会话事件日志，
    // 故在此实现上报并注入单例编排器（避免 `context/` → `chat/` 的反向 import）。
    // 用量/延迟**能拿才写**；未拿到 usage ⇒ 只写真实墙钟耗时（不估不算）。
    const requestAppender: RequestEventAppender = (sid, event) =>
      this.appendStreamEvent(sid, event);
    compactionOrchestrator.setRequestReporter({
      start: (sessionId, info) =>
        startRequest(requestAppender, sessionId, {
          model: info.model,
          reason: 'compaction',
        }),
      finish: async (sessionId, requestId, info) => {
        await finishRequest(requestAppender, sessionId, requestId, {
          usage: info.usage as Record<string, unknown> | undefined,
          durationMs: info.durationMs,
        });
      },
    });
    // B2-2（2026-09-23）：目标生命周期事件落盘 —— 本模块持有会话事件日志，故在此注入
    // 唯一写入实现（与上方 requestReporter 同一手法；避免 `tasks/` → `chat/` 的反向依赖）。
    // 目标状态迁移与"注入模型的目标指令"（`goal/injected`）都经此出口落 `events.jsonl`。
    setGoalEventSink((sid, event) => this.appendStreamEvent(sid, event));
    // B4-1（2026-09-23）：恢复通路审计落盘 —— 同上手法：本模块持有会话事件日志，
    // 故在此注入 `YieldRecoveryAudit` 的唯一写入出口（认领/恢复/放弃三条记录）。
    // 通道为**既有**会话事件日志（`events.jsonl`），不新建审计通道。
    setYieldRecoveryAuditSink((sid, event) =>
      this.appendStreamEvent(sid, event)
    );
    // T-⑥12（2026-10-03）：自唤醒续跑审计落盘 —— 同上手法：本模块持有会话事件日志，
    // 故在此注入 `SelfWakeAudit` 的唯一写入出口（`session/wake`：resumed / resume_failed /
    // handler_absent 三节点）。通道同样为既有 `events.jsonl`，不新建审计通道、不改 UI。
    setSelfWakeAuditSink((sid, event) => this.appendStreamEvent(sid, event));
    // T-②06（2026-10-03）：经验自动演化落盘审计 —— 同上手法：本模块持有会话事件日志，
    // 故在此注入 `EvolutionAudit` 的唯一写入出口（`evolution/applied`：提示覆盖层/技能侧车
    // 被自动改写时各一条）。通道为既有 `events.jsonl`，不新建审计通道、不改 UI。
    setEvolutionAuditSink((sid, event) => this.appendStreamEvent(sid, event));
    // P1-19 ①（2026-10-05）：工作流成员级 run/step 事件实时落盘 —— 同上手法的唯一写入出口。
    // 使 `office:workflow` / `office:doc-pipeline` 在 run 执行期即逐条落 `assistant/workflow_*`
    // 事件（不再等工具结束后批末投影）；批末投影据 `metadata.workflowRun.liveEmitted` 去重。
    setWorkflowRunEventSink((sid, event) => this.appendStreamEvent(sid, event));
    // PR5-S3（2026-10-09，`.trae/specs/durable-execution.md` §3.6）：Execution 生命周期事件落盘
    // —— 同上手法的唯一写入出口（`execution/status_changed` / `execution/recovery`）。
    // `execution` 模块不持有会话事件日志 ⇒ 经注入避免反向依赖；未注入 ⇒ 如实不落。
    setExecutionEventSink((sid, event) => this.appendStreamEvent(sid, event));
    // D 阶段（v5 P0-⑥）：session_summary 自定义类型注册——构造期即执行（早于任何
    // memory scanner/memdir 扫描与压缩触发；registerMemoryType 幂等，重复调用安全）
    registerSessionSummaryMemoryType();
    // 优雅退出（2026-09-02 排查"会话中断"补充）：注册本实例全会话 text-batch
    // 缓冲 flush——进程收到 SIGTERM/SIGINT（watch 重启/Ctrl+C/系统关闭）时先落盘
    // 缓冲正文再退出，避免 torn-tail / open-turn（证据：mtjkl/mtjdmjpo torn + 105 次启动）。
    // 注册幂等（模块级数组，重复构造仅多一条 no-op 闭包）。
    registerEventBufferFlusher(() => this.flushAllPendingEventBuffers());
    // A6（2026-09-04）：退出前 flush 各会话 TAORLoop 未落盘 checkpoint（库不碰全局信号，
    // 宿主钩子链统一调用——main 信号链 → flushAllEventBuffers → 本闭包）
    registerEventBufferFlusher(async () => {
      await this.flushAllCheckpoints();
      return 0;
    });
    // M4（2026-09-17）：退出前为可中断会话写 cleanShutdown 标记——下次启动崩溃恢复跳过
    registerCleanShutdownHandler(async () => {
      await this.sessionGateway.markCleanShutdown();
    });
    // 内存水位订阅（2026-09-02）：L0+ 触发时先落盘全部会话缓冲（脏页写回，
    // OS kswapd 式"压力前先写回"）；订阅在构造期幂等注册一次
    getMemoryPressureMonitor().subscribe((level) => {
      if (level >= 1) {
        void this.flushAllPendingEventBuffers().catch(() => {});
      }
    });
    this.stopHookManager = createStopHookManager();
    this._registerStopHooks();

    // 第一阶段收敛：初始化提取的服务
    this._summarizer = new SessionSummarizer(this.llmClient);
    this._memoryManager = new SessionMemoryManager(
      this.sessionAccess,
      this.llmClient,
      this._chatSessions
    );
    // 2026-10-08（长程任务「执行不了」根因修复）：向 tasks 层注册步骤 TAORLoop 工厂。
    // 此前**只有** PdcaLauncher（会话内升级 / 阶段链）显式 `setTAORLoopFactory`，
    // 而 `getOrCreateOrchestrator()` 这条入口（前端「用编排推进」按钮 = `POST /v1/pdca/start`、
    // CLI `/goal start`）**从不注入** ⇒ 步骤退化为"纯 LLM 文本执行"：模型看不到工具、
    // 工具调用也无处执行（事故 `pdca_muz3wada`：`hasTAORLoop:false`，9 步 / 0 次工具调用）。
    // 注册后两条入口同源同行为。
    setStepLoopFactory((sid, opts) => this._getOrCreateTAORLoop(sid, opts));

    this._pdcaLauncher = new PdcaLauncher({
      enablePlanDrivenLoop: true, // 阶段 3 退役（2026-09-01）：灰度开关删除，恒启用
      taorLoopFactory: (sid, opts) => this._getOrCreateTAORLoop(sid, opts),
      buildTAORContext: (sid, defs, opts) =>
        this._buildTAORContext(sid, defs, opts),
      sessionMap: this._chatSessions,
      messageService: this.messageService,
      persistMessage: (sid, msg) => this._addAndPersistMessage(sid, msg),
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
    this._wireCodeRunnerDeps();

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
      sessionLookup: (args) => this._sessionLookup(args),
      // R3（2026-09-21）：向工具执行注入**会话级中断控制器**。
      // 工具 context 原先没有 `abortController`（被内联类型断言掩盖）⇒ AgentTool 的
      // 父级取消桥接恒空转。此 Map 即 `stopMessage()` 中止的对象（见 `_sessionAbortControllers`），
      // 故"用户点停止"从此能传导到工具内部（并行批次短路未投递 worker）。
      getSessionAbortController: (sessionId) =>
        sessionId ? this._sessionAbortControllers.get(sessionId) : undefined,
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

    // PDCA 自动启动簇（U-22/S1 外移）：注入 host 端口，方法体在 `chat/manager/pdcaLaunch.ts`。
    this._pdcaLaunch = new PdcaLaunchCoordinator({
      launchingSessions: this._pdcaLaunchingSessions,
      getPdcaLauncher: () => this._pdcaLauncher,
      shouldUsePlanDrivenLoop: (msg) => this._shouldUsePlanDrivenLoop(msg),
      shouldUseCodeMode: (msg) => this._shouldUseCodeMode(msg),
      getOrCreateTAORLoop: (sid) => this._getOrCreateTAORLoop(sid),
      getStreamTailSeq: (sid) => this.getStreamTailSeq(sid),
      appendStreamEvent: (sid, event) => this.appendStreamEvent(sid, event),
      persistSessionMetadata: (session) => this.persistSessionMetadata(session),
      recentUserText: (session, n) => this._recentUserText(session, n),
      lastAssistantText: (session) => this._lastAssistantText(session),
    });

    // 流式请求准备段（U-22/S2 外移）：注入 host 端口，方法体在 `chat/manager/streamSetup.ts`。
    this._streamSetup = new ChatStreamSetup({
      currentSessionId: () => this._currentSessionId,
      getOrLoadSession: (sid, metadata) =>
        this.sessionLifecycle.getOrLoadSession(sid, metadata),
      onModelSwitch: (model) => this.unifiedTracker.onModelSwitch(model),
      beginStreamSession: (sid, model) =>
        this.unifiedTracker.beginStreamSession(sid, model),
      getExistingAbort: (sid) => this._sessionAbortControllers.get(sid),
      waitForAbortSettled: (sid, ac) => this._waitForAbortSettled(sid, ac),
      setAbortController: (sid, ac) => {
        this._sessionAbortControllers.set(sid, ac);
      },
      setExecutionId: (sid, executionId) => {
        this._sessionExecutionIds.set(sid, executionId);
      },
      checkpointService: this._checkpointService,
      getOrCreateMutex: (sid) => {
        let mutex = this._sessionMutexes.get(sid);
        if (!mutex) {
          mutex = new SimpleMutex();
          this._sessionMutexes.set(sid, mutex);
        }
        return mutex;
      },
      executePreMessageHook: (args) =>
        this.hookChainManager.execute('chat', args),
      createUserMessage: (content, opts) =>
        this.messageService.createUserMessage(content, opts),
      addAndPersistMessage: (sid, msg) => {
        this._addAndPersistMessage(sid, msg);
      },
      startProcessing: (sid) => {
        this.getSessionMachine(sid).start('processUserInput');
      },
    });

    // 消息持久化 / 事件投影（U-22/S3 外移）：注入 host 端口，方法体在
    // `chat/manager/messagePersistence.ts`；待落盘 Promise 集合仍归宿主（flush 共用）。
    this._msgPersist = new ChatMessagePersistence({
      chatSessions: this._chatSessions,
      sessionGateway: this.sessionGateway,
      getOrCreateEventLog: (sid) => this._getOrCreateEventLog(sid),
      rebuildToolCallSeqMap: (sid) => this._rebuildToolCallSeqMap(sid),
      toolCallSeqMap: this._toolCallSeqMap,
      requestReconcile: (sid, eventLog) =>
        this._requestReconcile(sid, eventLog),
      pendingPersistPromises: this._pendingPersistPromises,
      createAssistantMessage: (content, opts) =>
        this.messageService.createAssistantMessage(content, opts),
      getStreamTailSeq: (sid) => this.getStreamTailSeq(sid),
    });

    // 流式消息收尾（U-22/S4 外移）：注入 host 端口，方法体在
    // `chat/manager/streamFinalize.ts`；abort/executionId 两个 Map 与宿主共享。
    this._streamFinalize = new ChatStreamFinalize({
      addAndPersistMessage: (sid, msg) => this._addAndPersistMessage(sid, msg),
      getStreamMaxTurn: (sid) => this.getStreamMaxTurn(sid),
      getToolRound: (sid) => this.getToolRound(sid),
      hasTurnEnded: (sid, turn) => this.hasTurnEnded(sid, turn),
      getStreamTailSeq: (sid) => this.getStreamTailSeq(sid),
      appendStreamEvent: (sid, event) => this.appendStreamEvent(sid, event),
      endStreamSession: (sid) => this.unifiedTracker.endStreamSession(sid),
      finishSessionMachine: (sid, reason) => {
        this.getSessionMachine(sid).finish(reason);
      },
      sessionAbortControllers: this._sessionAbortControllers,
      sessionExecutionIds: this._sessionExecutionIds,
      persistTurnSummary: (session) => this._persistTurnSummary(session),
      accumulateSessionMemory: (sid, user, assistant, tokens, toolCalls) => {
        this._memoryManager!.accumulate(sid, user, assistant, tokens, toolCalls);
      },
      recentUserText: (session, n) => this._recentUserText(session, n),
      shouldUseCodeMode: (msg) => this._shouldUseCodeMode(msg),
      escalateToPdcaViaBareSession: (params) =>
        this._escalateToPdcaViaBareSession(params),
      autoCreateProject: (session, workspaceId, result) =>
        this._autoCreateProject(session, workspaceId, result),
      maybeLaunchPdca: (session, assistantContent, projectId, lastUser) =>
        this._maybeLaunchPdca(
          session,
          assistantContent,
          projectId,
          lastUser
        ),
      isTelemetryEnabled: () => this.ENABLE_TELEMETRY,
      summarizeSession: (session, message) => {
        void this._summarizer!.summarize(session, message).catch(() => {
          /* 摘要生成失败不阻塞 */
        });
      },
      flushPendingPersists: () => this.flushPendingPersists(),
      incToolRound: (sid) => this.incToolRound(sid),
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
        get toolRoundCount(): number {
          // 设计三：per-session——host 未持有会话时回退当前会话
          return managerRef.getToolRound(managerRef._currentSessionId ?? '');
        },
        incrementToolRoundCount: (): void => {
          const sid = managerRef._currentSessionId;
          if (sid) {
            const next = managerRef.incToolRound(sid);
            logger.debug('chat:toolRoundCount 递增', {
              currentSessionId: sid,
              newValue: next,
            });
          }
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
        ENABLE_PLAN_DRIVEN_LOOP: true, // 阶段 3 退役（2026-09-01）：灰度开关删除，恒启用
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
        recordToolsSnapshot: (sid, schemas) =>
          this._recordToolsSnapshot(sid, schemas as ToolSchema[]),
        loopDetector: this
          ._loopDetector as import('@modules/query').LoopDetector,
        addAndPersistMessage: (sid, msg) =>
          this._addAndPersistMessage(sid, msg),
        appendStreamEvent: (sid, event) => this.appendStreamEvent(sid, event),
        // U4（2026-10-06）：读会话事件（与 appendStreamEvent 成对）——
        // 空闲期在线质量评估器经此按水位增量读；**主链不调用**。
        readSessionEvents: (sid, query) => this.readSessionEvents(sid, query),
        // U4（2026-10-06）：磁盘层"最近更新"会话（历史会话补评用）
        listRecentSessionIds: (limit) => this.listRecentSessionIds(limit),
        // P0-1② 覆盖面补齐（2026-10-04）：无工具回合终稿修复后替换正文（走既有实现）
        updateMessageBlocks: (sid, mid, blocks, text) =>
          this.updateMessageBlocks(sid, mid, blocks, text),
        bufferStreamTextChunk: (sid, mid, content) =>
          this.bufferStreamTextChunk(sid, mid, content),
        flushStreamEventBuffer: (sid) => this.flushStreamEventBuffer(sid),
        getStreamTailSeq: (sid) => this.getStreamTailSeq(sid),
        getStreamMaxTurn: (sid) => this.getStreamMaxTurn(sid),
        getSessionMachine: (sid) => this.getSessionMachine(sid),
        getOrAssembleSystemPrompt: (session, content) =>
          this.getOrAssembleSystemPrompt(session, content),
        extractFilePathsFromText: (text) => this.extractFilePathsFromText(text),
        extractMemoryFromChat: (u, a, sid) =>
          this.extractMemoryFromChat(u, a, sid),
        recordChatResponseUsage: (sid, usage, requestId, model) =>
          this.recordChatResponseUsage(sid, usage, requestId, model),
        sanitizeApiMessages: (msgs) => this._sanitizeApiMessages(msgs),
        truncateApiMessages: (msgs, max, sid, outputBudgetTokens) =>
          this._truncateApiMessages(msgs, max, sid, outputBudgetTokens),
        persistTurnSummary: (session) => this._persistTurnSummary(session),
        // D3（2026-09-25）：运行中长任务信号 ⇒ 按既有升级通道接给 PDCA（闸门见 longTaskEscalation）
        onLongTaskSignal: (session, fact) =>
          this.onLongTaskSignal(session, fact),
        // 跨 run 预算（2026-09-25）：轮次边界把 `metadata.toolTurnBudget` 写回会话存储
        persistSessionMetadata: (session) =>
          this.persistSessionMetadata(session),
        flushPendingPersists: () => this.flushPendingPersists(),
        shouldUseTAORLoop: (sid) => this._shouldUseTAORLoop(sid),
        getOrCreateTAORLoop: (sid) => this._getOrCreateTAORLoop(sid),
        // G-T3-1（2026-10-12）：委托路径据此跳过 `taorLoop.reset()`（一次性续跑意图）。
        consumePendingResumeIntent: (sid) =>
          this.consumePendingResumeIntent(sid),
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
        },
        onTurnEnd: () => this.onTurnEnd?.(),
        _prepareStreamSession: (content, options) =>
          this._prepareStreamSession(content, options),
        _buildApiMessagesForStream: (
          msgs,
          maxCtx,
          outBudget
        ): Promise<Record<string, unknown>[]> =>
          this._buildApiMessagesForStream(msgs, maxCtx, outBudget),
        // C 阶段（P1）：session_lookup 工具注入辅助（schema + 本次构建是否切窗）
        getSessionLookupTool: () =>
          contextLayeringEnabled()
            ? (this.constructor as typeof ChatManagerImpl).SESSION_LOOKUP_TOOL
            : null,
        isLastStreamBuildWindowed: () => this._lastStreamBuildWindowed,
        // D 阶段（v5）：跨会话摘要上卷至长期记忆（adapter 实现：幂等 upsert +
        // skipConsolidation；内部失败仅 warn 不抛）
        rollupSessionSummaryToLongTerm: (input) =>
          rollupSessionSummaryToLongTerm(input),
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
          options,
          terminationReason
        ) =>
          this._finalizeStreamMessage(
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
          this._startRollbackRound(sid, roundId),
        endRollbackRound: (sid, content, firstContent) =>
          this._endRollbackRound(sid, content, firstContent),
        buildToolRoundMessages: (msgs, am, tcs, prs) =>
          this._buildToolRoundMessages(msgs, am, tcs, prs),
      },
    });

    // Fix round 2（2026-10-12）：预算挂起唤醒端口**不再在构造器内注册**，改为惰性装配
    // （见 `_ensureBudgetSuspendResumeInstalled`，入口 = `sendMessage` / `streamMessage`）。
    // 构造器内注册会让每次 `createChatManager()`（命令处理器常见，且从不 `cleanup()`）
    // 产生的丢弃实例都向**进程级单例**注册 listener 并以**单槽覆盖**劫持 `setResumeHandler`
    // ⇒ 唤醒回调指向无会话状态的实例。惰性装配后：丢弃实例从不装配 ⇒ 不累积、不劫持。
  }

  /**
   * Task 7：**惰性装配**预算挂起的**唤醒端口**（幂等；`FEATURE_BUDGET_SUSPEND_RESUME` **默认开**
   * ⇒ 关（`=false`）时零行为变更）。
   *
   * - `getDailyBudget().onReliefApplied` ⇒ 放行发生时把 kind 转给协调器决策；
   * - `coordinator.setResumeHandler` ⇒ 协调器逐会话回调本类的 `resumeSuspendedSession`
   *   （`query/budgetSuspend` **不得** import `chat/**`，故经此注入端口，不构成循环导入）。
   *
   * **惰性而非构造期**（Fix round 2）：对齐 yield 恢复器的装配纪律（`_ensureYieldResumerInstalled`
   * —— 惰性安装 + `cleanup()` 解绑）—— 入口 `sendMessage` / `streamMessage` 各调一次，`_budgetSuspendResumeWired`
   * 保证**至多一次**。构造期装配会让丢弃实例（命令处理器的 `createChatManager()`）注册监听并覆盖 handler。
   * **B3-3**：本体另经 `ChatBootstrap.resumeBudgetSuspends()` 在**启动期**装配一次
   * （修「重启后未先发消息即点放行 ⇒ 静默无效」）；仍非构造期，不违反上述裁决。
   */
  private _ensureBudgetSuspendResumeInstalled(): void {
    if (this._budgetSuspendResumeWired) return;
    if (!coreFeature('BUDGET_SUSPEND_RESUME')) return; // 关（=false）⇒ 不注册（零行为变更）
    this._budgetSuspendResumeWired = true;
    const coordinator = getBudgetSuspendCoordinator();
    this._budgetReliefUninstall = getDailyBudget().onReliefApplied((e) => {
      // `targetSessionId` 原样透传（可选）：会话级入口（挂起卡片「继续」）把唤醒收窄到本会话，
      // 缺省 ⇒ 旧口径（全局，时间序 + 上限）。
      void coordinator
        .onReliefApplied(e.kind, e.targetSessionId)
        .catch((err) => {
          logger.warn('budgetSuspend:onReliefApplied failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    });
    coordinator.setResumeHandler((sessionId, chain) =>
      this.resumeSuspendedSession(sessionId, chain)
    );
  }

  /**
   * 获取或创建 TAORLoop 实例（懒初始化）
   * TAORLoop 统一编排已常驻（ENABLE_LOOP_V8_PHASE2 于阶段 3 退役，2026-09-01）——L6 注释清理 2026-09-06
   */
  private _getOrCreateTAORLoop(
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
  ): TAORLoop {
    // P0 修复（2026-08-14 排查）：空 sessionId 拒绝创建——原单例首次调用固化空 id，
    // 导致所有会话串扰同一 TAORLoop。改为按 sessionId 的 Map 缓存 + 非空校验。
    if (!sessionId) {
      logger.warn(
        '_getOrCreateTAORLoop: 拒绝空 sessionId（防 TAORLoop 串扰污染）'
      );
      throw new Error('TAORLoop requires a non-empty sessionId');
    }
    const multiplier = opts?.maxTurnsMultiplier ?? 1;
    // S1（2026-09-05，PR9）：privateInstance=true → LRTO 任务私有实例——
    // 每次调用全新构建、不入任何缓存（中止/销毁安全，不伤同会话普通对话）。
    if (opts?.privateInstance) {
      const baseMaxTurns =
        parseInt(configManager.env('MAX_TAOR_TURNS') || '') || 300;
      return createChatAgentLoop({
        mode: 'batch',
        queryEngine: this.getQueryEngine(),
        config: {
          sessionId,
          maxTurns: multiplier > 1 ? baseMaxTurns * multiplier : baseMaxTurns,
          // 归属③（2026-09-05）：任务私有实例关闭 DB 检查点——任务级持久化由
          // LRTO._persistCheckpoint 承担；否则此类 checkpoint 会被 Durable Resume
          // 当作会话恢复（sessionId=taskId）造成任务上下文串入普通对话恢复。
          enableCheckpoint: false,
          checkpointInterval: 0,
        },
      });
    }
    // S1（2026-09-05，PR9/B-任务）：扩容续跑时创建放大轮次预算的独立实例——
    // 与基础实例分键缓存（同 multiplier 复用，避免每次 re-roll 新建实例）。
    const cacheKey =
      multiplier > 1 ? `${sessionId}::turnsX${multiplier}` : sessionId;
    let taorLoop = this._taorLoops.get(cacheKey);
    if (!taorLoop) {
      const baseMaxTurns =
        parseInt(configManager.env('MAX_TAOR_TURNS') || '') || 300;
      // 阶段 2（2026-09-01）：统一循环工厂（mode='batch'）替代直接 createTAORLoop
      taorLoop = createChatAgentLoop({
        mode: 'batch',
        queryEngine: this.getQueryEngine(),
        config: {
          sessionId,
          maxTurns: multiplier > 1 ? baseMaxTurns * multiplier : baseMaxTurns,
          /** 启用检查点，每 3 轮自动保存（原值：关闭 + 5 轮） */
          enableCheckpoint: true,
          checkpointInterval: 3,
        },
      });
      this._taorLoops.set(cacheKey, taorLoop);
      // F2（2026-10-12，预算挂起续跑 Task 3）：把实例登记进活跃注册表
      // （`checkpoint-handlers` 的 `activeLoops`）。修复前 `registerTAORLoop` 全仓零调用
      // ⇒ 注册表恒空 ⇒ `handleResumeCheckpoint` 恒 404（batch 手动恢复不可达）。
      //
      // 注册键用 **sessionId**（非 `cacheKey`）：端点的寻址键即路径段 sessionId
      // （`parsePathParams` → `activeLoops.get(params.id)`），而 `cacheKey` 在
      // `multiplier > 1` 时会带 `::turnsXn` 后缀 ⇒ 用它会令放大实例在端点上寻址失配。
      //
      // `TAORLoop` **已存在** `getCheckpointsForSession`（`:1662`）⇒ 直接按 `TaorLoopPort`
      // 结构转发，**不**改 `TAORLoop.ts`（该文件已逼近 R04-001 行数上限）。
      const activeLoop = taorLoop;
      registerTAORLoop(sessionId, {
        getCheckpointsForSession: () => activeLoop.getCheckpointsForSession(),
        resumeFromCheckpoint: (id?: string) =>
          activeLoop.resumeFromCheckpoint(id),
      });
      // I1：记录"本实例注册过谁"，供会话拆除/`cleanup()` 反向注销（防进程级注册表无界增长）。
      this._registeredTaorSessions.add(sessionId);
    }
    return taorLoop;
  }

  /**
   * I1（最终整支评审）：注销某会话在**进程级**注册表（`checkpoint-handlers.activeLoops`）中的登记。
   *
   * 幂等：仅当该 sessionId 确由本实例登记过才注销（避免误删他人登记）。会话拆除与 `cleanup()`
   * 都经此收口 —— 修复前 `unregisterTAORLoop` 全仓零调用 ⇒ 注册表无界增长。
   */
  private _unregisterTaorLoop(sessionId: string): void {
    if (!this._registeredTaorSessions.delete(sessionId)) return;
    unregisterTAORLoop(sessionId);
  }

  /** I1：注销本实例登记过的**全部**会话（`cleanup()` / `clearAllSessions` 用）。 */
  private _unregisterAllTaorLoops(): void {
    for (const sessionId of this._registeredTaorSessions) {
      unregisterTAORLoop(sessionId);
    }
    this._registeredTaorSessions.clear();
  }

  /**
   * RC-E（08-09）：获取或创建 PlanDrivenLoop 实例（懒初始化）
   * 仅在 ENABLE_PLAN_DRIVEN_LOOP 启用时调用
   */
  private _getOrCreatePlanDrivenLoop(
    sessionId: string,
    taorContext: ChatManagerTAORContext
  ): PlanDrivenLoop {
    // B3（2026-09-04）：per-session 缓存——原单例固化首会话 taorContext，
    // 后续会话复用串扰（taorLoop 侧已按 sessionId Map，此处同源修复）
    let planDrivenLoop = this._planDrivenLoops.get(sessionId);
    if (!planDrivenLoop) {
      const taorLoop = this._getOrCreateTAORLoop(sessionId);
      const deps = createChatManagerTAORDeps(taorContext);
      planDrivenLoop = new PlanDrivenLoop({
        taorLoop,
        deps,
        sessionId,
        // B3（2026-09-04）：PDL 侧未注入 decomposerProvider，自动分解实际不可用——
        // 显式关闭避免"enableAutoDecompose:true 静默无效"误读（分解走 PdcaLauncher 阶段链）
        enableAutoDecompose: false,
        onStepProgress: (progress) => {
          logger.info('PlanDrivenLoop 进度', {
            sessionId,
            ...progress,
          });
        },
      });
      this._planDrivenLoops.set(sessionId, planDrivenLoop);
    }
    return planDrivenLoop;
  }

  /**
   * 构建 TAORLoopDeps 上下文（批次4：sendMessage 路径）
   */
  private _buildTAORContext(
    sessionId: string,
    toolDefinitions: ToolDefinition[],
    options?: SendMessageOptions
  ): ChatManagerTAORContext {
    // B-6 补发（2026-08-23）：注入 TAOR 事件通道前记录通道可用性，
    // 便于排查"守卫拦截无 tool/canceled 终态"（通道未注入/丢失）问题。
    logger.info('chat:manager 注入 TAOR 事件通道（B-6 补发）', {
      sessionId,
      appendStreamEvent: typeof this.appendStreamEvent,
      getStreamTailSeq: typeof this.getStreamTailSeq,
      flushPendingPersists: typeof this.flushPendingPersists,
      hasOptions: !!options,
      hasToolDefinitions: toolDefinitions.length > 0,
    });
    return {
      sessionId,
      toolDefinitions,
      // v0.5：注入 toolRegistry + pendingInteractions，支持非流式路径 requiresUserInteraction 检测
      toolRegistry: this.toolRegistry
        ? {
            getTool: (name: string) => {
              const tool = this.toolRegistry!.getTool(name);
              return tool
                ? {
                    requiresUserInteraction: () =>
                      typeof (
                        tool as { requiresUserInteraction?: () => boolean }
                      ).requiresUserInteraction === 'function'
                        ? (
                            tool as { requiresUserInteraction: () => boolean }
                          ).requiresUserInteraction()
                        : false,
                  }
                : undefined;
            },
          }
        : undefined,
      pendingInteractions: this._pendingInteractions,
      sendModelRequest: async (messages, opts) => {
        // A1（2026-08-31 对标 PilotDeck P1-1）：发送前投影——修复 tool 配对 + 安全截断，
        // 防 provider 拒收（降级/非流式路径，对齐 ChatManagerTAORAdapter 主路径）
        const projected = messageProjector.project(
          messages as unknown as import('@modules/ai').ChatMessage[]
        );
        if (projected.warnings.length > 0) {
          logger.warn('chatManager:projector warnings', {
            count: projected.warnings.length,
            warnings: projected.warnings.slice(0, 5),
          });
        }
        const client = this.getClientForModel(options?.model);
        const response = await client.sendMessage(projected.messages, {
          ...options,
          tools: (opts?.tools as Array<Record<string, unknown>>)?.length
            ? (opts?.tools as unknown as import('@modules/ai').ToolDefinition[])
            : undefined,
        });
        return {
          content:
            typeof response.content === 'string'
              ? response.content
              : JSON.stringify(response.content),
          tool_calls: response.tool_calls?.map(
            (tc: import('@modules/ai').ParsedToolCall) => ({
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
      // B-2 补发（2026-08-23）：TAOR 守卫拦截时补发 tool/canceled 事件的事件通道
      appendStreamEvent: (sid, event) =>
        this.appendStreamEvent(sid, event as unknown as LiriEvent),
      getStreamTailSeq: (sid) => this.getStreamTailSeq(sid),
      flushPendingPersists: () => this.flushPendingPersists(),
    };
  } /** U-22/S3 外移：消息持久化主入口（实现在 `manager/messagePersistence.ts`） */
  private async _addAndPersistMessage(
    sessionId: string,
    message: Message,
    options?: { throwOnError?: boolean }
  ): Promise<void> {
    return this._msgPersist.addAndPersistMessage(sessionId, message, options);
  } /** U-22/S3 外移：消息 → 事件日志（实现在 `manager/messagePersistence.ts`） */
  private async _appendEventsForMessage(
    sessionId: string,
    message: Message
  ): Promise<void> {
    return this._msgPersist.appendEventsForMessage(sessionId, message);
  }

  /**
   * A-7（2026-08-23）：触发该会话 T-D 对账（Phase D 对账服务消费）
   *
   * - 记录待对账会话到内存集合，Phase D 实现对账后从集合消费
   * - 熔断期间跳过（防失败风暴，方案 T-B#1 评审 v0.3#11）
   */
  private _requestReconcile(
    sessionId: string,
    eventLog: EventLogStorage
  ): void {
    if (eventLog.isAppendCircuitOpen()) {
      logger.debug('chat:manager 对账请求被熔断跳过（防风暴）', { sessionId });
      return;
    }
    this._pendingReconcileSessions.add(sessionId);
    logger.warn('chat:manager 会话已加入待对账队列（Phase D T-D 消费）', {
      sessionId,
    });
    // TB-10 修复（2026-09-23）：入队后**接上消费者**。
    // 修复前本方法只入队，而 `runPendingReconciles()` 全仓无任何调用点 ⇒ 队列只入不出、
    // `ReconcileService`（5 类漂移检测 + 修复计划）运行时从不执行、`pendingRepair` 标记无消费方。
    this._scheduleReconcileDrain();
  }

  /**
   * TB-10 修复（2026-09-23）：为待对账队列调度一次消费（延迟去抖）。
   *
   * **为何是"入队后延迟"而不是"启动时/定时轮询"**：该队列 `_pendingReconcileSessions`
   * **仅存在于内存**（进程重启即空）⇒ "启动时消费"恒为空操作；真正的触发点就是
   * "刚发生过 append 失败"这一刻。去抖用于把同一故障窗口内的多次失败合并为一次对账。
   */
  private _scheduleReconcileDrain(): void {
    if (this._reconcileDrainTimer) clearTimeout(this._reconcileDrainTimer);
    const timer = setTimeout(() => {
      this._reconcileDrainTimer = null;
      // 逐会话的异常已在 runPendingReconciles 内部经 handleError 处理，这里只兜住"调用本身"的异常：
      // 对账是诊断路径，任何失败都不得影响消息主路径（CS03）
      // @ignore-catch — 见上，诊断路径失败无需上抛
      void this.runPendingReconciles().catch(() => {});
    }, ChatManagerImpl.reconcileDrainDelayMs);
    // 不阻止进程退出（与"仅内存态队列"的事实一致）
    (timer as unknown as { unref?: () => void }).unref?.();
    this._reconcileDrainTimer = timer;
  }

  /**
   * D-1（2026-08-23）：执行待对账会话（消费 A-7 标记的 _pendingReconcileSessions）
   *
   * 对账默认只检测 + 告警 + 生成修复计划（自动修复关闭）。
   *
   * **触发时机（TB-10 修复后更正）**：由 `_requestReconcile` 入队后经 `_scheduleReconcileDrain()`
   * **延迟去抖**调用。原文写"启动时 / 后台定时任务（由外部触发）"——经实测**不存在该外部触发方**，
   * 且该队列**仅存在于内存**（重启即空）⇒ "启动时消费"恒为空操作，故改为入队后自调度。
   */
  async runPendingReconciles(): Promise<void> {
    if (this._pendingReconcileSessions.size === 0) return;
    const service = new ReconcileService({
      getEventLog: (sid) => this._getOrCreateEventLog(sid),
      getProjections: async (sid) => {
        const msgs = await this.sessionGateway.getMessages(sid);
        return msgs.map((m) => ({
          id: m.id,
          role: m.role.toLowerCase(),
          content: typeof m.content === 'string' ? m.content : '',
          timestamp: m.timestamp,
          blocks: m.blocks as Array<Record<string, unknown>> | undefined,
          lastEventSeq: m.lastEventSeq,
        }));
      },
      getSessionMeta: async (sid) => {
        const session = await this.sessionGateway.getSession(sid);
        return session?.metadata as Record<string, unknown> | undefined;
      },
    });
    const pending = [...this._pendingReconcileSessions];
    for (const sid of pending) {
      try {
        const report = await service.reconcileSession(sid);
        if (!report.ok) {
          logger.warn('chat:manager 会话对账完成（有漂移）', {
            sessionId: sid,
            driftCount: report.drifts.length,
            repairPlan: report.repairPlan,
          });
        }
      } catch (e) {
        void handleError(e, {
          module: 'chat:manager',
          action: 'runPendingReconciles',
          context: { sessionId: sid },
        }).catch(() => {});
      }
    }
    // TB-10 修复（2026-09-23）：**只删已处理项**，不再 `clear()` ——
    // 上面的 await 循环期间可能又有新会话入队（同一次故障风暴），`clear()` 会把它们**静默丢弃**。
    for (const sid of pending) this._pendingReconcileSessions.delete(sid);
  }

  /**
   * 获取或创建 per-session EventLogStorage 实例
   *
   * 同一会话复用同一实例，避免重复初始化 tailSeq。
   *
   * D2（2026-09-22）：改为 **LRU**（命中即移到队尾；超上限淘汰最久未用者并释放其快照）。
   * 修复前只增不减（仅在会话删除时 `delete`）⇒ 每个触碰过的会话都常驻一份
   * `eventsSnapshot`（预算 `min(10 000 事件, 200MB)`）。
   */
  private _getOrCreateEventLog(sessionId: string): EventLogStorage {
    return this._eventLogStore.getOrCreateEventLog(sessionId);
  }

  /** D2：会话切换时释放非当前会话的事件快照（实现在 `ChatEventLogStore`） */
  private async _releaseInactiveEventLogSnapshots(
    activeSessionId: string
  ): Promise<void> {
    return this._eventLogStore.releaseInactiveEventLogSnapshots(
      activeSessionId
    );
  }

  /** Fix2：该会话的指定 turn 是否已写 turn/end（状态在 `ChatEventLogStore`） */
  private hasTurnEnded(sessionId: string, turn: number): boolean {
    return this._eventLogStore.hasTurnEnded(sessionId, turn);
  }

  /**
   * M1 事件溯源：流式过程中追加事件到 events.jsonl
   *
   * 实现 ChatOrchestratorHost 接口，供 streamMessageFlow 在每个 chunk yield 前调用。
   * - 失败不阻断流式（CS03）
   * - duplicate-seq 视为正常幂等，不告警
   * - 首次使用时若需迁移旧数据，触发迁移
   */
  async appendStreamEvent(
    sessionId: string,
    event: LiriEvent
  ): Promise<{ ok: boolean; reason?: string; tailSeq: number }> {
    return this._eventLogStore.appendStreamEvent(sessionId, event);
  }

  /**
   * A-2①（2026-09-02，v4 §5.2 选项①）：缓冲一条流式正文 chunk（存储层缓冲；
   * 不落盘、不分配 seq；落盘由 flushStreamEventBuffer / 读路径自动 flush 驱动）。
   */
  async bufferStreamTextChunk(
    sessionId: string,
    messageId: string,
    content: string
  ): Promise<{ ok: boolean }> {
    return this._eventLogStore.bufferStreamTextChunk(
      sessionId,
      messageId,
      content
    );
  }

  /**
   * A-2①：flush 会话全部缓冲正文——按 messageId 聚合为 assistant/text-batch 落盘
   * （F-2 schema），批量失败回退逐 chunk（A-1）。存储层 read/getTailSeq/append
   * 前同样自动 flush（所有权闭环）。
   */
  async flushStreamEventBuffer(
    sessionId: string
  ): Promise<{ ok: boolean; flushed: number }> {
    return this._eventLogStore.flushStreamEventBuffer(sessionId);
  }

  /**
   * 优雅退出（2026-09-02）：flush 全部已创建会话的 text-batch 缓冲。
   * 供进程级 SIGTERM/SIGINT 钩子调用（watch 重启/Ctrl+C）——退出前把缓冲正文
   * 落盘为 assistant/text-batch，避免 torn-tail / open-turn 与流式正文丢失。
   * 单个失败不抛错（CS03），返回 flush 的 chunk 总数。
   */
  async flushAllPendingEventBuffers(): Promise<number> {
    return this._eventLogStore.flushAllPendingEventBuffers();
  }

  /**
   * A6（2026-09-04）：退出兜底——flush 各会话 TAORLoop 未落盘 checkpoint。
   * 库代码不注册全局信号；由 main 信号链经 flushAllEventBuffers 到达本方法。
   * 逐条容错（幂等；无进行中 run 无操作）。
   */
  async flushAllCheckpoints(): Promise<void> {
    await Promise.all(
      [...this._taorLoops.values()].map((loop) =>
        loop.flushCheckpoint().catch(() => {
          // @ignore-catch — 单会话 checkpoint flush 失败不阻断退出链（CS03）
        })
      )
    );
  }

  /**
   * C 阶段（2026-09-02，P1，C 详设 §4）：`session_lookup` 取回实现
   * （实现在 `ChatEventLogStore.sessionLookup`）。
   */
  private async _sessionLookup(
    args: SessionLookupArgs
  ): Promise<SessionLookupResult> {
    return this._eventLogStore.sessionLookup(args);
  }

  /**
   * D 阶段（2026-09-02，v4 §8）：读取会话远期摘要
   * （实现在 `ChatEventLogStore.getSessionSummaries`）。
   */
  async getSessionSummaries(
    sessionId: string,
    limit: number = 200
  ): Promise<SessionSummaryRecord[]> {
    return this._eventLogStore.getSessionSummaries(sessionId, limit);
  }

  /**
   * D 阶段：按关键词检索会话摘要
   * （实现在 `ChatEventLogStore.searchSessionSummaries`）。
   */
  async searchSessionSummaries(
    sessionId: string,
    keyword: string,
    limit: number = 5
  ): Promise<SessionSummaryRecord[]> {
    return this._eventLogStore.searchSessionSummaries(
      sessionId,
      keyword,
      limit
    );
  }

  /**
   * M1 事件溯源：获取当前会话的 tailSeq
   * （实现在 `ChatEventLogStore.getStreamTailSeq`）。
   */
  async getStreamTailSeq(sessionId: string): Promise<number> {
    return this._eventLogStore.getStreamTailSeq(sessionId);
  }

  /**
   * U4（2026-10-06，`.trae/specs/online-quality-evaluation.md`）：**读**会话事件
   * （与上方 `getStreamTailSeq` 同族：都是对事件日志的薄包）。
   *
   * 消费者：① 空闲期在线质量评估器（经宿主 `ChatOrchestratorHost.readSessionEvents` 注入）；
   * ② 会话质量 SPI 实现（`entrypoints/spiWiring.ts`，供梦境按分取数）。
   * **主链不调用** ⇒ 不影响 TTFB。
   */
  async readSessionEvents(
    sessionId: string,
    query: EventLogQuery
  ): Promise<LiriEvent[]> {
    return this._getOrCreateEventLog(sessionId).read(query);
  }

  /**
   * U4（2026-10-06）：列出**最近更新**的会话 id（**磁盘层**，含本进程未加载的会话）。
   *
   * 用途：空闲期在线质量评估的"历史会话补评" —— 原先只覆盖 `chatSessions`（本进程已加载），
   * 磁盘上更早的会话永不评分。排序口径由 `rankRecentSessionIds` 决定（`updatedAt` 降序 + 截断）。
   *
   * 数据源复用启动期加载会话的同一入口（`SessionGateway.listSessions`，见
   * `chat/manager/bootstrap.ts:413`）⇒ **不新增第二套会话枚举**。
   */
  async listRecentSessionIds(limit: number): Promise<string[]> {
    const stored = await this.getSessionGateway().listSessions();
    return rankRecentSessionIds(
      stored.map((s) => ({ id: s.id, updatedAt: s.updatedAt })),
      limit
    );
  }

  /**
   * T2.2（2026-08-23）：从 events 重建 toolCallId → 事件 seq 映射
   * （实现在 `ChatEventLogStore.rebuildToolCallSeqMap`）。
   */
  private async _rebuildToolCallSeqMap(sessionId: string): Promise<void> {
    return this._eventLogStore.rebuildToolCallSeqMap(sessionId);
  }

  /**
   * M1 事件溯源：获取当前会话已有事件的最大 turn 编号（重启后恢复 turn 计数）
   * （实现在 `ChatEventLogStore.getStreamMaxTurn`）。
   */
  async getStreamMaxTurn(sessionId: string): Promise<number> {
    return this._eventLogStore.getStreamMaxTurn(sessionId);
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
    } catch (persistErr) {
      // KB-PERSIST-CATCH（2026-08-29）：WAP 关键路径——落盘失败/超时静默会掩盖
      // 数据未持久化，必须记录
      logger.warn('待持久化消息落盘失败/超时', {
        count: promises.length,
        error:
          persistErr instanceof Error ? persistErr.message : String(persistErr),
      });
    }
  } /** U-22/S3 外移：终态 blocks 落盘（实现在 `manager/messagePersistence.ts`） */
  public async updateMessageBlocks(
    sessionId: string,
    messageId: string,
    blocks: Array<Record<string, unknown>>,
    text?: string
  ): Promise<void> {
    return this._msgPersist.updateMessageBlocks(
      sessionId,
      messageId,
      blocks,
      text
    );
  }

  /**
   * 获取 HookChain 管理器
   * @returns HookChain 管理器实例
   */
  public getHookChainManager(): HookChainManager {
    return this.hookChainManager;
  }

  /**
   * A3 拆分：系统提示词组装已迁至 `ChatPromptAssembly.getOrAssembleSystemPrompt`（薄转发）。
   * 原 `resolvePromptClientForSystemPrompt` 仅被本方法调用 ⇒ 整体迁出；原静态常量
   * `PROMPT_ASSEMBLY_ROUTE` 随之迁出为该模块的模块级常量（`PROMPT_ASSEMBLY_ROUTE`）。
   */
  private async getOrAssembleSystemPrompt(
    session: ChatSession,
    currentMessage?: string
  ): Promise<string> {
    return this._promptAssembly.getOrAssembleSystemPrompt(
      session,
      currentMessage
    );
  }

  /**
   * A4a 拆分：会话加载已迁至 `ChatBootstrap.ensureSessionsLoaded`（薄转发）。
   * `_sessionsLoaded` 幂等标记随之迁入该模块。
   */
  async ensureSessionsLoaded(): Promise<void> {
    await this._bootstrap.ensureSessionsLoaded();
  }

  /**
   * A4a 拆分：启动初始化已迁至 `ChatBootstrap.initialize`（薄转发）。
   * 原 `_cleanStalePidFiles` / `_migrateHomeFromProjectToUser` / `_resumePendingSessions` /
   * `_loadSessionsFromGateway` 仅被本簇调用 ⇒ 整体迁出；`_resumeFailCount` 熔断计数随之迁入。
   */
  async initialize(): Promise<void> {
    await this._bootstrap.initialize();
  }

  /** A1 拆分：文件路径提取已迁至 `ChatRequestPrep.extractFilePathsFromText`（薄转发） */
  private extractFilePathsFromText(text: string): string[] {
    return this._requestPrep.extractFilePathsFromText(text);
  }

  /** A1 拆分：API 消息 sanitize 已迁至 `ChatRequestPrep.sanitizeApiMessages`（薄转发） */
  private _sanitizeApiMessages(apiMessages: Record<string, unknown>[]): void {
    this._requestPrep.sanitizeApiMessages(apiMessages);
  }

  /**
   * A1 拆分：模型输入快照（TR-12-B）已迁至 `ChatRequestPrep`（含其 `_requestSnapshot` 惰性单例）。
   * 快照服务仍复用宿主的事件日志访问器（`_getOrCreateEventLog`）⇒ 无 tailSeq 分裂。
   */
  private _recordModelInputSnapshot(
    sessionId: string,
    input: ModelInputSnapshot
  ): Promise<void> {
    return this._requestPrep.recordModelInputSnapshot(sessionId, input);
  }

  /** TR-12-B：工具清单快照（3 个装配点的统一出口） */
  private _recordToolsSnapshot(sessionId: string, schemas: ToolSchema[]): void {
    this._requestPrep.recordToolsSnapshot(sessionId, schemas);
  }

  /** A1 拆分：`ToolSchema[] → ToolDefinition[]` 已迁至 `ChatRequestPrep.buildToolDefinitions` */
  private _buildToolDefinitions(schemas: ToolSchema[]): ToolDefinition[] {
    return this._requestPrep.buildToolDefinitions(schemas);
  }

  /**
   * 上下文长度保护（委托给 MessageContextPipeline；已随 A1 拆入 `ChatRequestPrep`）
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
    await this._requestPrep.truncateApiMessages(
      apiMessages,
      maxContextTokens,
      sessionId,
      outputBudgetTokens
    );
  }

  /**
   * 压缩工具循环历史消息（委托给 MessageContextPipeline；已随 A1 拆入 `ChatRequestPrep`）
   */
  private async _compressToolHistory(
    currentRoundMessages: Record<string, unknown>[],
    sessionId: string,
    assistantMsg: Record<string, unknown>,
    toolResults: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    return this._requestPrep.compressToolHistory(
      currentRoundMessages,
      sessionId,
      assistantMsg,
      toolResults
    );
  }

  /**
   * 估算消息数组的 token 数（已随 A1 拆入 `ChatRequestPrep.estimateArrayTokens`）
   */
  private async _estimateArrayTokens(
    messages: Record<string, unknown>[]
  ): Promise<number> {
    return this._requestPrep.estimateArrayTokens(messages);
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
    // B1/O1-1：卸载 yield 恢复器 + 清空两条续跑执行器与 run 探针。
    // 未卸载时实例重建会把 listener 累积在模块级数组里，且旧 listener 的闭包
    // 仍指向旧实例（结算信号唤醒的是旧实例）。
    this._yieldResumerUninstall?.();
    this._yieldResumerUninstall = null;
    this._yieldResumerInstalled = false;
    setYieldResumeHandler(null);
    setSelfWakeResumeHandler(null);
    setActiveSubagentRunProbe(null);
    // Task 7：卸载预算放行监听 + 摘除协调器 handler（同 yield 恢复器的防闭包累积纪律）
    // Fix round 2：仅当**本实例**确是装配者时才摘除 —— 惰性装配后未装配的实例（如丢弃实例）
    // 不得清掉 live 实例已装配的 handler。
    if (this._budgetSuspendResumeWired) {
      this._budgetReliefUninstall?.();
      this._budgetReliefUninstall = null;
      this._budgetSuspendResumeWired = false;
      getBudgetSuspendCoordinator().setResumeHandler(null);
    }
    // B1-6 / P0-6：**清空模块级单例的等待集**。卸载 listener 只切断"新信号"，
    // 而 `YieldRegistry` 是**进程级单例**（`getYieldRegistry()`）⇒ 条目会跨实例残留，
    // 新实例可能对**陈旧登记**发起恢复（修复前此处无 clear()，见 §2.5 P0-6）。
    getYieldRegistry().clear();

    // I1：注销本实例登记进进程级注册表的全部 TAORLoop（同"清理模块级单例"纪律，
    // 否则实例重建会让 `activeLoops` 累积僵尸端口）。
    this._unregisterAllTaorLoops();

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
    // 阶段 A（N-42 补正，2026-09-20）：**非流式入口同样懒装配 yield 恢复器**。
    // 原装配只在 `streamMessage` 入口（见 `_ensureYieldResumerInstalled`）——非流式
    // （`/v1/chat/completions`）不经该入口 ⇒ `yieldSettlementListeners` 为空 ⇒
    // 子代理结算时 `notifyYieldSettled` **静默丢弃**（等待已登记却永不恢复，且无任何日志）。
    this._ensureYieldResumerInstalled();
    // Fix round 2（2026-10-12）：惰性装配预算挂起唤醒端口（同 yield 恢复器；构造期不再装配）。
    this._ensureBudgetSuspendResumeInstalled();
    // G-T3-1 / Important-1（Fix round 2）：进入**普通轮**前无条件清空该会话的残留续跑意图。
    // `resumeSuspendedSession` 的 taor 分支只在委托执行**前**登记意图，而消费点在 TAOR 分支
    // **内部**（`ChatOrchestrator` 的 `tool_calls` + `shouldUseTAORLoop` 两层）⇒ 若续跑轮未进入
    // 该分支（无 `tool_calls` / 未走 TAOR / 分支前抛错），意图会**滞留**并误跳过此后任意一次
    // 普通含工具轮次的 `reset()`。在此清空 ⇒ 意图生命周期收敛为「只影响紧接着的那一次执行」。
    this.clearResumeIntent(options?.sessionId || this._currentSessionId || '');
    return this.chatOrchestrator.sendMessage(content, options);
  }

  /**
   * F2 / D7（2026-10-12，预算挂起续跑 Task 3）：挂起会话的「唤醒 → 续跑」入口。
   *
   * - `chain='stream'`：**先试重放、无进展则重发**（C1/I3 口径订正）——见 `_resumeSuspendedStream`；
   * - `chain='taor'`：先 `resumeFromCheckpoint(latest)` 恢复游标，再注入续跑 steering
   *   （I4：携带未完成工具清单），最后**触发既有执行入口**（`ChatOrchestrator.sendMessage`
   *   的 TAOR 委托路径）。—— `resumeFromCheckpoint` 只恢复内存状态、**不触发执行**
   *   （spec §3-D7「真再跑」为硬要求），故必须再触发一次既有入口，且**不新增执行路径**。
   *
   * @returns 是否**真正发起**了续跑（两链都"未发生后返回 `false`" ⇒ 协调器保留挂起）
   */
  async resumeSuspendedSession(
    sessionId: string,
    chain: 'stream' | 'taor'
  ): Promise<boolean> {
    if (chain === 'stream') {
      // C1/I3（最终整支评审）：流式链唤醒改为"先试重放、无进展则重发"（见 `_resumeSuspendedStream`）。
      return this._resumeSuspendedStream(sessionId);
    }

    const taorLoop = this._getOrCreateTAORLoop(sessionId);
    const checkpoints = await taorLoop.getCheckpointsForSession();
    const latest = checkpoints?.[0];
    const latestId = latest?.id;
    const resumed = await taorLoop.resumeFromCheckpoint(latestId);
    if (!resumed) {
      logger.warn('resumeSuspendedSession: 无可用 TAOR 检查点，跳过续跑', {
        sessionId,
      });
      return false;
    }
    // 续跑 steering（与 bootstrap.resumePendingSessions 同源：`durable-resume`）。
    // I4：**消费**挂起检查点落盘的「未完成工具」清单 ⇒ 提示带上尚未完成的工具名/参数摘要；
    // 无清单（历史/首轮即撞限）⇒ 退化为通用续跑提示。
    const resumeInstruction = buildBudgetResumePrompt(latest?.pendingToolCalls);
    taorLoop.injectSteering(resumeInstruction, 'durable-resume');
    // G-T3-1（2026-10-12）：登记**一次性**续跑意图——委托路径（`ChatOrchestrator.sendMessage`
    // 的 TAOR 分支）会 `taorLoop.reset()`，而 `reset()` 会清 `turnCount` / `resumedFromCheckpoint`
    // / `steeringQueue` ⇒ 刚恢复的游标与 steering 在下一次执行前即被丢弃、"续跑"退化。
    // 必须在触发执行入口**之前**登记（消费点见 `ChatOrchestrator` 的 reset 调用点）。
    this.markResumeIntent(sessionId);
    // 真再跑：触发既有执行入口（TAOR 委托路径 `ChatOrchestrator.sendMessage`）
    await this.chatOrchestrator.sendMessage(resumeInstruction, { sessionId });
    return true;
  }

  /**
   * C1/I3（最终整支评审）：流式链唤醒 —— **先试重放，无实质进展则经既有入口重发一轮**。
   *
   * 事实：日预算闸门在 `ReActLoop.run` 的**轮首、REASON 之前**触发（此刻上一轮 ACT 的工具
   * **已全部完成**）⇒ `resumeStream` 过滤"未完成工具"后剩余为 0，直接 yield `task_all_done`
   * 并 return（不发起新 REASON 轮）⇒ 主链唤醒**退化为空操作**（用户见"放行成功"但任务不走）。
   *
   * 口径（对齐 `daily-budget-over-limit-ux` §5-D-1 D「最简可续跑（重发）」）：
   *  ① 先跑 `resumeStream`（保留既有"重放未完成工具"能力），并判定是否产生**实质进展**；
   *  ② 无实质进展 ⇒ 经**既有**执行入口 `ChatOrchestrator.sendMessage`（与 `taor` 分支同一族）
   *     发起**一次**续跑轮，携带 I4 生成的续跑提示（含未完成工具清单）；
   *  ③ **返回值如实**：真正发起了执行 ⇒ `true`；两次都未发生 ⇒ `false`（协调器据此**保留挂起**）。
   */
  private async _resumeSuspendedStream(sessionId: string): Promise<boolean> {
    // I4：从挂起检查点读出「未完成工具」清单（供"重发一轮"的提示消费；缺失 ⇒ 通用提示）
    const latest = await this.getLatestCheckpoint(sessionId);
    const pending = (
      latest?.metadata as
        | { pendingToolCalls?: PendingToolCallRef[] }
        | undefined
    )?.pendingToolCalls;

    // ① 先试重放：完整消费生成器（重放本身即"继续执行"，不可提前 break）
    let progressed = false;
    for await (const chunk of this.resumeStream(sessionId, '')) {
      if (this._isSubstantiveResumeChunk(chunk)) progressed = true;
    }
    if (progressed) {
      await this._markBudgetResumed(sessionId);
      return true;
    }

    // ② 无实质进展 ⇒ 重发一轮（既有执行入口，不新增执行路径）
    // T1-13 / `✅-4` R-A（2026-10-13）：开关开 ⇒ 在**重算工具面之前**注入「重放强制集」
    // （该会话最近一条 `execution/prepared` 快照的 `visibleTools`）⇒ 重放工具面 = 落盘快照，
    // 不受运行期 profile / 注册表变更影响；开关关（默认）/ 无快照 ⇒ 不注入 ⇒ 逐字等价现状。
    const forcedVisibleTools = await this._resolveReplayForcedTools(sessionId);
    try {
      await this.chatOrchestrator.sendMessage(
        buildBudgetResumePrompt(pending),
        {
          sessionId,
          ...(forcedVisibleTools ? { forcedVisibleTools } : {}),
        }
      );
      await this._markBudgetResumed(sessionId);
      return true;
    } catch (err) {
      // ③ 重发也失败 ⇒ 如实返回 false（协调器回滚为挂起，不 release）
      logger.warn('resumeSuspendedSession: 流式重发失败，保留挂起', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * 2026-10-17（台账 `BUDGET-SUSPEND-RESTART-IDEMPOTENT`）：放行**续跑成功** ⇒ 落一条
   * 「已从挂起点恢复」轻量检查点（`StreamingAutoCheckpoint.markResumed`）。
   *
   * 为什么需要：挂起事实源 = 检查点（`metadata.budgetSuspend`）、启动扫描据此重建挂起登记；
   * 而此前**没有任何机制让该标记失效** ⇒ 已续跑过的会话在每次重启/重载后又变回「已挂起」
   * （真机实证：同一会话当日被登记 10 次、用户被迫反复点「继续」）。落一条**更新**的检查点后，
   * `ChatBootstrap.resumeBudgetSuspends` 的「只认最新检查点」判据即判定其不再挂起。
   *
   * 与「重放/重发**均失败** ⇒ 不落标记（协调器回滚为挂起）」对称 —— 只有**真续跑**才算恢复。
   * 失败仅告警（CS03：登记面失败不得反过来把一次成功的续跑判成失败）。
   */
  private async _markBudgetResumed(sessionId: string): Promise<void> {
    try {
      await new StreamingAutoCheckpoint(
        this._checkpointService,
        sessionId
      ).markResumed();
    } catch (err) {
      logger.warn(
        'resumeSuspendedSession: 落「已恢复」标记失败（续跑已成功）',
        {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        }
      );
    }
  }

  /**
   * T1-13 / `✅-4`（R-A，2026-10-13）：解析「**重放强制可见集**」——受 `PREPARED_SNAPSHOT_REPLAY`（**默认关**）。
   *
   * 开关关 ⇒ **不读事件日志**、返回 `undefined`（零开销、零行为变更）；开 ⇒ 读该会话最近一条
   * `execution/prepared` 快照的 `visibleTools`（无快照 ⇒ `undefined`，**不臆造**）。
   * 读取失败只留痕（CS03：不把观测面失败升级为续跑失败）。
   * 见 `.trae/specs/execution-prepared-snapshot-persistence.md` §11 R-A。
   */
  private async _resolveReplayForcedTools(
    sessionId: string
  ): Promise<string[] | undefined> {
    if (!feature('PREPARED_SNAPSHOT_REPLAY')) return undefined;
    try {
      const { resolveReplayVisibleTools } = await import('@modules/execution');
      // 只读该类型事件（每执行一条 ⇒ 结果集极小；`limit` 取上限以覆盖长会话）
      const events = await this.readSessionEvents(sessionId, {
        types: ['execution/prepared'],
        limit: 10000,
      });
      return resolveReplayVisibleTools(events) ?? undefined;
    } catch (e) {
      // @ignore-catch — 强制集读取失败不影响续跑（CS03），已 warn
      logger.warn('PREPARED 快照重放：读取落盘快照失败，按现状续跑', {
        sessionId,
        error: String(e),
      });
      return undefined;
    }
  }

  /**
   * C1：判定 `resumeStream` 产出的 chunk 是否代表**实质进展**。
   *
   * 非实质 = `error`（打不开检查点等）或 `status/task_all_done`（无剩余工具、空操作）。
   * 其余（文本增量 / reasoning / 工具事件 / `status/resume`）均视为真正推进了执行。
   */
  private _isSubstantiveResumeChunk(chunk: string | ChatStreamChunk): boolean {
    if (typeof chunk === 'string') return chunk.length > 0;
    const c = chunk as { type?: string; statusType?: string };
    if (c.type === 'error') return false;
    if (c.type === 'status' && c.statusType === 'task_all_done') return false;
    return true;
  }

  /**
   * G-T3-1（2026-10-12）：登记**一次性**续跑意图（`resumeSuspendedSession` 的 taor 分支专用）。
   *
   * 语义：为 `sessionId` 打一个"下一次委托执行是**续跑**"的标记 —— 委托路径据此
   * **跳过** `taorLoop.reset()`，使刚恢复的游标/steering 存活到执行入口。
   */
  markResumeIntent(sessionId: string): void {
    this._pendingResumeIntent.add(sessionId);
  }

  /**
   * G-T3-1（2026-10-12）：**一次性消费**续跑意图 —— 命中即删并返回 `true`；未命中返回 `false`。
   *
   * 一次性是关键：意图只应作用于紧接着的那一次委托执行；消费后（或未登记时）委托路径
   * 照常 `reset()`（既有行为不变）。
   */
  consumePendingResumeIntent(sessionId: string): boolean {
    return this._pendingResumeIntent.delete(sessionId);
  }

  /**
   * G-T3-1 / Important-1（Fix round 2，2026-10-12）：**无条件清空**某会话的续跑意图（幂等）。
   *
   * 由 `sendMessage` 入口在每次普通轮开始前调用 —— 保证意图**只影响紧接着的那一次执行**：
   * 续跑轮若未进入委托路径的 TAOR 分支（无 `tool_calls` / 未走 TAOR / 分支前抛错），
   * 残留意图不得泄漏到后续轮次而误跳过其 `reset()`。
   */
  clearResumeIntent(sessionId: string): void {
    this._pendingResumeIntent.delete(sessionId);
  }
  private async _sendMessageDowngradePath(
    session: ChatSession,
    toolCalls: ParsedToolCall[],
    apiMessages: Record<string, unknown>[],
    activeClient: ToolAwareClient,
    options?: SendMessageOptions
  ): Promise<Message> {
    // G-2（2026-10-11，Spec `daily-budget-over-limit-ux.md` §1.2 G-2 / §5-D-1）：**降级路径补闸门**。
    //
    // 本路径**直调** `activeClient.sendMessage`（不经 `sendMessageFlow.invokeLlm` 的闸门）⇒ 此前
    // TAORLoop 一失败就换条路再烧一遍额度（G-2 的绕过路径）。判定放在**最前**：整轮被拒时
    // **连工具副作用也不做**，避免"工具已执行、模型却没调"的半成品。
    // 载体：抛带真实业务码的业务异常 —— 由调用方 `ChatOrchestrator.sendMessage` 的 catch **放行上抛**
    //（见该处预算例外）⇒ 最终经 `llmChatOps.chat` 保真为 `errorCode`（HTTP 429 + 放行入口，同 T8 契约）。
    assertEntryBudget({
      entry: 'chat-downgrade',
      estimatedTokens: estimateMessagesTokens(apiMessages),
    });

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
        // 13-P1-2（2026-10-05）：非幂等工具失败 ⇒ 明确告知模型**不要盲目重试**
        // （模型是实际的"重试方"，此处是唯一能约束它的位置；策略事实源 = tools/toolEffects.ts）
        const effect = resolveToolEffect(tc.name);
        const retryCaution =
          toolResult.error && effect && effect.idempotent === false
            ? `\n\n[重试注意] 该工具已声明为**非幂等**（sideEffect=${effect.sideEffect}）：` +
              '重复执行可能导致副作用重复。请先确认上一次调用的实际影响，再决定是否重试；' +
              '必要时改为向用户确认或执行补偿，禁止直接原样重试。'
            : '';
        apiMessages.push({
          role: 'tool',
          content:
            JSON.stringify(toolResult.result ?? toolResult.error ?? '') +
            retryCaution,
          tool_call_id: tc.id,
        });
      }

      // A1（2026-08-31 对标 PilotDeck P1-1）：发送前投影——修复 tool 配对，
      // 防 provider 拒收（降级路径 tool 结果可能缺配对 assistant.tool_calls）
      const projected = messageProjector.project(
        apiMessages as unknown as ChatMessage[]
      );
      const fallbackResponse = await activeClient.sendMessage(
        projected.messages,
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
    // T2-8 / `✅-17`（2026-10-13，形态 A）：编排**入口**只读上报 `PREPARED` —— **不**承载
    // "断言/锁定"裁决（四原语严格无状态、只读，见 `state/engine/projectionBroker.ts` 头注）。
    // 受 `STATE_PROJECTION_BROADCAST`（默认关）门控 ⇒ 关时零发布、零行为变更。
    publishOrchestrationProjection({
      primitive: 'PREPARED',
      orchestrationId: workspaceId,
    });
    // A10（2026-10-06）：走单一构造点 —— 原 `new CouncilOrchestrator(getCouncilEngine())`
    const { getCouncilOrchestrator } =
      await import('@modules/workspace/CouncilOrchestrator');
    await getCouncilOrchestrator().startCouncil(workspaceId, topic, context);
  }

  /**
   * D5-A（2026-09-25，`.trae/specs/memory-dedup-blocking-rootfix.md`）：会话 → 该会话
   * 「对话记忆」的 memoryId。用于**按会话聚合**（原实现每轮新建一条 ⇒ 库随轮数线性增长，
   * 本机实测已 576 条，全库去重成本 O(n²) 随之膨胀）。
   */
  private readonly _conversationMemoryIdBySession = new Map<string, string>();

  /** D5-A：单条对话记忆的**内容上限**（按会话聚合后必须封顶，否则单条无界增长） */
  private static readonly CONVERSATION_MEMORY_MAX_CHARS = 20_000;

  private async extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    try {
      const { getMemoryManager } = await import('@modules/memory');
      const mm = getMemoryManager();
      const turnText = `用户: ${userContent}\n助手: ${assistantContent}`;

      /** 追加一轮对话并封顶（保留最近内容） */
      const appendTurn = (prev: string): string => {
        const joined = prev ? `${prev}\n\n${turnText}` : turnText;
        const cap = ChatManagerImpl.CONVERSATION_MEMORY_MAX_CHARS;
        return joined.length > cap ? joined.slice(joined.length - cap) : joined;
      };

      // `updateMemory` 是**合并语义**（metadata 浅合并、updatedAt 由它自设）⇒ 只传 content
      const writeInto = async (
        id: string,
        prevContent: string
      ): Promise<void> => {
        await mm.updateMemory(id, { content: appendTurn(prevContent) });
      };

      // ① 快路径：进程内缓存命中 ⇒ 追加（不再新建）
      const cachedId = this._conversationMemoryIdBySession.get(sessionId);
      if (cachedId) {
        const existing = await mm.getMemory(cachedId);
        if (existing) {
          await writeInto(cachedId, existing.content ?? '');
          return;
        }
        // 该条已被删除（维护期去重/清理）⇒ 清缓存，走重建分支
        this._conversationMemoryIdBySession.delete(sessionId);
      }

      // ② 慢路径：按会话标签查找既有条目（进程重启后仍能续写同一条，而非另起一条）
      const all = await mm.getAllMemories();
      const found = all.find(
        (m) =>
          m.metadata?.type === 'conversation' &&
          Array.isArray(m.metadata?.tags) &&
          m.metadata.tags.includes(sessionId)
      );
      if (found) {
        this._conversationMemoryIdBySession.set(sessionId, found.id);
        await writeInto(found.id, found.content ?? '');
        return;
      }

      // ③ 首次：新建（此后每轮都追加到这一条）
      const created = await mm.createMemory({
        content: turnText,
        metadata: {
          name: `会话 ${sessionId.slice(0, 8)} 对话`,
          description: '从对话中自动提取（按会话聚合，逐轮追加）',
          type: 'conversation',
          tags: ['auto-extracted', sessionId],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      this._conversationMemoryIdBySession.set(sessionId, created.id);
    } catch (err) {
      // 记忆提取失败不影响主流程
      handleError(err, { module: 'chat:manager', action: 'extractMemory' });
    }
  }

  /**
   * 记录 LLM 响应的令牌用量
   *
   * @param requestId P2-2（2026-09-23）：所属请求标识（= 同请求 `request/start` 的 seq）。
   *   **仅透传新增字段**，不改任何用量口径（TR-11 修复的 usage 语义/守卫原样）；
   *   拿不到（工具轮 / 非流式路径 / start 落盘失败）⇒ 不写该字段。
   * @param model 债四「换算接线」（2026-10-13）：本轮**实际模型**（供金额台账取价换算）。
   *   缺失 / 占位 `'unknown'` ⇒ 只记 token、**不记金额**（**不臆造金额**，见 `recordTurnCostUsd`）。
   */
  private recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void {
    if (!usage) return;
    const inputTokens = usage.prompt_tokens ?? usage.inputTokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.outputTokens ?? 0;
    if (inputTokens === 0 && outputTokens === 0) return;

    const totalTokens = inputTokens + outputTokens;
    this.tokenBudget.consumeTokens(totalTokens);

    // R16（台账 L-14）：**每日 Token 预算**（进程共享单例）——**结算**本会话预扣
    // （`reserveFor` 在发送前预留；此处多退少补为真实用量），覆盖主/快速/流式；
    // 与 `tokenBudget`（按会话/循环的水位预算）用途不同、各自记账。
    getDailyBudget().settleFor(sessionId, totalTokens);

    // X8（2026-09-23，Spec §5.5）：**主会话**用量入账到该会话的未终结目标。
    // **记账与判定解耦**：此处只 fire-and-forget 写库（不 await ⇒ 不改本方法同步签名、
    // 不阻塞响应）；"触顶 ⇒ 下一轮请求前 steering 收尾"的判定在既有闸门
    // （`ReActToolLoop.beforeReasoning` 的 `checkBeforeRequest` 处）读库进行 ——
    // 不在记账处主动发起/唤醒任何请求。
    // 与 swarm 批次路径（`settleGoalForRun` 记 worker 汇总用量）**不同源、不重复计数**。
    // 无目标会话 ⇒ `chargeSessionGoalUsage` 立即返回 null（不建行、不写库）。
    void chargeSessionGoalUsage({
      sessionId,
      tokens: totalTokens,
    }).catch((err) => {
      // @ignore-catch — 目标用量入账属观测/意图面，失败不得影响用量记账与主流程（CS03）
      logger.warn('目标用量入账失败（不影响用量记账与主流程）', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // TR-12-A（2026-09-22）：请求级用量分桶落事件（含缓存命中/写入，供轨迹"用量"视图）。
    // 本方法是**同步**签名（由管线 ctx 注入调用），故不 await；`appendStreamEvent` 自带
    // try/catch 并返回 `{ok,reason}`，失败只记日志 —— 该事件是**可观测数据**，不是渲染依赖，
    // 不能因其失败影响用量记账与主流程。
    const timingData = buildRequestTimingData(usage);
    if (timingData) {
      // 债四「换算接线」（2026-10-13）：**金额**台账（`usedUsd`）与 token 口径**并行**。
      // 四参**复用 `timingData`**（缓存字段的唯一提取点 `extractCacheTokens`，CS01 不另造一份）；
      // 模型不可得 ⇒ 内部跳过并如实 warn（**不臆造金额**）。
      // ⚠️ **不改闸门**：`usedUsd` 当前不参与任何拦截/档位判定（USD 闸门 = S3，待 U3 裁定）。
      recordTurnCostUsd(
        {
          inputTokens: timingData.inputTokens ?? 0,
          outputTokens: timingData.outputTokens ?? 0,
          cacheCreationTokens: timingData.cacheCreationTokens,
          cacheReadTokens: timingData.cacheReadTokens,
        },
        model,
        sessionId
      );
      // D1（2026-09-23）：**同一份载荷**先喂入校准闭环 —— 校准的数据源即
      // `metric/timing` 事件的用量字段（唯一构造点 `buildRequestTimingData`），
      // 不再依赖 `traces/` 落盘数据（已降级为观测层）。复用既有"调用方直接喂入"通路。
      this.unifiedTracker.recordTimingUsage(timingData);
      // P2-2：请求边界配对键（与延迟条共享同一 requestId ⇒ 读端归并为一个请求区间）
      if (requestId !== undefined) timingData.requestId = requestId;
      void this.appendStreamEvent(sessionId, {
        type: 'metric/timing',
        seq: 0, // 由 append 在 mutex 内原子分配（P3-7a）
        time: Date.now(),
        sessionId,
        data: timingData,
      });
    }
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
   * C 阶段（2026-09-02，P1，C 详设 §4）：session_lookup — 按事件区间取回被切早期原文。
   * 分页（每页 ≤2K tokens，nextFromSeq 续页），只读，仅限当前会话。
   */
  static readonly SESSION_LOOKUP_TOOL: ToolDefinition = {
    type: 'function',
    function: {
      name: 'session_lookup',
      description:
        '取回当前会话中较早的原始对话记录（当上下文压缩/分层未携带早期内容时使用）。支持按事件序号（fromSeq）或从会话开头（offset）分页取回，每页约 2000 tokens；返回的 nextFromSeq 可继续翻页直到取完。',
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: '当前会话 id' },
          fromSeq: {
            type: 'number',
            description:
              '起始事件序号（上一页返回的 nextFromSeq）。不传则从会话开头或按 offset 定位。',
          },
          toSeq: {
            type: 'number',
            description: '可选，截止事件序号（默认取至一页容量）。',
          },
          offset: {
            type: 'number',
            description:
              '可选，从会话开头跳过的事件条数（与 fromSeq 二选一，用于从头翻页）。',
          },
          limit: {
            type: 'number',
            description:
              '可选，本页最大事件条数（默认按 token 预算自动折算）。',
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
  private async _buildApiMessagesForStream(
    messages: Message[],
    maxContextTokens?: number,
    outputBudgetTokens?: number
  ): Promise<Array<Record<string, unknown>>> {
    return this._streamMessageLifecycle.buildApiMessagesForStream(
      messages,
      maxContextTokens,
      outputBudgetTokens
    );
  } /** U-22/S2 外移：流式请求准备段（实现在 `manager/streamSetup.ts`，顺序/日志/异常不变） */
  private async _prepareStreamSession(
    content: string,
    options?: StreamMessageOptions
  ): Promise<StreamSetupResult> {
    return this._streamSetup.prepare(content, options);
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
      recordChatResponseUsage: (sid, usage, requestId, model) =>
        this.recordChatResponseUsage(
          sid,
          usage as Record<string, number>,
          requestId,
          model
        ),
      extractMemoryFromChat: (userMsg, aiMsg, sid) =>
        this.extractMemoryFromChat(userMsg, aiMsg, sid),
      messageService: this.messageService as PipelineContext['messageService'],
      apiMessages: [],
      toolDefinitions: [],
      accumulatedContent: '',
      finalResponse: null,
    };
    return new StreamPipeline(ctx);
  }  /**
   * P2-3.5: 流式消息最终化 — 清理资源 + 持久化 + 构建返回消息
   *
   * U-22/S4：方法体已外移到 `manager/streamFinalize.ts`（`ChatStreamFinalize`），此处仅薄转发。
   */
  private async _finalizeStreamMessage(
    session: ChatSession,
    content: string,
    accumulatedContent: string,
    assistantMessage: Message,
    finalResponse: ChatResponse | null,
    streamAbortController: AbortController,
    streamSpan: ReturnType<ReturnType<typeof getOTelTracing>['startSpan']>,
    options?: StreamMessageOptions,
    /** TB-16（2026-09-24）：主循环终止判定（写入 `turn/end.terminationReason`） */
    terminationReason?: string
  ): Promise<Message> {
    return this._streamFinalize.finalize(
      session,
      content,
      accumulatedContent,
      assistantMessage,
      finalResponse,
      streamAbortController,
      streamSpan,
      options,
      terminationReason
    );
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
   * 最近 N 条 user 消息文本（换行拼接）—— 裸会话升级判定**共用**的取数口径。
   *
   * P0-1（2026-09-06）：任务轮内模型可能 `ask_user_question` 澄清，澄清答复会占住"最后一条
   * user"位置使任务原句被覆盖 ⇒ 聚合最近 3 条（原实现内联于此，2026-09-25 抽出供
   * "执行意图"与"运行中长任务信号"两个触发方共用 —— CS01）。
   */
  private _recentUserText(session: ChatSession, n = 3): string {
    const userMessages =
      session.messages?.filter((m) => m.role === 'user') ?? [];
    return userMessages
      .slice(-n)
      .map((m) => {
        const c = (m as unknown as Record<string, unknown>)?.content;
        return typeof c === 'string' ? c : '';
      })
      .join('\n');
  }

  /** 最近一条 assistant 消息的文本（升级动作需要 content；无则空串 —— 工具型收尾常为空） */
  private _lastAssistantText(session: ChatSession): string {
    const messages = session.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i] as unknown as { role?: string; content?: unknown };
      if (m?.role === 'assistant' && typeof m.content === 'string') {
        return m.content;
      }
    }
    return '';
  } /** 裸会话 ⇒ PDCA 编排升级（U-22/S1 外移；单一动作入口，实现在 `manager/pdcaLaunch.ts`） */
  private async _escalateToPdcaViaBareSession(params: {
    session: ChatSession;
    assistantContent: string;
    lastUserContent: string;
  }): Promise<void> {
    return this._pdcaLaunch.escalateViaBareSession(params);
  } /** D3：运行中长任务信号 ⇒ 升级入口（U-22/S1 外移；闸门与动作见 `manager/pdcaLaunch.ts`） */
  async onLongTaskSignal(
    session: ChatSession,
    fact: { pendingTodoCount: number; consumedTurns: number }
  ): Promise<void> {
    return this._pdcaLaunch.onLongTaskSignal(session, fact);
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
  } /** P0-1：PDCA launch 统一出口（U-22/S1 外移；锁/trace/双路径语义见 `manager/pdcaLaunch.ts`） */
  private _maybeLaunchPdca(
    session: ChatSession,
    assistantContent: string,
    projectId: string,
    lastUserContent: string | undefined
  ): void {
    this._pdcaLaunch.maybeLaunch(
      session,
      assistantContent,
      projectId,
      lastUserContent
    );
  }

  /**
   * P1-3（2026-09-26）：doc_pipeline 四阶段进度 → 聊天正文内嵌卡片。
   *
   * 把逐阶段进度以 assistant/doc_workflow 富块事件持久化，经 EventMessageDeriver
   * 派生为当前 assistant 消息的 doc_workflow 块（前端 DocWorkflowProgress 渲染
   * 三阶段进度条）。与 _persistPdcaSnapshot 同法：seq 由 tailSeq 分配、写入走
   * **唯一入口** appendStreamEvent（不绕过事件写入链路与 seq 分配）。
   *
   * 调用方：office:doc-pipeline 工具在 seam 的 onProgress 回调中调用。
   * 落盘失败不抛错（appendStreamEvent 内部已 try/catch，CS03）⇒ 不阻断流水线。
   */
  async persistDocWorkflowProgress(
    sessionId: string,
    data: LiriEventData<'assistant/doc_workflow'>
  ): Promise<void> {
    const ts = await this.getStreamTailSeq(sessionId);
    await this.appendStreamEvent(sessionId, {
      type: 'assistant/doc_workflow',
      seq: ts + 1,
      time: Date.now(),
      sessionId,
      data,
    });
  } /** P0: 自动建项目（U-22/S1 外移；实现在 `manager/pdcaLaunch.ts`，行为/返回值不变） */
  private async _autoCreateProject(
    session: ChatSession,
    workspaceId: string | undefined,
    result: { hasGoal: boolean; deliverables: number; goalSummary?: string }
  ): Promise<string | null> {
    return this._pdcaLaunch.autoCreateProject(session, workspaceId, result);
  }

  /** 阶段 A（A1-e）：yield 恢复器是否已装配（懒装配幂等守卫） */
  private _yieldResumerInstalled = false;

  /**
   * 阶段 A（A1-e）/ B1-O1-1：恢复器卸载函数。
   *
   * 必须接收并保存：否则实例重建后**旧 listener 闭包仍持有旧实例**
   * （结算信号会唤醒旧实例），且监听器数组只增不减。
   */
  private _yieldResumerUninstall: (() => void) | null = null;

  /**
   * Task 7：预算挂起唤醒端口是否已装配（幂等守卫）。
   *
   * Fix round 2：装配改为**惰性**（入口 `sendMessage` / `streamMessage`），故本守卫同时承担
   * 「至多装一次」与「`cleanup()` 只摘除自有装配」两职 —— 未装配的实例不覆盖/不清除他人 handler。
   */
  private _budgetSuspendResumeWired = false;

  /** Task 7：预算放行监听解绑函数（`cleanup` 卸载，防实例重建后闭包累积）。 */
  private _budgetReliefUninstall: (() => void) | null = null;

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
    // 阶段 A（A1-e）：懒装配 yield 恢复器（子代理结算 → 恢复父会话）
    this._ensureYieldResumerInstalled();
    // Fix round 2（2026-10-12）：惰性装配预算挂起唤醒端口（同 yield 恢复器；构造期不再装配）。
    this._ensureBudgetSuspendResumeInstalled();
    return yield* this.chatOrchestrator.streamMessage(content, options);
  }

  /**
   * A4b 拆分：启动期恢复装配已迁至 `ChatRecovery.bootstrapYieldRecovery`（薄转发）。
   * 顺序（等待集重建 → 装配恢复器）与出参不变；由 `main.ts` 的启动序列调用。
   */
  async bootstrapYieldRecovery(options?: {
    registry?: YieldRegistry;
    store?: YieldWaitingStore;
    outbox?: SettlementOutbox;
  }): Promise<YieldRecoveryStats> {
    return this._recovery.bootstrapYieldRecovery(options);
  }

  /**
   * A4b 拆分：恢复编排入口已迁至 `ChatRecovery.bootstrapRecovery`（薄转发）。
   * 顺序（`sessionCrash → [sessionState] → yieldRecovery → lineage`）与报告不变。
   */
  async bootstrapRecovery(opts?: {
    rebuildState?: boolean;
  }): Promise<RecoveryReport> {
    return this._recovery.bootstrapRecovery(opts);
  }

  /**
   * A4b 拆分：装配 yield 恢复器（幂等）已迁至 `ChatRecovery.ensureYieldResumerInstalled`（薄转发）。
   * 两个恢复器字段 `_yieldResumerInstalled` / `_yieldResumerUninstall` 仍归宿主（`cleanup()` 直接读写）。
   */
  private _ensureYieldResumerInstalled(outbox?: SettlementOutbox): void {
    this._recovery.ensureYieldResumerInstalled(outbox);
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

    // E2E-1 根因修复（2026-10-12）：**互斥锁的释放必须覆盖 `acquire` 之后的全部出口**。
    // 修复前本方法只有工具循环那一段的 `try/finally` 在 release，而其**之前**的两个执行出口
    // —— `StreamingAutoCheckpoint.restore()` 抛错、以及「无可用检查点 ⇒ yield error + return」
    // ——都落在该 `finally` **之外** ⇒ 锁永久泄漏。（`resumeSession` 那段自带 try/catch，
    // 不构成第三个出口。）
    // 后果（真实 E2E 实证）：`getHeldDurationMs() > 0` 使该会话被 `ChatOrchestrator.sendMessage`
    // 的在飞守卫（`上一条回复仍在生成中…`，`ChatOrchestrator.ts:681-686`）**永久**判为"生成中"：
    // 预算挂起唤醒的「重发一轮」被挡下（`resumeSuspendedSession: 流式重发失败`），再次唤醒则
    // `SimpleMutex: acquire timeout after 30000ms`。故把 `try` 前移到 `acquire` 之后，
    // **release 仍只有最外层这一处**（唯一释放点，避免双重 release 清零他人持有的锁）。
    try {
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

      let restoreResult: Awaited<
        ReturnType<StreamingAutoCheckpoint['restore']>
      >;
      try {
        restoreResult = await streamingCheckpoint.restore();
      } catch (err) {
        // BUG-1 修复：此处不再 release（由最外层 finally 统一释放一次，
        // 避免双重 release 清零他人持有的锁）。
        throw err;
      }
      if (!restoreResult) {
        // M2-T2.1（2026-08-31）：无自动检查点 → 从 events.jsonl 尾部重建未完成 turn。
        // 对齐 openworker _unanswered_trailing_tool_calls：重启/引擎不可用后，
        // 已答工具（有 result/canceled 终态）跳过、未答工具重放，不重复执行。
        restoreResult =
          await this._recovery.rebuildTrailingTurnFromEvents(sessionId);
      }
      if (!restoreResult) {
        yield {
          type: 'error',
          content: '无可用检查点，无法恢复',
          sessionId,
        } as ChatStreamChunk;
        return null as unknown as Message;
      }

      const { checkpoint, stepIndex, completedToolCallIds, generatorState } =
        restoreResult;

      // BUG-A2 修复（2026-08-26）：恢复后同步检查点节奏——新实例 stepIndex=0
      // 会导致恢复后的全量/delta 检查点时间错位
      streamingCheckpoint.restoreStepIndex(stepIndex);

      // 1. 恢复会话状态
      const session = await this.sessionLifecycle.getOrLoadSession(sessionId);
      session.messages = checkpoint.messages;

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
        // BUG-1 修复：此处不再 release（由最外层 finally 统一释放一次）
        yield {
          type: 'status',
          statusType: 'task_all_done',
          content: '任务已全部完成',
          sessionId,
        } as ChatStreamChunk;
        return session.messages[session.messages.length - 1] || ({} as Message);
      }

      // 4. 获取工具定义
      const activeClient = this.getLLMClient();
      const toolDefinitions: ToolDefinition[] = this.toolRegistry
        ? this._buildToolDefinitions(this.toolRegistry.getToolSchemas())
        : [];
      // TR-12-B（2026-09-22）：本轮工具清单落事件（引用式去重）——§1.6 红线
      if (this.toolRegistry && toolDefinitions.length > 0) {
        this._recordToolsSnapshot(
          sessionId,
          this.toolRegistry.getToolSchemas()
        );
      }

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

      // 断线恢复动态上限（2026-09-01）：剩余工具数决定所需轮次，避免恢复的
      // 长任务在基础阈值（30 轮）内被误杀。历史轮次 + 剩余工具 + 5 轮余量。
      const toolTurnCount = generatorState.toolTurnCount;
      const MAX_TOOL_TURNS = Math.max(
        this.MAX_TOOL_TURNS,
        toolTurnCount + remainingToolCalls.length + 5
      );

      // 5. 工具执行循环（轻量模式收敛 2026-09-01：复用 ReActToolLoop，经统一工厂。
      //    对齐 ReActToolLoop.reason 首轮"直接执行剩余工具"语义（needsInitialLlmCall=false），
      //    消除手写循环（原三轨之一）。恢复场景简化语义保持：不启用审批/心跳。
      const apiMessages = session.messages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.metadata?.tool_calls
          ? { tool_calls: m.metadata.tool_calls }
          : {}),
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      }));

      const { toolResultRegistry } =
        await import('../tool/ToolResultRegistry.js');
      const toolLoopCtx = {
        session,
        options: {},
        abortSignal: streamAbortController.signal,
        executeTool: (tc: ParsedToolCall, opts: unknown) =>
          this.executeTool(
            { id: tc.id, name: tc.name, arguments: tc.arguments, sessionId },
            opts as {
              useErrorHandler?: boolean;
              onProgress?: (progress: {
                toolUseID: string;
                data: Record<string, unknown>;
              }) => void;
            }
          ),
        pendingInteractions: this._pendingInteractions,
        loopDetector: this._loopDetector,
        messageService: this.messageService,
        addAndPersistMessage: (sid: string, msg: Message) =>
          this._addAndPersistMessage(sid, msg),
        checkpointService: this._checkpointService,
        // Task 5 Fix round 1：端口装配已**收敛到 `buildToolLoopContext` 内**（含必填 `suspend`）⇒
        // 此处传裸检查点；「恢复路径漏接 suspend ⇒ 幽灵挂起」由该收敛点统一兜住。
        streamingCheckpoint,
        activeClient,
        unifiedTracker: this.unifiedTracker,
        recordChatResponseUsage: (
          sid: string,
          usage: Record<string, number>,
          requestId?: number,
          model?: string
        ) => this.recordChatResponseUsage(sid, usage, requestId, model),
        toolResultRegistry,
        toolRegistry: this.getToolRegistry(),
        toolDefinitions,
        buildToolRoundMessages: (
          msgs: unknown,
          am: Message,
          tcs: unknown,
          prs: unknown
        ) =>
          this._buildToolRoundMessages(
            msgs as Record<string, unknown>[],
            am,
            tcs as ParsedToolCall[],
            prs as Array<{
              normalizedToolCall: ParsedToolCall;
              result: ToolResult;
            }>
          ),
        maxToolTurns: this.MAX_TOOL_TURNS,
        estimateMessagesTokens,
      } as unknown as import('./ToolLoopRunner.js').ToolLoopContext;

      const { createChatAgentLoop } = await import('./createAgentLoop.js');
      const { reactEventsToChunks } = await import('./reactEventsToChunks.js');
      // 空 assistant 消息占位：ReActToolLoop 首轮直接执行剩余工具，工具轮内自行构建
      // assistant 消息（含叙述/达上限提示），input.assistantMessage 仅作 finalize 兜底 base
      const resumeAssistantMsg = this.messageService.createAssistantMessage(
        '',
        {
          sessionId,
        }
      );
      const loop = createChatAgentLoop({
        mode: 'stream',
        ctx: toolLoopCtx,
        input: {
          apiMessages,
          currentToolCalls: remainingToolCalls,
          assistantMessage: resumeAssistantMsg,
          needsInitialLlmCall: false, // 首轮直接执行剩余工具（恢复语义）
        },
        config: { maxIterations: MAX_TOOL_TURNS },
      });

      // 消费 ReActEvent 流 → ChatStreamChunk（含文本增量 reasoning_delta → text chunk）
      let loopMessage: Message | null = null;
      const loopIter = loop.run({
        apiMessages,
        currentToolCalls: remainingToolCalls,
        assistantMessage: resumeAssistantMsg,
      });
      let loopStep = await loopIter.next();
      while (!loopStep.done) {
        for (const chunk of reactEventsToChunks(loopStep.value, sessionId)) {
          yield chunk;
        }
        loopStep = await loopIter.next();
      }
      loopMessage = loopStep.value; // ReActToolLoop.run 返回值（finalize 的 Message）

      // 6. 清理
      this._sessionAbortControllers.delete(sessionId);

      // ReActToolLoop 已通过 finalize 构建 assistant 消息（含工具轮叙述/达上限提示）；
      // 异常时回退手写构建（CS03）
      const assistantMessage =
        loopMessage ??
        this.messageService.createAssistantMessage(
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
  // A2 拆分：交互解析已迁至 `ChatRollback.resolveInteraction`（薄转发）
  async resolveInteraction(
    questionId: string,
    answers: string[],
    sessionId?: string
  ): Promise<boolean> {
    return this._rollback.resolveInteraction(questionId, answers, sessionId);
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
    await this._rollback.startRollbackRound(sessionId, roundId);
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
    await this._rollback.endRollbackRound(
      sessionId,
      messageSummary,
      assistantContent
    );
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
    return this._rollback.undoRoundsSince(
      sessionId,
      sinceRoundId,
      maxRound,
      roundIndex
    );
  }

  /**
   * P1-2: 构建工具轮次的 LLM 请求消息（已随 A5a 拆入 `ChatStreamMessageLifecycle`）
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
    return this._streamMessageLifecycle.buildToolRoundMessages(
      currentMessages,
      currentAssistantMsg,
      currentToolCalls,
      processedResults
    );
  }

  /**
   * 执行工具
   * @param toolCall 工具调用
   * @returns 工具结果
   */
  async executeTool(
    toolCall: ToolCall,
    // 2026-08-24 进度链路打通：透传 onProgress（工具细粒度进度回调）
    opts?: {
      useErrorHandler?: boolean;
      onProgress?: (progress: {
        toolUseID: string;
        data: Record<string, unknown>;
      }) => void;
    }
  ): Promise<ToolResult> {
    // 更新动态依赖
    const svc = this._toolExecutionService!;
    svc.deps.currentSessionId = this._currentSessionId ?? '';

    // B-05（2026-10-09，第九轮审查 §十五）：**逐工具前置记账（fail-closed）**。
    //
    // `executionId` 由入口下传（Router → `ChatRequest.executionId` → `StreamMessageOptions`
    // → `_sessionExecutionIds`）。本层是工具**执行者**收口点 ⇒ 能做到**精确到单个工具**的拒绝
    // （优于 Router 层的"整执行中止"）。
    // 落盘失败 ⇒ 无法证明"副作用发生前已记账"（R3 的 `unknown` 恢复依赖该记录）⇒ **不执行该工具**。
    const executionId = this._sessionExecutionIds.get(
      this._currentSessionId ?? ''
    );
    if (executionId) {
      const { getExecutionManager } = await import('@modules/execution');
      type ExecId = Parameters<
        ReturnType<typeof getExecutionManager>['beginToolCall']
      >[0];
      const mgr = getExecutionManager();
      const ok = await mgr.beginToolCall(
        executionId as ExecId,
        toolCall.id,
        toolCall.name
      );
      if (!ok) {
        logger.error('工具调用记账落盘失败 ⇒ 拒绝执行该工具（fail-closed）', {
          sessionId: this._currentSessionId,
          executionId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: `工具调用记账落盘失败 ⇒ 已拒绝执行（fail-closed，executionId=${executionId}）`,
        };
      }
      const result = await svc.execute(toolCall, opts);
      // 结算（观测面；DB `tool_calls` 幂等 ⇒ 与任何其它观测者不冲突）
      // G17（2026-10-11，S1-4）：改**可等待**结算（`endToolCall`）—— 保证工具返回前结算已
      // 落盘/已尝试，消除"返回后仍在写"的观测窗口；失败仅留痕（不升级为工具失败）。
      await mgr.endToolCall(
        executionId as ExecId,
        toolCall.id,
        toolCall.name,
        result.error ? 'failed' : 'completed',
        result.error ?? undefined
      );
      return result;
    }

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
    approvalReason?: string,
    /** S1-1：工具声明的执行作用域（cwd/env 摘要/平台）——随卡片记录，执行时须一致 */
    approvalScope?: ApprovalScope,
    /** S1-1：审批快照（原始 / 规范化 / 改写项）——随卡片记录，供审批与执行对账 */
    approvalSnapshot?: ApprovalSnapshot
  ): Promise<boolean> {
    try {
      const { inboxManager } = await import('@modules/runtime/InboxManager.js');
      // P0-2: 统一 hashCommandForExecution，与执行端 BashTool hash 一致
      const { hashCommandForExecution, toolCallApprovalKey } =
        await import('@modules/permission');
      const command = typeof input.command === 'string' ? input.command : '';
      // N1：非命令类工具（media:delete 等）改用工具调用键（toolName:稳定JSON）作为放行
      // 哈希——审批后 LLM 重发时工具内 isToolCallApproved 命中才真正执行；bash 类工具
      // toolCallApprovalKey 返回 command 原值，哈希与既有命令级审批完全一致（零行为变化）。
      const approvalKey = toolCallApprovalKey(toolName, input);
      const commandHash = hashCommandForExecution(approvalKey);
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
            // S1-1: 携带执行作用域 —— inbox 批准时写入放行缓存，执行端作用域不一致即不命中
            approvalScope: approvalScope ?? undefined,
            // S1-1: 携带审批快照 —— 批准时一并记录（原始命令 / 规范化命令 / 改写项）
            approvalSnapshot: approvalSnapshot ?? undefined,
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

  /**
   * D3（2026-08-24）：事件级 fork——从源会话任意历史 seq fork 出子会话
   * 委托 SessionGateway.forkSession（血缘注入 + 前缀事件复制）
   *
   * 2026-10-16：`truncateBeforeMessageId` = 「编辑并另存为分支」只保留编辑点之前的历史
   *（边界由网关在源会话事件上解析；解析出的 0 表示该消息之前无历史 ⇒ 零种子分支）。
   */
  async forkSession(
    sourceId: string,
    options: Parameters<SessionGateway['forkSession']>[1] = {}
  ): ReturnType<SessionGateway['forkSession']> {
    return this.sessionGateway.forkSession(sourceId, options);
  }

  async switchSession(sessionId: string): Promise<void> {
    // D2（2026-09-22）：切换即"用户意图转移" ⇒ 释放**非当前会话**的事件快照常驻内存
    // （先 flush 各会话的缓冲正文再释放，见 `_releaseEventLogMemory`）。
    // 放在委托之前：切换后若原会话仍有后台追加，其写入路径不依赖快照（会回落磁盘路径）。
    await this._releaseInactiveEventLogSnapshots(sessionId);
    return this.sessionLifecycle.switchSession(sessionId);
  }

  getCurrentSession(): ChatSession | undefined {
    return this.sessionLifecycle.getCurrentSession();
  }

  getSessions(): ChatSession[] {
    return this.sessionLifecycle.getSessions();
  }

  async deleteSession(sessionId: string): Promise<void> {
    // I1：注销进程级注册表登记（本会话已不存在）——置于拆除**第一步**，与拆除结果解耦
    // （拆除实现即使抛错，注册表也已回收，不留僵尸 TAORLoop）。
    this._unregisterTaorLoop(sessionId);
    await this._sessionTeardown.deleteSession(sessionId);
  }

  async clearAllSessions(moduleType?: string): Promise<void> {
    // I1：批量清空 ⇒ 注销本实例登记过的全部会话（按 moduleType 过滤的语义由拆除实现承担；
    // 此处只回收进程级注册表，避免其无界增长）。
    this._unregisterAllTaorLoops();
    await this._sessionTeardown.clearAllSessions(moduleType);
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
        this.toolRegistry as unknown as import('@modules/ai').ToolRegistry,
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
  ): Promise<import('@modules/session/types/checkpoint').SessionCheckpoint[]> {
    return this.resumeCoordinator.listCheckpoints(sessionId);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<{
    session: ChatSession;
    diff: import('@modules/session/types/checkpoint').CheckpointDiff;
  }> {
    return this.resumeCoordinator.rollbackToCheckpoint(checkpointId);
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    return this.resumeCoordinator.deleteCheckpoint(checkpointId);
  }

  async getLatestCheckpoint(
    sessionId: string
  ): Promise<
    import('@modules/session/types/checkpoint').SessionCheckpoint | null
  > {
    return this.resumeCoordinator.getLatestCheckpoint(sessionId);
  }
}

/**
 * 优雅退出钩子注册表（2026-09-02 排查"会话中断"补充）。
 * ChatManagerImpl 构造时注册"全会话 text-batch 缓冲 flush"；main.ts 信号链
 * （SIGTERM/SIGINT）在退出前调用 flushAllEventBuffers()，把流式缓冲正文落盘，
 * 避免进程被 watch 重启/Ctrl+C 终止时留下 torn-tail / open-turn。
 * 模块级数组 + 函数声明（hoisted），重复构造仅追加 no-op 闭包，幂等。
 */
const eventBufferFlushers: Array<() => Promise<number>> = [];

/** 注册一个退出前 flush 钩子（返回注册条数，便于日志） */
export function registerEventBufferFlusher(fn: () => Promise<number>): void {
  eventBufferFlushers.push(fn);
}

/** 退出前 flush 全部已注册会话的事件缓冲（逐条容错，返回总 flush chunk 数） */
export async function flushAllEventBuffers(): Promise<number> {
  let total = 0;
  await Promise.all(
    eventBufferFlushers.map((fn) =>
      fn()
        .then((n) => {
          total += n;
        })
        .catch(() => {
          // @ignore-catch — 单条 flush 失败不阻断退出链（CS03）
        })
    )
  );
  return total;
}

/**
 * M4（2026-09-17）：优雅退出前为可中断会话写 cleanShutdown 标记的钩子注册表
 * （镜像 eventBufferFlushers 模式，幂等；main 信号链调用 markSessionsCleanShutdown）。
 */
const cleanShutdownHandlers: Array<() => Promise<void>> = [];

/** 注册一个退出前 cleanShutdown 标记钩子 */
export function registerCleanShutdownHandler(fn: () => Promise<void>): void {
  cleanShutdownHandlers.push(fn);
}

/** 退出前标记全部可中断会话为优雅关闭（逐条容错，不阻断退出链） */
export async function markSessionsCleanShutdown(): Promise<void> {
  await Promise.all(
    cleanShutdownHandlers.map((fn) =>
      fn().catch(() => {
        // @ignore-catch — 单条标记失败不阻断退出链（CS03）
      })
    )
  );
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
