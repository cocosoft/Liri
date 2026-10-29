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
  getLocalSession,
  getOrCreateSessionMachine,
} from './services/ChatHelper';
import { ChatEventLogStore } from './manager/eventLogStore';
import { ChatRequestPrep } from './manager/requestPrep';
import { ChatRollback } from './manager/rollback';
import type { PendingInteractionEntry } from '@modules/utils/pendingInteractions';
// S1（2026-10-19）：会话级缓存统一 dispose 契约（会话 → 键集合）
import { SessionScopedRegistry } from '@modules/utils/SessionScopedRegistry';
import { ChatPromptAssembly } from './manager/promptAssembly';
import { ChatBootstrap } from './manager/bootstrap';
import { ChatStreamMessageLifecycle } from './pipeline/streamMessageLifecycle';
import { ChatSessionTeardown } from './manager/sessionTeardown';
import { ChatRecovery } from './manager/recovery';
// U4 历史会话补评（2026-10-06）：磁盘会话的"最近更新优先"排序（纯函数）
import { rankRecentSessionIds } from './quality/sessionScan';
import {
  EventLogStorage,
  type EventLogQuery,
  type RecoveryReport,
  type YieldRecoveryStats,
} from '@modules/session';
// D 阶段（2026-09-02，v5 P0-⑥）：跨会话记忆适配器——静态导入保证模块加载即触发
// session_summary 类型注册（注册动作已随 Cut C（issue #8）迁入 `manager/hostWiring.ts`）
import { rollupSessionSummaryToLongTerm } from '@modules/memory';
import type { LiriEvent, LiriEventData } from '@modules/session/types/events';
import { feature as coreFeature } from '@openliri/kernel';
import { StreamingToolCallScrubber } from '@modules/streaming';
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
// BUG-A（2026-10-27）：空输出兜底的**结构化**判定（禁止文案匹配 —— CS02）
import { isEmptyOutputFallbackMessage } from './terminationOutput';
// U-22/S2：流式请求准备段外移（输入净化 → 取会话 → abort/锁 → 用户消息落盘）
import { ChatStreamSetup } from './manager/streamSetup';
// U-22/S3：消息持久化 / 事件投影簇外移
import { ChatMessagePersistence } from './manager/messagePersistence';
// U-22/S4：流式消息收尾簇外移（`_finalizeStreamMessage` 的实现，见 `manager/streamFinalize.ts`）
import { ChatStreamFinalize } from './manager/streamFinalize';
// U-22/S4：断点续跑外移（`resumeStream` 的实现，见 `manager/streamResume.ts`）
import { ChatStreamResume } from './manager/streamResume';
import { ChatOrchestrator } from './orchestrator/ChatOrchestrator.js';
// issue #8 · Cut C（2026-10-29）：用量记账（R16 日预算结算 / 债四金额台账 / `metric/timing`）
// 已外移到 `manager/usageAccounting.ts`；本类保留同名 thin delegate。
import { recordChatResponseUsage as recordChatResponseUsageImpl } from './manager/usageAccounting';

const logger = getLogger('chat:manager');

import { SimpleMutex, feature } from '@openliri/kernel';
import { resolveWorktreeHash } from '@modules/environment';
// 多租户 P0 阶段 2：当前会话 id 按请求身份分桶（无请求作用域 ⇒ 本地身份单桶）
import { getRequestPrincipalKey } from '@openliri/kernel/identity/requestScope.js';
import { join } from 'path';
import { getModelPricing } from '@modules/cost';

import { calculateTotalCost } from '@modules/cost';

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
} from '@modules/session/types/message.js';
import { createSystemMessage } from '@modules/session/types/message.js';
import type {
  ChatSession,
  CreateSessionParams,
} from '@modules/session/types/session.js';
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
import { PlainTextCheckpoint } from './services/PlainTextCheckpoint.js';
import { isCheckpointLogEnabled } from '@modules/config';
import { HookChainManager } from '@modules/hooks';
import { toolResultRegistry } from '../tool/ToolResultRegistry.js';
import { ToolAwareClient } from '@modules/ai';
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
import type { ToolRegistry } from '@modules/tools';
// issue #8 · Cut A（2026-10-29）：检查点边界判定 + 预算挂起/放行装配外移
import {
  ensureCheckpointBoundary,
  installBudgetSuspendResume,
} from './manager/checkpointBudget';
// issue #8 · Cut C（2026-10-29）：宿主级 sink / 退出钩子 / 内存水位装配外移
import { installHostWiring } from './manager/hostWiring';
// issue #8 · Cut C（2026-10-29）：`ChatOrchestrator` 宿主端口字面量外移
import {
  createOrchestratorHost,
  type OrchestratorWiringHost,
} from './manager/orchestratorHost';
// issue #8 · Cut C（2026-10-29）：子门面/服务装配外移
import { wireChatFacades, type FacadeWiringHost } from './manager/facadeWiring';
// issue #16（2026-10-29）：装配宿主的**单点断言**（契约由各模块键表 + 存在性守卫兑现）
import { asWiringHost } from './manager/wiringHostGuard';
// issue #19 · Cut G（2026-10-29）：宿主清理外移（顺序/纪律不变）
import { cleanupHost } from './manager/shutdown';
// issue #19 · Cut H（2026-10-29）：计划步骤单步执行外移
import { executeStepPrompt } from './manager/stepExecution';
// issue #19 · Cut H（2026-10-29）：会话流中止判定外移（契约方法保留）
import { abortSessionStream as abortSessionStreamImpl } from './manager/streamAbort';
// issue #17 · D2 / D3（2026-10-29）：对话记忆抽取、按模型名选客户端外移
import { extractMemoryFromChat as extractMemoryFromChatImpl } from './manager/memoryExtract';
import { getClientForModel as getClientForModelImpl } from './manager/modelClient';
// issue #17 · D4 / D5（2026-10-29）：会话管理器视图、待对账会话消费外移
import { createSessionManagerFacade } from './manager/sessionManagerFacade';
import { runPendingReconciles } from './manager/reconcileDrain';
// issue #17 · D6 / D7（2026-10-29）：项目 sandboxPath 解析、verifier 模型解析外移
import {
  getProjectSandboxPath,
  type ProjectStoreLike,
} from './manager/projectSandboxPath';
import {
  ensureVerifierCallModel,
  type VerifierModelState,
} from './manager/verifierModel';
// issue #17 · D9 / D10（2026-10-29）：TAOR 上下文与流式管线工厂的端口装配外移
import { createStreamPipelineFor } from './manager/streamPipelineFactory';
import type {
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
// issue #8 · Cut B（2026-10-29）：预算挂起后的续跑编排外移（含未完成工具的幂等性分流）
import {
  resumeSuspendedSession as resumeSuspendedSessionImpl,
  type BudgetResumeDeps,
} from './manager/budgetResume';
// 13-P2-1（2026-10-05）：输出侧统一护栏组合根注册（默认关 ⇒ 空注册）
import { registerDefaultOutputGuards } from './outputGuards/index.js';
import { compactionOrchestrator } from '@modules/context';
import { FileCheckpointStorage } from '@modules/session';
import {
  StopHookManager,
  createStopHookManager,
  DEFAULT_STOP_HOOK_PRIORITIES,
} from '@modules/query';
import type { StopHookReason } from '@modules/query';
import { TAORLoop } from '@modules/query';
import { createChatAgentLoop } from './createAgentLoop.js';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { YieldRegistry, YieldWaitingStore } from '../session/yield';
// B1-4 验收缝：仅用于类型标注（启动钩子的可注入实例）
import type { SettlementOutbox } from './yield/SettlementOutbox';
// F2（2026-10-12，预算挂起续跑 Task 3）：活跃 TAORLoop 注册表入口（经 infrastructure barrel）。
// 修复前 `registerTAORLoop` 全仓零调用 ⇒ `activeLoops` 恒空 ⇒ checkpoint 恢复端点恒 404。
import { registerTAORLoop, unregisterTAORLoop } from '@modules/infrastructure';
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
import { LoopDetector } from '@modules/query';
import { agentTelemetry } from '@modules/agent';
import { ErrorHandler } from '@openliri/kernel';
import { convergenceDetector } from './services/ConvergenceDetector.js';
import {
  CompactServiceImpl,
  type CompactBoundary,
  type CompactArtifact,
} from '@modules/compaction';
import type { SessionMessage } from '@modules/session';
import { SessionGateway, createSessionGateway } from '@modules/session';
// LRO-06 / D4 后半（2026-10-26）：会话工作区解析（绝对 workspacePath > 项目 sandboxPath）
import { resolveSessionWorkspacePath } from './services/toolCwdScope';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { TaskStatus } from '@modules/tasks/types';

import { RollbackIntegration } from '@modules/security';
import type { FileOperation } from '@modules/security';

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
 * 扩容续跑的缓存键分隔符（`${sessionId}::turnsX${multiplier}`）。
 *
 * 2026-10-19（会话级对象生命周期修复）：键的生成与「按会话回收/去重」必须同源，
 * 禁止各处再写字面量 `'::turnsX'`（否则回收逻辑会与键格式悄悄漂移）。
 */
const TAOR_MULTIPLIER_KEY_SEP = '::turnsX';

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
   * 当前会话ID（本地缓存）—— **按请求身份分桶**（多租户 P0 阶段 2，2026-10-21）。
   *
   * 改造前是**进程级单字段**：服务端并发用户共用一格，A 打开会话会改掉 B 的"当前会话"。
   * 现改为 `Map<principalKey, sessionId>`：桌面端恒为 `local:local` 单桶 ⇒ 行为与改造前一致；
   * 已认证请求各写各的桶。键由 `getRequestPrincipalKey()` 提供（无请求作用域 ⇒ 本地身份）。
   *
   * 惰性建 Map：白盒测试用 `Object.create(prototype)` 构造实例（字段初始化器不执行），
   * 直接在 setter 里补建可避免测试被迫感知内部结构。
   */
  private _currentSessionIds?: Map<string, string>;

  private get _currentSessionId(): string | null {
    return this._currentSessionIds?.get(getRequestPrincipalKey()) ?? null;
  }

  private set _currentSessionId(id: string | null) {
    const map = (this._currentSessionIds ??= new Map<string, string>());
    const key = getRequestPrincipalKey();
    if (id === null) map.delete(key);
    else map.set(key, id);
  }
  /** 记录每个会话的离开时间戳，用于回切召回检测 */
  private _sessionLeaveTimes = new Map<string, number>();

  /**
   * 会话内存缓存
   */
  private _chatSessions: Map<string, ChatSession> = new Map();

  /**
   * LRO-06：`ProjectStore` 实例缓存（仅"项目会话 + 无显式 workspacePath"分支用到，
   * 延迟 `require` 创建；实现见 `manager/projectSandboxPath.ts`）。
   */
  private readonly _projectSandboxStoreRef: { current?: ProjectStoreLike } = {};

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
   * BUG-9（2026-10-19）：是否存在**任意**活跃流式会话。
   *
   * 供系统级消费者（如 `DreamIdleDetector`）判定“系统是否真的空闲” ——
   * 仅靠 `USER_INTERACTION` 会把“长任务正在跑”误判为空闲。
   */
  public hasActiveStreams(): boolean {
    return this._sessionAbortControllers.size > 0;
  }

  /**
   * S1: 中止指定会话的流式请求
   * （issue #19 · Cut H：实现体已外移到 `manager/streamAbort.ts`，三条纪律逐字保留）
   */
  public abortSessionStream(sessionId: string): void {
    abortSessionStreamImpl(
      {
        getAbortController: (sid) => this._sessionAbortControllers.get(sid),
        deleteAbortControllerIfSame: (sid, controller) => {
          if (this._sessionAbortControllers.get(sid) === controller) {
            this._sessionAbortControllers.delete(sid);
          }
        },
      },
      sessionId
    );
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
  private _pendingInteractions =
    new SessionScopedRegistry<PendingInteractionEntry>();

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
   * P0 修复（2026-08-14 排查）：TAORLoop 按 sessionId 的 Map 缓存——原单例 `_taorLoop`
   * 首次调用固化了 sessionId，若首个检查点 sessionId 为空（脏数据），之后所有会话
   * 共用绑定空 id 的 TAORLoop → steering 队列/检查点跨会话串扰。Map 化 + 非空校验根治。
   */
  private readonly _taorLoops = new SessionScopedRegistry<TAORLoop>(
    TAOR_MULTIPLIER_KEY_SEP
  );

  /**
   * G-3（2026-10-18）：主对话验证器的**独立模型**解析状态（issue #17 · D7 外移到
   * `manager/verifierModel.ts`）。
   *
   * - `callModel === null` ⇒ 未配置 `verifier` 角色 ⇒ **不注入** TAOR 配置（行为零变化）；
   * - 惰性解析：`resolveRoleModel('verifier')` 是异步，而 `_getOrCreateTAORLoop` 同步 ——
   *   故在 `sendMessage` 入口先 await `ensureVerifierCallModel(this._verifier)` 再建实例。
   */
  private readonly _verifier: VerifierModelState = {
    callModel: null,
    resolved: null,
  };

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
  private readonly _planDrivenLoops =
    new SessionScopedRegistry<PlanDrivenLoop>();

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
   * `_estimateArrayTokens` / `_approxJsonLength`）已随迁至该模块；本类经同族方法**薄转发**
   * （#18 薄委托收敛：`_recordModelInputSnapshot` / `_compressToolHistory` /
   * `_estimateArrayTokens` 已无调用者 ⇒ 已删，调用点直连本模块）。
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
      this._msgPersist.addAndPersistMessage(sid, msg, opts),
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
      this._requestPrep.recordModelInputSnapshot(sid, input),
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
    getStreamMaxTurn: (sid: string) =>
      this._eventLogStore.getStreamMaxTurn(sid),
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

  /** 会话生命周期门面（SessionLifecycleManager 拆分；装配见 `manager/facadeWiring.ts`） */
  private sessionLifecycle!: SessionLifecycleManager;

  /** 检查点/恢复门面（ResumeCoordinator 拆分） */
  private resumeCoordinator!: ResumeCoordinator;

  /** 上下文压缩门面（ContextCompactor 拆分） */
  private contextCompactor!: ContextCompactor;

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
  /** U-22/S4：断点续跑（`resumeStream` 的实现，见 `manager/streamResume.ts`） */
  private _streamResume!: ChatStreamResume;
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
    // issue #8 · Cut C（2026-10-29）：宿主级 sink / 退出钩子 / 内存水位装配已外移到
    // `manager/hostWiring.ts`（注册顺序与迁移前逐条一致；退出钩子注册表仍在模块级，
    // 经参数传入以避免循环 import）。
    installHostWiring({
      appendStreamEvent: (sid, event) => this.appendStreamEvent(sid, event),
      flushAllPendingEventBuffers: () =>
        this._eventLogStore.flushAllPendingEventBuffers(),
      flushAllCheckpoints: () => this.flushAllCheckpoints(),
      markCleanShutdown: () => this.sessionGateway.markCleanShutdown(),
      registerEventBufferFlusher,
      registerCleanShutdownHandler,
    });
    this.stopHookManager = createStopHookManager();
    this._registerStopHooks();

    // issue #8 · Cut C / #16：子门面装配外移（顺序不变）+ 宿主端口单点断言与契约守卫
    wireChatFacades(asWiringHost<FacadeWiringHost>(this));

    // 消息编排门面（issue #8 · Cut C）：宿主端口字面量外移到 `manager/orchestratorHost.ts`
    // （逐条转发、无业务判定）；#16 起由 `asWiringHost` 单点断言 + 装配契约守卫兜底。
    this.chatOrchestrator = new ChatOrchestrator({
      host: createOrchestratorHost(
        asWiringHost<OrchestratorWiringHost>(this),
        (this.constructor as typeof ChatManagerImpl).SESSION_LOOKUP_TOOL
      ),
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
    // issue #8 · Cut A（2026-10-29）：装配体已外移到 `manager/checkpointBudget.ts`，
    // 此处只做**状态注入/回写**（幂等守卫与解绑函数仍由本类持有）。
    installBudgetSuspendResume({
      alreadyWired: this._budgetSuspendResumeWired,
      markWired: () => {
        this._budgetSuspendResumeWired = true;
      },
      setUninstall: (fn) => {
        this._budgetReliefUninstall = fn;
      },
      resumeSuspendedSession: (sessionId, chain) =>
        this.resumeSuspendedSession(sessionId, chain as never),
    });
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
          // G-3：仅在配置了 verifier 角色时注入（未配置 ⇒ 键不存在，行为零变化）
          ...(this._verifier.callModel
            ? { verifierModel: this._verifier.callModel }
            : {}),
        },
      });
    }
    // S1（2026-09-05，PR9/B-任务）：扩容续跑时创建放大轮次预算的独立实例——
    // 与基础实例分键缓存（同 multiplier 复用，避免每次 re-roll 新建实例）。
    //
    // 2026-10-19（源码排查 S1）：改用 `SessionScopedRegistry.getOrCreate()` —— 键为
    // `sessionId`（基础）/ `sessionId::turnsX<n>`（扩容），同时由注册表登记
    // 「会话 → 键集合」⇒ 拆除时 `dispose(sessionId)` 精确回收全部变体（无需独立登记簿）。
    const taorLoop = this._taorLoops.getOrCreate(
      sessionId,
      () => {
        const baseMaxTurns =
          parseInt(configManager.env('MAX_TAOR_TURNS') || '') || 300;
        // 阶段 2（2026-09-01）：统一循环工厂（mode='batch'）替代直接 createTAORLoop
        return createChatAgentLoop({
          mode: 'batch',
          queryEngine: this.getQueryEngine(),
          config: {
            sessionId,
            maxTurns: multiplier > 1 ? baseMaxTurns * multiplier : baseMaxTurns,
            /** 启用检查点，每 3 轮自动保存（原值：关闭 + 5 轮） */
            enableCheckpoint: true,
            checkpointInterval: 3,
            // G-3：仅在配置了 verifier 角色时注入（未配置 ⇒ 键不存在，行为零变化）
            ...(this._verifier.callModel
              ? { verifierModel: this._verifier.callModel }
              : {}),
          },
        });
      },
      multiplier > 1 ? String(multiplier) : undefined
    );
    // F2（2026-10-12，预算挂起续跑 Task 3）：把实例登记进活跃注册表
    // （`checkpoint-handlers` 的 `activeLoops`）。修复前 `registerTAORLoop` 全仓零调用
    // ⇒ 注册表恒空 ⇒ `handleResumeCheckpoint` 恒 404（batch 手动恢复不可达）。
    //
    // 注册键用 **sessionId**（非 `cacheKey`）：端点的寻址键即路径段 sessionId
    // （`parsePathParams` → `activeLoops.get(params.id)`），而 `cacheKey` 在
    // `multiplier > 1` 时会带 `::turnsXn` 后缀 ⇒ 用它会令放大实例在端点上寻址失配。
    //
    // 2026-10-19（源码排查 D2/D3 修复）：登记从「仅首次创建」改为**每次取用**——
    // ① 端点/steering 始终指向**最近一次使用**的实例（扩容实例也因此可达，原实现被基础实例
    //    覆盖后扩容实例在端点上失联）；② 同时把 `cacheKey` 记进会话的键集合，供拆除时精确回收。
    //
    // `TAORLoop` **已存在** `getCheckpointsForSession`（`:1662`）⇒ 直接按 `TaorLoopPort`
    // 结构转发，**不**改 `TAORLoop.ts`（该文件已逼近 R04-001 行数上限）。
    const activeLoop = taorLoop;
    registerTAORLoop(sessionId, {
      getCheckpointsForSession: () => activeLoop.getCheckpointsForSession(),
      resumeFromCheckpoint: (id?: string) =>
        activeLoop.resumeFromCheckpoint(id),
    });
    return taorLoop;
  }

  /**
   * 注销某会话的**进程级**登记，并回收本实例的**会话级缓存**。
   *
   * 2026-10-19（源码排查 D1/D2/D3 修复）：原实现只注销注册表；`_taorLoops` 与
   * `_planDrivenLoops` 全仓无 `.delete`/`.clear` ⇒ 已删会话永久占用两条循环实例
   * （扩容键 `::turnsXn` 也永不回收）。现按「会话 → 缓存键集合」精确回收。
   *
   * 幂等：进程级注册表只在本实例确登记过时才反向注销（避免误删他人登记）；
   * 三类会话级缓存（TAOR / PlanDriven / 待处理交互）**无条件** `dispose`。
   */
  private _unregisterTaorLoop(sessionId: string): void {
    // S1（2026-10-19）：统一走 SessionScopedRegistry 的 dispose 契约 ——
    // 「会话 → 键集合」由注册表自身维护，三类会话级缓存一次回收。
    const hadRegistration = this._taorLoops.keysOf(sessionId).length > 0;
    this._taorLoops.dispose(sessionId);
    this._planDrivenLoops.dispose(sessionId);
    this._pendingInteractions.dispose(sessionId);
    if (hadRegistration) unregisterTAORLoop(sessionId);
    // S2：删除后该会话在三张会话级表中的残留必须为 0（仅非生产环境，见方法注释）
    this._assertSessionScopedDisposed(sessionId);
  }

  /** I1：注销本实例登记过的**全部**会话并清空会话级缓存（`cleanup()` / `clearAllSessions` 用）。 */
  private _unregisterAllTaorLoops(): void {
    for (const sessionId of this._taorLoops.sessions()) {
      unregisterTAORLoop(sessionId);
    }
    this._taorLoops.disposeAll();
    this._planDrivenLoops.disposeAll();
    this._pendingInteractions.disposeAll();
  }

  /**
   * S2（2026-10-19）：用不变式代替注释 —— 会话拆除后，该 `sessionId` 在**所有**
   * 会话级注册表中的残留条目数必须为 0。
   *
   * 为什么不抛错：拆除链路可能已进入不可回滚的中途（会话数据已删），此时抛错只会把
   * 「泄漏」升级为「拆除失败」；因此 dev/test 环境**显式 error 日志**（带精确字段），
   * 由守卫测试与日志监控兜底。
   */
  private _assertSessionScopedDisposed(sessionId: string): void {
    if (process.env.NODE_ENV === 'production') return;
    const residual = {
      taorLoopKeys: this._taorLoops.keysOf(sessionId).length,
      planDrivenLoopKeys: this._planDrivenLoops.keysOf(sessionId).length,
      pendingInteractionKeys:
        this._pendingInteractions.keysOf(sessionId).length,
    };
    if (
      residual.taorLoopKeys > 0 ||
      residual.planDrivenLoopKeys > 0 ||
      residual.pendingInteractionKeys > 0
    ) {
      logger.error('sessionScopedRegistry:residual_after_dispose', {
        sessionId,
        ...residual,
      });
    }
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
   * D-1（2026-08-23）：执行待对账会话（issue #17 · D5：实现体已外移到 `manager/reconcileDrain.ts`）。
   *
   * 对账默认只检测 + 告警 + 生成修复计划（自动修复关闭）；队列仍由本类持有，以端口传入。
   */
  async runPendingReconciles(): Promise<void> {
    return runPendingReconciles({
      pendingReconcileSessions: this._pendingReconcileSessions,
      getOrCreateEventLog: (sid) => this._getOrCreateEventLog(sid),
      sessionGateway: this.sessionGateway,
    });
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
   * A6（2026-09-04）：退出兜底——flush 各会话 TAORLoop 未落盘 checkpoint。
   * 库代码不注册全局信号；由 main 信号链经 flushAllEventBuffers 到达本方法。
   * 逐条容错（幂等；无进行中 run 无操作）。
   */
  async flushAllCheckpoints(): Promise<void> {
    // 2026-10-19（源码排查 D6/S1）：`_taorLoops` 的键在扩容续跑时带 `::turnsXn` 后缀
    // ⇒ 同一会话可能有多个实例。注册表的 `firstPerSession()` 按会话去重后只 flush 一次。
    await Promise.all(
      [...this._taorLoops.firstPerSession().values()].map((loop) =>
        loop.flushCheckpoint().catch(() => {
          // @ignore-catch — 单会话 checkpoint flush 失败不阻断退出链（CS03）
        })
      )
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
   * 清理（issue #19 · Cut G：实现体已外移到 `manager/shutdown.ts`，顺序/纪律不变）
   */
  cleanup(): void {
    cleanupHost({
      yieldResumerUninstall: this._yieldResumerUninstall,
      budgetSuspendResumeWired: this._budgetSuspendResumeWired,
      budgetReliefUninstall: this._budgetReliefUninstall,
      clearYieldResumer: () => {
        this._yieldResumerUninstall = null;
        this._yieldResumerInstalled = false;
      },
      clearBudgetRelief: () => {
        this._budgetReliefUninstall = null;
        this._budgetSuspendResumeWired = false;
      },
      unregisterAllTaorLoops: () => this._unregisterAllTaorLoops(),
      resetStreamService: () => this.streamService.reset(),
    });
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
    // G-3：解析 verifier 角色模型（幂等；未配置 ⇒ 不注入，行为零变化）。
    // 必须在 `chatOrchestrator.sendMessage` 创建/复用 TAORLoop **之前**完成。
    await ensureVerifierCallModel(this._verifier);
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
   * issue #8 · Cut B（2026-10-29）：实现体已外移到 `manager/budgetResume.ts`
   * （`stream` ⇒ 先重放、无进展则重发；`taor` ⇒ `resumeFromCheckpoint` 后触发既有执行入口），
   * 此处保留同名 thin delegate（`ChatManagerInterface` 零改动）。
   *
   * @returns 是否**真正发起**了续跑（两链都"未发生后返回 `false`" ⇒ 协调器保留挂起）
   */
  async resumeSuspendedSession(
    sessionId: string,
    chain: 'stream' | 'taor'
  ): Promise<boolean> {
    return resumeSuspendedSessionImpl(
      this._budgetResumeDeps(),
      sessionId,
      chain
    );
  }

  /**
   * issue #8 · Cut B：续跑模块的依赖装配（显式注入，**不建全局单例**）。
   *
   * 每次调用重建对象（纯引用转发、无状态），避免把会话/服务快照固化成实例字段。
   */
  private _budgetResumeDeps(): BudgetResumeDeps {
    return {
      getOrCreateTAORLoop: (sid) => this._getOrCreateTAORLoop(sid),
      sendViaOrchestrator: (content, options) =>
        this.chatOrchestrator.sendMessage(content, options),
      getLatestCheckpoint: (sid) => this.getLatestCheckpoint(sid),
      resumeStream: (sid, checkpointId) => this.resumeStream(sid, checkpointId),
      readSessionEvents: (sid, query) => this.readSessionEvents(sid, query),
      markResumeIntent: (sid) => this.markResumeIntent(sid),
      checkpointService: this._checkpointService,
    };
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

  /**
   * D5-A（2026-09-25，`.trae/specs/memory-dedup-blocking-rootfix.md`）：会话 → 该会话
   * 「对话记忆」的 memoryId。用于**按会话聚合**（原实现每轮新建一条 ⇒ 库随轮数线性增长，
   * 本机实测已 576 条，全库去重成本 O(n²) 随之膨胀）。
   */
  private readonly _conversationMemoryIdBySession = new Map<string, string>();

  /**
   * 响应后自动提取记忆（issue #17 · D2：实现体已外移到 `manager/memoryExtract.ts`）。
   *
   * 会话 → memoryId 的 Map 仍由本类持有（实例级生命周期），以端口传入。
   */
  private async extractMemoryFromChat(
    userContent: string,
    assistantContent: string,
    sessionId: string
  ): Promise<void> {
    return extractMemoryFromChatImpl(
      { conversationMemoryIdBySession: this._conversationMemoryIdBySession },
      userContent,
      assistantContent,
      sessionId
    );
  }

  /**
   * 记录 LLM 响应的令牌用量
   *
   * issue #8 · Cut C（2026-10-29）：实现体已外移到 `manager/usageAccounting.ts`
   * （水位预算 / 日预算结算 / 目标入账 / `metric/timing` 落盘），此处保留同名 thin delegate；
   * **同步签名不变**（事件落盘仍 fire-and-forget，失败只记日志）。
   */
  private recordChatResponseUsage(
    sessionId: string,
    usage: Record<string, number> | null | undefined,
    requestId?: number,
    model?: string
  ): void {
    recordChatResponseUsageImpl(
      {
        tokenBudget: this.tokenBudget,
        unifiedTracker: this.unifiedTracker,
        appendStreamEvent: (sid, event) => this.appendStreamEvent(sid, event),
      },
      sessionId,
      usage,
      requestId,
      model
    );
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
      (prompt, sess, opts) =>
        executeStepPrompt(
          (content, o) => this.sendMessage(content, o),
          prompt,
          sess,
          opts
        ),
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
   * P2（08-09）：创建 StreamPipeline 实例
   *
   * issue #17 · D10：端口装配已外移到 `manager/streamPipelineFactory.ts`。
   */
  private _createStreamPipeline(
    session: ChatSession,
    content: string,
    options?: StreamMessageOptions
  ): StreamPipeline {
    return createStreamPipelineFor(this, session, content, options);
  }

  /**
   * P2-4: 获取会话绑定的工作区路径（项目模块会话 = `sandboxPath`）
   * 用于工具默认 cwd 的会话上下文化，替代全局 SandboxConfigBuilder.defaultWorkspacePath
   *
   * LRO-06 / D4 后半（2026-10-26 真机实测）：项目会话的 metadata 只有 `projectId`、
   * 没有 `workspacePath` ⇒ 此前工具 cwd 回落到**代码仓根**。现由 `projectId` 解析
   * `project.json#sandboxPath`（用户项目目录），并**回写** `metadata.workspacePath`，
   * 使客户端 `currentSession.workspacePath` 与服务端同一口径。
   */
  private getSessionWorkspacePath(sessionId?: string): string | undefined {
    if (!sessionId) return undefined;
    const session = this._chatSessions.get(sessionId);
    const metadata = session?.metadata as Record<string, unknown> | undefined;
    const resolved = resolveSessionWorkspacePath({
      metadata,
      getProjectSandboxPath: (projectId) =>
        getProjectSandboxPath(
          { cacheRef: this._projectSandboxStoreRef },
          projectId
        ),
    });
    // 由 projectId 派生（而非客户端显式传入）时回写元数据：本进程内后续读取与
    // 会话落盘/列表接口都拿到同一值；已有绝对 workspacePath 时不覆盖。
    if (resolved && metadata && !metadata.workspacePath) {
      metadata.workspacePath = resolved;
    }
    return resolved;
  }

  /**
   * 多租户 P3：该会话在当前身份下是否**可用**（HTTP 入口 404 语义的唯一判据）。
   *
   * 任何身份都要求会话**确实存在**（BUG-14：本地身份不再豁免存在性）；
   * 本地身份的**归属**判定恒放行，已认证身份按归属判定，
   * 跨身份与"不存在"返回同一 `false`（调用方统一按 404 响应，不泄露存在性）。
   */
  async canUseSession(sessionId: string): Promise<boolean> {
    return this.sessionLifecycle.canUseSession(sessionId);
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
   * U-02 v2 / P3（2026-10-20）：会话是否声明**工作区严格边界**。
   *
   * 仅 AlwaysOn 的隔离轮把 `metadata.workspaceStrict` 置 true ⇒ 工具执行层拒绝
   * 越界的路径入参（绝对路径 / `../`）。其余会话未声明 ⇒ **零行为变更**。
   */
  private isSessionWorkspaceStrict(sessionId?: string): boolean {
    if (!sessionId) return false;
    const session = this._chatSessions.get(sessionId);
    const metadata = session?.metadata as Record<string, unknown> | undefined;
    return metadata?.workspaceStrict === true;
  }

  /**
   * PR-3（2026-10-23）：会话级审批模式（会话元数据 `approvalMode`）。
   *
   * 只认白名单值：`auto-local` ⇒ 自动执行（仅只读 + 本地写，受 `FEATURE_SESSION_AUTO_LOCAL` 约束）；
   * 其余（含缺失 / 脏值）一律 `ask` —— 不因未知取值放宽。
   */
  private getSessionApprovalMode(sessionId?: string): 'ask' | 'auto-local' {
    if (!sessionId) return 'ask';
    const session = this._chatSessions.get(sessionId);
    const metadata = session?.metadata as Record<string, unknown> | undefined;
    return metadata?.approvalMode === 'auto-local' ? 'auto-local' : 'ask';
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
  }

  /**
   * BUG-A（2026-10-27）：最近一条 assistant 消息是否为「空输出兜底」投影。
   *
   * 判定唯一依据是消息 `metadata.emptyOutputFallback`（`computeFinalMessage` 写入的
   * 结构化标记），**禁止**比对兜底文案本身（CS02）。
   */
  private _isLastAssistantOutputFallback(session: ChatSession): boolean {
    const messages = session.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if ((m as { role?: string })?.role === 'assistant') {
        return isEmptyOutputFallbackMessage(m);
      }
    }
    return false;
  }

  /** 裸会话 ⇒ PDCA 编排升级（U-22/S1 外移；单一动作入口，实现在 `manager/pdcaLaunch.ts`） */
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

  /**
   * 断点续跑（U-22/S4 外移；实现在 `manager/streamResume.ts`）
   */
  async *resumeStream(
    sessionId: string,
    checkpointId: string
  ): AsyncGenerator<string | ChatStreamChunk, Message, unknown> {
    return yield* this._streamResume.resume(sessionId, checkpointId);
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

    // P5-4（2026-10-28）：**Checkpoint 边界** —— 不可逆操作（有副作用 ∧ 非幂等）执行前，
    // 同会话必须存在 checkpoint。默认关闭（`config.json` 的 `checkpointBoundary.enabled`），
    // 关闭时零行为变更；开启后 `relaxed` 先补建快照，建失败 ⇒ 拒绝（fail-closed）。
    // 规格：`.trae/specs/p5-runtime-hardening-specs.md` §3。
    const boundaryRefusal = await ensureCheckpointBoundary({
      toolName: toolCall.name,
      currentSessionId: this._currentSessionId,
      resumeCoordinator: this.resumeCoordinator,
    });
    if (boundaryRefusal) {
      logger.warn('Checkpoint 边界拒绝执行（不可逆操作前无可用快照）', {
        sessionId: this._currentSessionId,
        toolName: toolCall.name,
        reason: boundaryRefusal,
      });
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: null,
        error: boundaryRefusal,
      };
    }

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
    await this._eventLogStore.releaseInactiveEventLogSnapshots(sessionId);
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
    this._msgPersist.addAndPersistMessage(sessionId, message);
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
   * （issue #17 · D4：对象字面量已外移到 `manager/sessionManagerFacade.ts`；对外签名仍为 `any`）
   * @returns 会话管理器
   */
  getSessionManager(): any {
    return createSessionManagerFacade({
      getLocalSession: (id) => getLocalSession(this._chatSessions, id),
      currentSessionIdRef: {
        get: () => this._currentSessionId,
        set: (id) => {
          this._currentSessionId = id;
        },
      },
      chatSessions: this._chatSessions,
      addAndPersistMessage: (sid, msg) =>
        this._msgPersist.addAndPersistMessage(sid, msg),
      checkpointService: this._checkpointService,
    });
  }

  /**
   * 根据模型名获取对应的 LLM 客户端
   * （issue #17 · D3：实现体已外移到 `manager/modelClient.ts`；BUG-08 的"不静默回落"语义不变）
   */
  private getClientForModel(model?: string): ToolAwareClient {
    return getClientForModelImpl(
      {
        llmClient: this.llmClient,
        toolRegistry: this.toolRegistry,
        toolExecutor: this.toolExecutor,
      },
      model
    );
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
