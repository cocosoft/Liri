/**
 * LongRunningTaskOrchestrator — PDCA 长程任务编排器
 *
 * 四阶段闭环：
 *   PLAN → 创建 Planner SubAgent，分析任务，输出 Plan + 验收标准
 *   EXECUTE → 逐 Step 创建 Executor SubAgent，执行并记录
 *   REVIEW → 创建 Reviewer SubAgent，对比验收标准与输出
 *   DECIDE → 根据审查结果 approve / retry / skip / escalate
 *
 * 复用组件：
 *   TaskOrchestrator（Plan 存储）、LifecycleTracker（生命周期）、
 *   AgentIsolation（隔离）、TOOL_CATEGORIES（角色工具范围，经 getRealToolNamesForTask 派生）
 */

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import { configManager } from '@modules/config';
import { resolveDbPath } from '@modules/core/paths';
import { trackUsage, modelRouter, estimateMessagesTokens } from '@modules/ai';
import { taskOrchestrator } from './TaskOrchestrator';
import { emitPdcaLiveEvent } from './PdcaLiveEvents';
import type { Plan, PlanStep } from './TaskOrchestrator';
import { parsePlanDraft } from './planOutputParser';
import type { PlanDraft } from './planOutputParser';
import {
  validatePlanAdmission,
  computeProgressFingerprint,
  shouldStopForStall,
} from './planAdmission';
import { TaskStatus } from './types';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { LifecycleTracker } from './LifecycleTracker';
import type { LifecycleEvent, LifecyclePhase } from './LifecycleTracker';
import { goalMetricsService } from './db/GoalMetricsService';
import {
  createAgentIsolation,
  throwIfAborted,
  registerIsolationToScope,
} from '@modules/agent';
import { EffectScope } from '@modules/context';
import type { AuditReport } from './AuditReport';
import { formatReviewSummary } from './PlanReview';
import type { PlanReview, ReviewDecision } from './PlanReview';
import { createReviewGate } from './review/ReviewGate.js';
import type { ReviewGate, ReviewGateContext } from './review/ReviewGate.js';
import { GoalEvaluateGate } from './review/GoalEvaluateGate.js';
// T-②02（2026-10-03）：目标偏差判定（纯函数，判定与接线分离）+ 事件落盘
import { evaluateGoalDeviation } from './review/GoalDeviation.js';
import { emitGoalDeviation } from './goal/GoalEvents';
// T-②06（2026-10-03）：经验自动演化（PDCA 终态收口点触发；聚合式，跨任务）
import {
  runAdaptationEvolution,
  createEvolutionDeps,
} from './evolution/AdaptationEvolutionService';
import { TAORLoop } from '@modules/query';
import type { TAORLoopDeps } from '@modules/query';
import { VerifierAgent, createVerifierAgent } from '@modules/query';
import type { VerificationResult } from '@modules/query';
// 13-P0-2（2026-10-05）：验收标准结构化（存档回填时由文本重派生）
import { parseSuccessCriteria } from '@modules/core';
import { FileLockManager, fileLockManager } from './FileLockManager.js';
import { inboxManager } from '@modules/runtime/InboxManager.js';
import {
  syncPdcaWorkItemStatus,
  writePdcaCheckpoint,
  readPdcaCheckpoint,
} from './PdcaWorkItemBridge';
import type { PdcaPhase } from '@modules/core';
import { pdcaCheckpointStatus, findUnprovableCriteria } from '@modules/core';
import { getToolRegistry, buildToolDefinitions } from '../tools/index.js';
import type { ToolUseContext } from '../tools/types/Tool.js';

// 大文件拆分（spec file-size-debt-partition-plan §44）：类型契约与任务消息助手外迁 `./lro/*`；
// 下述 re-export 保持**公开面不变**（原 `export` 的 4 个类型仍可从本文件取）。
// U-22/S1（2026-10-17）：计划生成/修复与步骤拓扑外移（行为等价搬迁）
import {
  groupStepsByDependency,
  repairAcceptanceCriteria,
  repairPlanJson,
  type PlannerRepairDeps,
} from './lro/plannerSupport.js';
// U-22/S1（2026-10-17）：PLAN 阶段外移（行为等价搬迁）
import { runPlanPhase } from './lro/planPhase.js';
// U-22/S1（2026-10-17）：步骤产物读写回与缺陷捕获外移（行为等价搬迁）
import {
  readBackWrittenArtifacts,
  recordEscalation,
  type StepArtifactsDeps,
} from './lro/stepArtifacts.js';
// U-22/S3（2026-10-17）：REVIEW/DECIDE 阶段外移（行为等价搬迁）
import {
  autoDecideStep,
  buildReviewGateContext,
  decideStep,
  reviewStep,
  type StepReviewDecideDeps,
} from './lro/stepReviewDecide.js';
// U-22/S1（2026-10-17）：跨重启恢复外移（行为等价搬迁）
// U-22/S2b（2026-10-17）：步骤执行主链外移（行为等价搬迁）
import {
  executeSingleStep,
  type StepExecutionDeps,
} from './lro/stepExecution.js';
import { resumeFromCheckpoint } from './lro/resumeFromCheckpoint.js';
// PR-5（2026-10-23）：步骤级审批挂起的落点与恢复（外移以守住 R04-001 行数上限）
import {
  resumeSuspendedSteps,
  suspendPlanForApproval,
} from './lro/stepSuspension.js';
// PR-5（2026-10-23）：目标级收敛判定与「未收敛」收尾（同上，外移守行数上限）
import { runGoalConvergenceGate } from './lro/goalConvergence.js';
// U-02（2026-10-19）：`/goal start` 目标 ↔ PDCA 终态绑定
import { settleGoalById } from './goal/goalRunBinding.js';
import { resolveAuditStore, replanMaxRetries } from './lro/portResolvers.js';
import {
  recordGoalStageMetric,
  runAdaptationEvolutionHook,
  evaluateGoalDeviationHook,
  persistMemoryFromAudit,
  persistReviewSample,
} from './lro/terminalHooks.js';
import type {
  PdcaStatus,
  PdcaMetrics,
  ExecutorFn,
  RoleConfig,
  TaskMessage,
  EscalationRecord,
} from './lro/contracts.js';
import { normalizeExecutorResult } from './lro/contracts.js';
// R16（台账 L-14）：任务/子代理**非 chat 管线**的模型用量计入每日预算
// （此路径不经 `ChatManager.recordChatResponseUsage`，故在默认执行器单点记账）。
import { recordDailyBudgetFromUsage } from '../query/DailyBudgetManager';
// G-2/D（2026-10-11）：闸门**单一收口**（与流式/非流式 chat 同源判定），用于长程任务执行器
import {
  checkDailyBudget,
  formatBudgetExhausted,
} from '../query/dailyBudgetGate';
export type {
  PdcaStatus,
  PdcaMetrics,
  TaskMessage,
  EscalationRecord,
} from './lro/contracts.js';
import {
  emitTaskEvent,
  createToolContext,
  emitTaskMessage,
} from './lro/taskMessaging.js';
// 大文件拆分（spec file-size-debt-partition-plan §46）：报告投影 + 纯函数判定外迁 `./lro/*`。
import {
  renderAuditReport,
  persistAuditReportFile,
  projectPdcaStatus,
  projectPdcaMetrics,
} from './lro/reporting.js';
import type { PdcaReportView } from './lro/reporting.js';
import {
  planTurnsExtensionDecision,
  shouldReRollMaxTurnsStep,
  shouldAutoApprovePlan,
} from './lro/pureDecisions.js';
// 纯函数判定原为公开导出 ⇒ re-export 保持公开面（spec §46）
export {
  planTurnsExtensionDecision,
  shouldReRollMaxTurnsStep,
} from './lro/pureDecisions.js';

const logger = getLogger('tasks:longRunning');

export type { PdcaPhase };

// U-22/S2b（2026-10-17）：步骤执行纯函数助手外移 `./lro/stepHelpers`；
// 以下 re-export 保持**公开面不变**（既有导入路径/测试无需改动）。
export {
  isSecurityIntercepted,
  MAX_SECURITY_STEERS_PER_STEP,
  buildSecuritySteeringMessage,
  classifyArtifactAccess,
} from './lro/stepHelpers.js';
export type { ArtifactAccess } from './lro/stepHelpers.js';
export { collectPendingReadBacks } from './lro/stepArtifacts.js';

// （审计存储/记忆回写两个惰性端口解析器 + `AuditLogEntry`/`AuditStoreLike`/
//  `MemoryWritebackManager` + `replanMaxRetries` 已外迁 `./lro/portResolvers`，spec §45）

// （`PdcaStatus` / `PdcaMetrics` / `SubAgentHandle` / `RoleConfig` / `PLANNER_ROLE` /
//  `EXECUTOR_ROLE` / `ExecutorFn` / `TaskMessage` / `EscalationRecord` 已外迁
//  `./lro/contracts`，并由本文件 import + re-export 保持公开面，spec §44）

/**
 * G-2/D（2026-10-11，Spec `daily-budget-over-limit-ux.md` §5-D-1 D / §1.2 G-2）：
 * 长程任务执行器的**日预算统一收口**（计账 + 闸门）。
 *
 * **为什么需要**：长程任务走的是**非 chat 管线**（默认执行器直调 `AIService.generate`）——
 * 它不经 `CoreAPI.chatStream`（流式闸门）也不经 `sendMessageFlow`（非流式闸门）⇒ 此前
 * **既无闸门也无（自定义执行器的）计账**，可在预算耗尽后继续跑（G-2 的绕过路径）。
 *
 * **收口口径**（对齐流式/非流式 chat 的单一收口 `checkDailyBudget()`）：
 *   1. **判定在前**：以"系统提示 + 用户提示"的估算为 `estimatedTokens`，超限即抛
 *      `DAILY_BUDGET_EXCEEDED`（**不发起模型调用**）；
 *   2. **中止即可续跑**（本节无新挂起机制，见 Spec §10-8）：抛出点在阶段边界之后
 *      （`setPhase()` 已落 checkpoint）⇒ 任务停在当前阶段，放行后**重发/续跑**即可；
 *   3. **计账**：自定义执行器若回传 `usage` 则计入日预算；默认执行器已在内部记账
 *      （其返回值不含 `usage`）⇒ **不会被重复计入**。
 */
function guardExecutorWithDailyBudget(
  base: ExecutorFn,
  taskId: string
): ExecutorFn {
  return async (params) => {
    const estimatedTokens = estimateMessagesTokens([
      { role: 'system', content: params.systemPrompt },
      { role: 'user', content: params.userPrompt },
    ]);
    const decision = checkDailyBudget({
      sessionId: taskId,
      estimatedTokens,
    });
    if (!decision.allowed) {
      logger.warn('lro:budget — 执行器调用前置检查拒绝', {
        taskId,
        taskType: params.taskType,
        todayUsed: decision.snapshot.used,
        dailyLimit: decision.snapshot.limit,
        estimateThisRound: estimatedTokens,
        mode: decision.snapshot.mode,
      });
      throw new AppError(
        `${formatBudgetExhausted(decision.snapshot)}，为避免超额，本次未调用模型；任务已停在当前阶段，放行后可直接续跑/重发。`,
        ErrorCategory.RESOURCE,
        ErrorSeverity.MEDIUM,
        'DAILY_BUDGET_EXCEEDED',
        {
          taskId,
          // 口径随快照（2026-10-15：主口径已切 USD）—— 与 `resolveEntryBudgetDenial` 的 context 同形。
          unit: decision.snapshot.unit,
          todayUsed: decision.snapshot.used,
          dailyLimit: decision.snapshot.limit,
          estimateThisRound: estimatedTokens,
        }
      );
    }
    const result = await base(params);
    // 计账：仅"执行器回传 usage"时计入（默认执行器内部已记账 ⇒ 不回传 usage ⇒ 不重复计）
    // 债四「换算接线」（2026-10-13）：**自定义** ExecutorFn 的实际模型对编排器不可见
    // （见 `lro/contracts.ts` 的 `ExecutorResult` 说明）⇒ 该路径**只记 token、不记金额**
    // （`recordTurnCostUsd` 以 `debug` 留痕，**不取兜底价、不臆造金额**）。
    if (result && typeof result === 'object') {
      recordDailyBudgetFromUsage((result as { usage?: unknown }).usage);
    }
    return result;
  };
}

export class LongRunningTaskOrchestrator {
  private taskId: string;
  private planId: string | null = null;
  private phase: PdcaPhase = 'plan';
  private lifecycle: LifecycleTracker;
  private isolation: ReturnType<typeof createAgentIsolation>;
  /** T1.2: Agent 执行副作用作用域（dispose 时按 LIFO 释放） */
  private scope: EffectScope;
  private executor: ExecutorFn;
  /** §5 P1: 任务消息回写回调（runFullPdca 注入）与当前 sessionId */
  private _onTaskMessage?: (sessionId: string, msgs: TaskMessage[]) => void;
  private _sessionId: string | null = null;
  /** S2（2026-08-13）：TAORLoop 步骤 token 累计（goal_metrics stage 行数据源） */
  private _totalTokensTracked = 0;
  /** S2：任务开始时间（duration 计算） */
  private _startedAt = 0;
  /** P1-2（2026-08-31）：当前 PDCA 循环 turn 预算上限（goal_metrics.max_turns 数据源） */
  private _maxTurns = 0;
  /** P1-3（2026-08-31）：目标级收敛判定门（对标 Hermes evaluate_after_turn，无状态可复用） */
  private goalEvaluateGate = new GoalEvaluateGate();
  /**
   * D5（M6，2026-08-13）：阶段回退增量 replan 记录（escalate 时捕获缺陷清单）
   * 重开循环时注入"基线 + 缺陷清单 → 仅修订受影响部分"的增量 replan 指令。
   */
  private _lastEscalations: EscalationRecord[] = [];
  private decisionAwait: Promise<ReviewDecision> | null = null;
  private decisionResolve: ((d: ReviewDecision) => void) | null = null;
  private auditReport: AuditReport | null = null;
  /** 3-1（2026-09-03）：PDCA 终态记忆回写防重（同任务仅写一次） */
  private _memoryWriteDone = false;
  /** 方向4（2026-09-03）：GoalEvaluateGate 收敛判定捕获（评估关闭时不设；L7 三态含未决 undefined） */
  private _goalEvaluation?: {
    converged: boolean | undefined;
    confidence: number;
    reason?: string;
  };
  /** 方向4（2026-09-03）：评估样例落库防重（同任务仅写一次） */
  private _sampleWriteDone = false;
  /**
   * U-02（2026-10-19）：`/goal start` 显式创建的目标 id（可选）。
   * 终态时按 id 精确落定目标状态（同会话可能存在其他批次目标，不得按会话猜）。
   */
  private _goalId?: string;
  // 1-1d（2026-09-03）：stepDurations[].tokens = 该步累计 token（跨 retry 累计），
  // 供 per-step 独立核算/审计聚合；总口径仍以 _totalTokensTracked 为准。
  private stepDurations: Map<
    string,
    { startMs: number; endMs?: number; tokens?: number }
  > = new Map();
  /**
   * Phase 2: TAORLoop 统一编排器（统一编排已常驻，ENABLE_LOOP_V8_PHASE2 已退役——L5 清理 2026-09-06）
   */
  private taorLoop?: TAORLoop;
  /**
   * D2（M3，2026-08-13）：每步独立 TAORLoop 工厂（BatchRunner 并行安全前提）
   * 注入工厂后 executeSingleStep 为每个步骤创建独立实例，杜绝共享实例状态串扰；
   * 未注入时回退共享 taorLoop 串行执行（现状零回归）。
   */
  private taorLoopFactory?: (
    sessionId: string,
    opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
  ) => TAORLoop;
  /** S2/B（2026-09-05，PR9）：步骤轮次预算乘子（resume 扩容续跑时=2）与累计次数 */
  private _stepTurnsMultiplier: number = 1;
  private _turnsExtensions: number = 0;
  /**
   * S4（PR9）/ 2026-10-17 修复：**在飞步骤 loop 集合**（中止级联 abort）。
   * 原实现是单槽 `_currentLoop`，并行批次（Promise.allSettled）只保留最后一个 ⇒
   * 中止/dispose 时其余在飞 loop 继续真实模型调用与工具执行（持续烧钱）。
   * 每个 loop 由步骤执行结束时的 release 回调移除（完成后不再被 abort）。
   */
  private readonly _activeStepLoops = new Set<TAORLoop>();
  /**
   * Phase 4: VerifierAgent（双指标验证：CheckPassRate + Confidence）
   */
  private verifier: VerifierAgent;
  /**
   * Phase 6: 文件级并发锁（多会话冲突保护）
   */
  readonly fileLockManager: FileLockManager;
  /**
   * ReviewGate（REVIEW + DECIDE 阶段组件）：
   * 默认从环境变量创建（PDCA_REVIEW_GATE 等），可 setReviewGate 注入自定义实现。
   * 决策结果（approve/retry/skip/escalate）仍由 decideStep 应用状态变更。
   */
  private reviewGate: ReviewGate;

  constructor(taskId: string, executor?: ExecutorFn) {
    this.taskId = taskId;
    this.lifecycle = new LifecycleTracker();
    this.isolation = createAgentIsolation(taskId);
    // T1.2: 创建执行副作用作用域并登记隔离资源
    // （abort 最后登记 → dispose 时最先执行，与 AgentCleanup 旧语义一致）
    this.scope = new EffectScope();
    registerIsolationToScope(this.isolation, this.scope);
    this._recordLifecycle('created', TaskStatus.PENDING);
    this.verifier = createVerifierAgent({ enabled: true });
    this.fileLockManager = fileLockManager;
    this.reviewGate = createReviewGate();

    // 默认 executor：经 ModelRouter 解析模型（任务分工 / DB 为唯一事实来源）+ 携带工具定义
    const baseExecutor: ExecutorFn =
      executor ??
      (async (params) => {
        // 模型路由：任务分工配置（DB）→ 模型名。不再读 `ANTHROPIC_API_KEY`、不再写死
        // `defaultModel: ''`（project_rules §1.1 禁止 Anthropic 内容；model-usage 要求
        // 模型属性/选择一律读 DB）。
        const model = modelRouter.resolve(params.taskType);
        const { createAIService, AIMessageRole } = await import('@modules/ai');
        const service = createAIService({ defaultModel: model });

        // 工具定义：先按角色派生的**真实名**挑 schema，再经 wire codec 出站
        // （冒号命名空间工具若原样下发会被 provider 400 拒绝）。
        const tools =
          params.tools.length > 0
            ? buildToolDefinitions(
                getToolRegistry()
                  .getToolSchemas()
                  .filter((s) => params.tools.includes(s.name))
              )
            : [];

        const _trackStart = Date.now();
        const response = await service.generate(
          [
            { role: AIMessageRole.SYSTEM, content: params.systemPrompt },
            { role: AIMessageRole.USER, content: params.userPrompt },
          ],
          model,
          tools.length > 0 ? { tools } : undefined
        );

        // 债四「换算接线」（2026-10-13）：与 `trackUsage` **同一模型表达式**（数出同源）
        const turnModel = response.model || model || 'unknown';
        trackUsage(response, {
          model: turnModel,
          providerId: 'default',
          latencyMs: Date.now() - _trackStart,
        });
        // R16（台账 L-14）：任务/子代理**非 chat 管线**用量计入每日预算
        recordDailyBudgetFromUsage(
          (response as { usage?: unknown }).usage,
          undefined,
          turnModel
        );
        // 回传 tool_calls —— 步骤工具可真实执行的前提（原实现只 return 文本）。
        return {
          content: response.content ?? '',
          toolCalls: (response.tool_calls ?? []).map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        };
      });

    // G-2/D（2026-10-11）：自定义与默认执行器**一律**经日预算收口 —— 长程任务的每一处执行器
    // 调用（规划 / 步骤 / 验证 / 目标评估）都在闸门内；计账仅在"执行器回传 usage"时发生
    // （默认执行器内部已记账 ⇒ 不回传 usage ⇒ 不重复计）。
    this.executor = guardExecutorWithDailyBudget(baseExecutor, this.taskId);

    // 2026-10-08（真机实测暴露）：`ReviewGate` 用的 VerifierAgent **从未注入模型** ⇒
    // `VerifierAgent.verify()` 命中 `!this.callModel` 的 fail-closed 分支（ESCALATE，
    // confidence=0）⇒ 每个步骤被覆盖判为 failed —— 即便语义审查已给 `score=78`、
    // summary 明写"判定通过"，`ReviewGate` 仍把 `pass` 置 false ⇒ **目标永不收敛**。
    // 此处复用同一 `executor`（同一模型路由，不禁用工具）作为验证器模型调用。
    const self = this;
    this.verifier.setCallModel(async function* (messages, _signal) {
      const res = normalizeExecutorResult(
        await self.executor({
          systemPrompt:
            '你是一个独立验证者。基于给定对话与工具执行结果，判断步骤是否达成验收标准，输出 JSON 验证结论。只读操作，不修改任何文件。',
          userPrompt: messages
            .map((m) => `[${m.role}] ${m.content}`)
            .join('\n\n'),
          tools: [],
          taskType: 'chat',
          isolation: self.isolation,
        })
      );
      yield { content: res.content };
    });
  }

  /** 设置阶段并同步 WorkItem 状态 */
  private async setPhase(phase: PdcaPhase): Promise<void> {
    this.phase = phase;
    await syncPdcaWorkItemStatus(this.taskId, phase);
    await this._persistCheckpoint(); // P0(M2)：阶段变更即落盘步骤级快照（跨重启恢复）
  }

  /**
   * 1-3（2026-09-03）：lifecycle 统一记录入口 —— 内存轨迹（LifecycleTracker 纯内存不改）
   * + fire-and-forget 审计转发 task_audit_log（复用 SqliteTaskStore.writeAuditLog）。
   * 不把 sqlite 依赖塞进 LifecycleTracker、不在编排器直注 store（TaskRegistry 同模式的小型转发）。
   * event_type = lifecycle phase（created/started/progress/finalized），终态语义由 status 表达
   * （completed/failed/killed 等）；old_status 取前一事件状态。
   */
  private _recordLifecycle(
    phase: LifecyclePhase,
    status: TaskStatus,
    detail?: string
  ): void {
    this.lifecycle.record(phase, status, detail);
    const history = this.lifecycle.getHistory();
    const prev = history.length >= 2 ? history[history.length - 2] : undefined;
    void this._flushLifecycleAudit(
      phase,
      status,
      prev ? (prev.status as string) : null
    );
  }

  /** 审计转发（fire-and-forget；失败降级日志，不阻塞主流程） */
  private async _flushLifecycleAudit(
    phase: string,
    status: TaskStatus,
    oldStatus: string | null
  ): Promise<void> {
    try {
      const store = await resolveAuditStore();
      if (!store) return;
      await store.writeAuditLog({
        taskId: this.taskId,
        eventType: phase,
        oldStatus,
        newStatus: status as string,
        timestamp: Date.now(),
      });
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'lifecycleAuditForward',
        context: { taskId: this.taskId, phase, status: String(status) },
      });
    }
  }

  getTaskId(): string {
    return this.taskId;
  }

  /**
   * P0(M2)：将编排器状态（phase + plan.steps 快照）落盘到 PdcaWorkItemBridge checkpoint。
   * 跨重启恢复依赖此快照——原实现仅写 lastPdcaPhase 单字段，重启后无法恢复步骤进度。
   * 快照失败不影响任务执行（@ignore-catch）。
   */
  private async _persistCheckpoint(): Promise<void> {
    try {
      const plan = this.planId
        ? taskOrchestrator.getPlan(this.planId)
        : undefined;
      await writePdcaCheckpoint(this.taskId, {
        taskId: this.taskId,
        phase: this.phase,
        // Gap D（1-0b）：status 随 phase 联动演进（findExistingTask 排除依赖终态 status）
        status: pdcaCheckpointStatus(this.phase),
        planId: this.planId ?? undefined,
        sessionId: this._sessionId ?? undefined,
        description: plan?.description ?? '',
        steps: (plan?.steps ?? []).map((s) => ({
          id: s.id,
          description: s.description,
          status: s.status,
          result: s.result,
          error: s.error,
          reviewResult: s.reviewResult,
          decision: s.decision,
          retryCount: s.retryCount,
          maxRetries: s.maxRetries,
          acceptanceCriteria: s.acceptanceCriteria,
          // E1①/B（2026-09-05）：步骤终止原因随快照持久化（resume 扩容判定输入）
          terminationReason: s.terminationReason,
          // 1-1c（2026-09-03）：快照携带依赖（resume 按快照顺序位置映射重建）
          dependsOn: s.dependsOn,
        })),
        // D5（M6）：escalate 缺陷清单（跨重启恢复后增量 replan 仍生效）
        lastEscalations: this._lastEscalations,
        // D4（M4）：TAORLoop token 累计（阶段边界结算 → StageOrchestrator 成本护栏）
        totalTokens: this._totalTokensTracked,
        // 2026-10-17：任务开始时间（跨重启恢复 duration 口径；0 ⇒ 不写）
        startedAt: this._startedAt || undefined,
        // S2/B（PR9）：max_turns 扩容续跑次数（跨重启累计，上限门禁）
        turnsExtensions: this._turnsExtensions,
      });
    } catch {
      // @ignore-catch — checkpoint 写入失败不影响任务执行
    }
  }

  getPhase(): PdcaPhase {
    return this.phase;
  }

  getIsolation() {
    return this.isolation;
  }

  /**
   * Phase 2: 注入 TAORLoop 实例（启用统一编排）
   */
  setTAORLoop(loop: TAORLoop): void {
    this.taorLoop = loop;
    logger.info('[orchestrator] TAORLoop 已注入', {
      taskId: this.taskId,
      hasTAORLoop: !!this.taorLoop,
    });
  }

  /**
   * D2（M3，2026-08-13）：注入每步独立 TAORLoop 工厂（无依赖步骤批次并行的安全前提）
   * 工厂签名与 PdcaLauncher.deps.taorLoopFactory 一致：(sessionId) => TAORLoop。
   */
  setTAORLoopFactory(
    factory: (
      sessionId: string,
      opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
    ) => TAORLoop
  ): void {
    this.taorLoopFactory = factory;
    logger.info('[orchestrator] TAORLoop 工厂已注入（每步独立实例，可并行）', {
      taskId: this.taskId,
    });
  }

  /**
   * 注入自定义 ReviewGate（REVIEW + DECIDE 阶段组件化挂载点）
   * 未注入时默认使用 createReviewGate()（按 PDCA_REVIEW_GATE 环境变量切换模式）。
   */
  setReviewGate(gate: ReviewGate): void {
    this.reviewGate = gate;
    logger.info('[orchestrator] ReviewGate 已注入', {
      taskId: this.taskId,
      gateName: gate.name,
    });
  } /** ReviewGate 上下文（U-22/S3 外移；实现在 `./lro/stepReviewDecide`）。 */
  private _buildReviewGateContext(step: PlanStep): ReviewGateContext {
    return buildReviewGateContext(this.stepReviewDeps(), step);
  }

  /** U-22/S3：审查/决策依赖（每次调用重建，全部为轻量引用） */
  private stepReviewDeps(): StepReviewDecideDeps {
    return {
      taskId: this.taskId,
      planId: this.planId,
      sessionId: this._sessionId,
      isolation: this.isolation,
      executor: this.executor,
      verifier: this.verifier,
      reviewGate: this.reviewGate,
      getPlan: (planId) => taskOrchestrator.getPlan(planId) ?? null,
      recordLifecycle: (phase, status, detail) =>
        this._recordLifecycle(phase as LifecyclePhase, status, detail),
      recordEscalation: (step) => this._recordEscalation(step),
      previousStepDurationMs: (stepId) => {
        const d = this.stepDurations.get(stepId);
        return d?.endMs ? d.endMs - d.startMs : undefined;
      },
    };
  } /**
   * Phase 1: PLAN（U-22/S1 外移；实现在 `./lro/planPhase`，行为等价搬迁）。
   */
  async executePlanPhase(
    description: string,
    sessionId: string
  ): Promise<Plan> {
    return runPlanPhase(description, sessionId, {
      taskId: this.taskId,
      isolation: this.isolation,
      setPhase: (phase) => this.setPhase(phase),
      recordLifecycle: (phase, status, detail) =>
        this._recordLifecycle(phase as LifecyclePhase, status, detail),
      lastEscalations: this._lastEscalations,
      executor: this.executor,
      resolveWorkspaceId: (sid) => taskOrchestrator.resolveWorkspaceId(sid),
      createPlan: (
        desc,
        steps,
        sid,
        existingTaskIds,
        acceptance,
        workspaceId,
        dependsOn
      ) =>
        taskOrchestrator.createPlan(
          desc,
          steps,
          sid,
          existingTaskIds,
          acceptance,
          workspaceId,
          dependsOn
        ),
      setPlanId: (planId) => {
        this.planId = planId;
      },
    });
  }

  // ─── Phase 2: EXECUTE ──────────────────────────────

  async executeAllSteps(): Promise<Plan> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    await this.setPhase('execute');
    const plan = taskOrchestrator.getPlan(this.planId)!;
    plan.status = 'running';

    // D2（M3，2026-08-13）：无依赖步骤批次并行（依赖 step.dependsOn 拓扑分组）
    const batches = this._groupStepsByDependency(plan.steps);
    for (const batch of batches) {
      if (this.isolation.abortController.signal.aborted) break;

      // 依赖失败阻断（与 PlanDrivenLoop 的 computeTopoSkips 同语义）：
      // 前置步骤 failed/cancelled ⇒ 后继不得基于失败输入"成功"，直接终态为 cancelled。
      const blocked = batch.filter((s) =>
        (s.dependsOn ?? []).some((depId) => {
          const dep = plan.steps.find((p) => p.id === depId);
          return (
            !!dep && (dep.status === 'failed' || dep.status === 'cancelled')
          );
        })
      );
      for (const s of blocked) {
        s.status = 'cancelled';
        s.error = `[DEPENDENCY_BLOCKED] 前置步骤未成功（${(s.dependsOn ?? []).join(', ')}）`;
        logger.warn('[orchestrator] 前置步骤未成功，跳过本步', {
          taskId: this.taskId,
          stepId: s.id,
          stepDesc: s.description.slice(0, 60),
          dependsOn: s.dependsOn,
        });
      }
      if (blocked.length > 0) await this._persistCheckpoint();

      const runnable = batch.filter(
        (s) =>
          s.status !== 'completed' &&
          s.status !== 'failed' &&
          s.status !== 'cancelled'
      );
      if (runnable.length === 0) continue;

      // 并行前提：每步独立 TAORLoop 实例（工厂注入），杜绝共享实例状态串扰
      const canParallel = runnable.length > 1 && !!this.taorLoopFactory;
      if (canParallel) {
        logger.info('[orchestrator] 无依赖步骤批次并行执行', {
          taskId: this.taskId,
          batchSize: runnable.length,
          stepIds: runnable.map((s) => s.id),
        });
        await Promise.allSettled(
          runnable.map((s) => this.executeSingleStep(s, plan))
        );
      } else {
        for (const step of runnable) {
          if (this.isolation.abortController.signal.aborted) break;
          await this.executeSingleStep(step, plan);
        }
      }
    }

    // 中止：**不得**推进到 review（否则 phase=review 会覆盖 abort 终态，
    // 使 getStatus()/checkpoint 显示"仍在执行"）
    if (this.isolation.abortController.signal.aborted) {
      await this._persistCheckpoint();
      return plan;
    }

    // 检查全部完成
    await this.setPhase('review');
    // OBS/C3（2026-09-06）：链条 C 阶段广播——此前 review/decide 从不发 pdca:stage 事件，
    // 前端 C/A 胶囊永不亮（快路径单步无审查属设计；经典链须能显示）
    void emitPdcaLiveEvent(
      'pdca:stage:phase',
      {
        taskId: this.taskId,
        planId: this.planId ?? undefined,
        sessionId: this._sessionId ?? '',
      },
      {
        stage: 'review',
        status: 'running',
        message: '步骤审查与决策',
        // 进度口径：真正终态为 completed 的步骤数（此前误用 stepDurations.size —— 步骤**开始**即计入）
        completedSteps: plan.steps.filter((s) => s.status === 'completed')
          .length,
        totalSteps: plan.steps.length,
      }
    );
    return taskOrchestrator.getPlan(this.planId)!;
  } /** 步骤拓扑批次分组（U-22/S1 外移；实现在 `./lro/plannerSupport`）。 */
  private _groupStepsByDependency(steps: PlanStep[]): PlanStep[][] {
    return groupStepsByDependency(steps);
  }

  /** U-22/S1：planner 修复依赖（每次调用重建，全部为轻量引用） */
  private plannerRepairDeps(): PlannerRepairDeps {
    return {
      taskId: this.taskId,
      executor: this.executor,
      isolation: this.isolation,
    };
  }

  /**
   * §5 P2: 任务事件广播（/v1/events 常驻事件总线，前端 sseService.on 订阅）
   * 动态 import 避免启动期循环依赖；广播失败不影响任务执行
   */
  private async _emitTaskEvent(
    event: 'task:progress' | 'task:completed' | 'task:error',
    payload: Record<string, unknown>
  ): Promise<void> {
    // spec §44：实现外迁 `./lro/taskMessaging`；此处仅注入宿主状态（调用点不变）
    await emitTaskEvent(this.taskId, event, payload);
  }

  private _createToolContext(): ToolUseContext {
    return createToolContext({
      abortController: this.isolation.abortController,
      sessionId: this._sessionId,
      workspace: this.isolation.workspace,
    });
  } /** Planner JSON 修复重问（U-22/S1 外移；实现在 `./lro/plannerSupport`）。 */
  private async _repairPlanJson(
    description: string,
    originalOutput: string,
    reason: string
  ): Promise<PlanDraft | undefined> {
    return repairPlanJson(
      this.plannerRepairDeps(),
      description,
      originalOutput,
      reason
    );
  } /** 验收标准一次纠正（U-22/S1 外移；实现在 `./lro/plannerSupport`）。 */
  private async _repairAcceptanceCriteria(
    description: string,
    steps: readonly string[],
    offending: readonly string[]
  ): Promise<string[] | undefined> {
    return repairAcceptanceCriteria(
      this.plannerRepairDeps(),
      description,
      steps,
      offending
    );
  } /** 写后读回（U-22/S1 外移；实现在 `./lro/stepArtifacts`）。 */
  private async _readBackWrittenArtifacts(
    written: ReadonlySet<string>,
    alreadyRead: ReadonlySet<string>
  ): Promise<string> {
    return readBackWrittenArtifacts(
      this.stepArtifactsDeps(),
      written,
      alreadyRead
    );
  }

  /** U-22/S1：步骤产物依赖（每次调用重建；缺陷清单与宿主共享） */
  private stepArtifactsDeps(): StepArtifactsDeps {
    return {
      taskId: this.taskId,
      createToolContext: () => this._createToolContext(),
      persistCheckpoint: () => this._persistCheckpoint(),
      lastEscalations: this._lastEscalations,
    };
  }

  private _emitTaskMessage(msgs: TaskMessage[]): void {
    emitTaskMessage({
      taskId: this.taskId,
      sessionId: this._sessionId,
      onTaskMessage: this._onTaskMessage,
      msgs,
    });
  }

  /** U-22/S2b（2026-10-17）：实现外移 `./lro/stepExecution`；此处仅注入宿主状态。 */
  private async executeSingleStep(step: PlanStep, plan: Plan): Promise<void> {
    return executeSingleStep(step, plan, this.stepExecutionDeps());
  }

  /** U-22/S2b：步骤执行依赖（每次调用重建；可变状态经共享引用/回调回写宿主） */
  private stepExecutionDeps(): StepExecutionDeps {
    return {
      taskId: this.taskId,
      isolation: this.isolation,
      executor: this.executor,
      createToolContext: () => this._createToolContext(),
      getSharedLoop: () => this.taorLoop,
      hasStepLoopFactory: !!this.taorLoopFactory,
      createStepLoop: (taskId, opts) =>
        this.taorLoopFactory ? this.taorLoopFactory(taskId, opts) : undefined,
      registerStepLoop: (loop) => {
        this._activeStepLoops.add(loop);
        return () => {
          this._activeStepLoops.delete(loop);
        };
      },
      stepTurnsMultiplier: this._stepTurnsMultiplier,
      stepDurations: this.stepDurations,
      addTotalTokens: (tokens) => {
        this._totalTokensTracked += tokens;
      },
      readBackWrittenArtifacts: (written, alreadyRead) =>
        this._readBackWrittenArtifacts(written, alreadyRead),
      recordEscalation: (s) => this._recordEscalation(s),
      emitTaskMessage: (msgs) => this._emitTaskMessage(msgs),
      recordLifecycle: (phase, status, detail) =>
        this._recordLifecycle(phase, status, detail),
      persistCheckpoint: () => this._persistCheckpoint(),
      getPlanId: () => this.planId,
      getSessionId: () => this._sessionId,
    };
  } /** Phase 3: REVIEW（U-22/S3 外移；实现在 `./lro/stepReviewDecide`）。 */
  async reviewStep(stepId: string): Promise<PlanReview> {
    return reviewStep(stepId, this.stepReviewDeps());
  }

  async reviewAllSteps(): Promise<PlanReview[]> {
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const reviews: PlanReview[] = [];

    for (const step of plan.steps) {
      if (step.status !== 'completed') continue;

      const review = await this.reviewStep(step.id);
      reviews.push(review);
    }

    return reviews;
  } /** Phase 4: DECIDE（U-22/S3 外移；实现在 `./lro/stepReviewDecide`）。 */
  async decideStep(stepId: string, decision: ReviewDecision): Promise<void> {
    return decideStep(stepId, decision, this.stepReviewDeps());
  } /** escalate 缺陷捕获（U-22/S1 外移；实现在 `./lro/stepArtifacts`）。 */
  private async _recordEscalation(step: PlanStep): Promise<void> {
    return recordEscalation(this.stepArtifactsDeps(), step);
  } /** 自动决策（U-22/S3 外移；实现在 `./lro/stepReviewDecide`）。 */
  async autoDecideStep(stepId: string): Promise<ReviewDecision> {
    return autoDecideStep(stepId, this.stepReviewDeps());
  }

  // ─── 全流程自动化 ───────────────────────────────────

  /**
   * 运行完整 PDCA 流程：Plan → Execute → Review → Decide
   * 自动循环直到所有步骤完成或失败。
   */
  async runFullPdca(
    description: string,
    sessionId: string,
    opts?: {
      requirePlanApproval?: boolean;
      /** §5 P1: 任务消息回写回调（ChatManager._launchImplicitPdca 注入） */
      onTaskMessage?: (sessionId: string, msgs: TaskMessage[]) => void;
      /** U-02：`/goal start` 创建的目标 id（终态按 id 落定目标状态） */
      goalId?: string;
    }
  ): Promise<PdcaStatus> {
    // §5 P1: 记录回写目标会话与回调，供 executeSingleStep 使用
    this._sessionId = sessionId;
    this._goalId = opts?.goalId;
    this._onTaskMessage = opts?.onTaskMessage;
    this._startedAt = Date.now();
    const requireApproval = opts?.requirePlanApproval ?? false;

    logger.info('[orchestrator] runFullPdca 开始', {
      taskId: this.taskId,
      sessionId,
      hasTAORLoop: !!this.taorLoop,
      hasOnTaskMessage: !!opts?.onTaskMessage,
      requireApproval,
      descPreview: description.slice(0, 80),
    });

    // Plan
    const plan = await this.executePlanPhase(description, sessionId);
    await this.setPhase('plan');
    // OBS/C3（2026-09-06）：链条 P 阶段 start 广播（快路径由 PlanDrivenLoop 发；链条补位）
    void emitPdcaLiveEvent(
      'pdca:stage:start',
      {
        taskId: this.taskId,
        planId: this.planId ?? undefined,
        sessionId,
      },
      { stage: 'plan', status: 'started', totalSteps: plan.steps.length }
    );

    // 计划前置审批：在 EXECUTE 前插入审批断点
    if (requireApproval) {
      // U-02（2026-10-19）：无人值守模式 ⇒ 计划自动通过。
      // `UnattendedModeManager` 文档早已承诺该语义，但主路径此前未接线 ⇒ 全自动流程
      // 仍会停在审批点。动态导入避免 tasks ↔ runtime 的静态环。
      const { unattendedMode } =
        await import('@modules/runtime/UnattendedModeManager.js');
      if (
        shouldAutoApprovePlan(
          requireApproval,
          unattendedMode.shouldAutoApprove()
        )
      ) {
        logger.info(
          '[orchestrator] 无人值守模式：计划自动通过（跳过审批断点）',
          {
            taskId: this.taskId,
            planId: this.planId,
            stepCount: plan.steps.length,
          }
        );
      } else {
        await this.setPhase('plan_pending');

        // 提交到 Inbox
        const planSummary = plan.steps
          .map((s, i) => `  ${i + 1}. ${s.description}`)
          .join('\n');
        const inboxItem = await inboxManager.submit({
          sessionId,
          type: 'approval',
          title: `PDCA 计划审批: ${description.substring(0, 50)}`,
          message: `目标: ${description}\n\n步骤:\n${planSummary}\n\n共 ${plan.steps.length} 步`,
          options: ['approve', 'reject', 'modify'],
          offlineCapable: true,
          source: 'pdca',
          metadata: { planId: this.planId, taskId: this.taskId, description },
        });

        logger.info('Plan submitted for approval', {
          taskId: this.taskId,
          planId: this.planId,
          inboxId: inboxItem.id,
        });

        return {
          taskId: this.taskId,
          planId: this.planId!,
          phase: 'plan_pending',
          plan,
          awaitUserDecision: true,
          decisionPrompt: `计划已生成，等待审批。\n\n用 /goal approve ${this.taskId} 批准，或 /goal reject ${this.taskId} 拒绝。\nInbox ID: ${inboxItem.id}`,
          lifecycle: this.lifecycle.getHistory(),
        };
      }
    }

    return this._runExecuteDecideLoop();
  }

  // ─── 报告 ───────────────────────────────────────────

  /** 报告投影所需的宿主状态只读快照（spec §46） */
  private reportView(): PdcaReportView {
    return {
      taskId: this.taskId,
      planId: this.planId,
      phase: this.phase,
      decisionAwait: this.decisionAwait,
      auditReport: this.auditReport,
      lifecycle: this.lifecycle.getHistory(),
      stepDurations: this.stepDurations,
    };
  }

  generateReport(): AuditReport {
    return renderAuditReport(this.reportView());
  }

  /**
   * BUG 修复: 将审计报告持久化到文件，重启后可恢复。
   * 保存路径: ~/.pyapp/data/task-audits/{taskId}.json
   */
  private persistAuditReport(report: AuditReport): void {
    persistAuditReportFile(report);
  }

  // ─── 状态查询 ───────────────────────────────────────

  getStatus(): PdcaStatus {
    return projectPdcaStatus(this.reportView());
  }

  /** 获取 PDCA 监控指标 */
  getMetrics(): PdcaMetrics {
    return projectPdcaMetrics(this.reportView());
  }

  /**
   * D4（M4，2026-08-13）：TAORLoop token 累计值（阶段边界结算 → 成本护栏数据源）
   * 供 StageOrchestrator 在每阶段结束时显式回写父级 totalTokens。
   */
  getTokenUsage(): number {
    return this._totalTokensTracked;
  }

  /**
   * 审批通过后从 plan_pending 阶段恢复执行
   * 继续 PDCA 的 EXECUTE → REVIEW → DECIDE 循环
   *
   * L3（跨重启）：进程重启后新实例 phase 为默认值（'plan'），若 checkpoint
   * 持久化了 plan_pending（审批挂起），先经 resumeFromCheckpoint 恢复再审批，
   * 否则抛 PDCA_NOT_PENDING（原实现跨重启后审批恢复必然失败）。
   */
  async resumeAfterApproval(sessionId: string): Promise<PdcaStatus> {
    // PR-5（2026-10-23）：**步骤级审批挂起**（stage_awaiting_approval）——
    // 把挂起步骤置回 pending（清 decision，保留证据），再复用统一执行循环续跑。
    if (this.phase === 'stage_awaiting_approval') {
      const resumed = resumeSuspendedSteps(this.requirePlan());
      if (resumed.length === 0) {
        throw new AppError(
          'Orchestrator is not awaiting step approval',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          'PDCA_NOT_PENDING'
        );
      }
      await this.setPhase('execute');
      await this._persistCheckpoint();
      logger.info('Step approval granted, resuming PDCA execution', {
        taskId: this.taskId,
        planId: this.planId,
        sessionId,
        resumedSteps: resumed,
      });
      return this._runExecuteDecideLoop();
    }

    if (this.phase !== 'plan_pending') {
      const ck = await readPdcaCheckpoint(this.taskId);
      if (ck && ck.phase === 'plan_pending') {
        logger.info('跨重启审批恢复：从 checkpoint 恢复 plan_pending', {
          taskId: this.taskId,
          sessionId,
        });
        await this.resumeFromCheckpoint(ck as Record<string, unknown>);
      }
    }

    if (this.phase !== 'plan_pending') {
      throw new AppError(
        'Orchestrator is not in plan_pending phase',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PDCA_NOT_PENDING'
      );
    }

    await this.setPhase('execute');
    logger.info('Plan approved, resuming PDCA execution', {
      taskId: this.taskId,
      planId: this.planId,
    });

    // 继续 EXECUTE → REVIEW → DECIDE 循环（复用统一执行循环，P0 抽取去重）
    return this._runExecuteDecideLoop();
  }

  /**
   * P1-2（2026-08-31）：turn 预算上限解析（L8 抽公共函数，2026-09-06）——
   * 动态兜底（步骤数*5，最少 20）防误杀；显式配置 TASK_GOAL_MAX_TURNS 时优先作硬上限。
   */
  private _resolvePdcaMaxIterations(stepCount: number): number {
    const dynamicMax = Math.max(20, stepCount * 5);
    const configuredMax = Number(configManager.env('TASK_GOAL_MAX_TURNS')) || 0;
    return configuredMax > 0 ? configuredMax : dynamicMax;
  }

  /** U-04：计划步骤数上限（默认 10，`TASK_GOAL_MAX_STEPS` 可覆盖）。 */
  private resolveMaxPlanSteps(): number {
    const raw = Number(configManager.env('TASK_GOAL_MAX_STEPS')) || 0;
    return raw > 0 ? raw : 10;
  }

  /** U-04：连续无进展轮数阈值（默认 3，`TASK_GOAL_STALL_ROUNDS` 可覆盖）。 */
  private resolveStallRounds(): number {
    const raw = Number(configManager.env('TASK_GOAL_STALL_ROUNDS')) || 0;
    return raw > 0 ? raw : 3;
  }

  /**
   * P0(M2/M9)：统一 EXECUTE → REVIEW → DECIDE 循环。
   * 从 runFullPdca 与 resumeAfterApproval 的后半段抽取（两处原为重复实现）。
   * resumeFromCheckpoint 跨重启恢复后同样进入此循环继续执行。
   */
  /**
   * 1-1e（2026-09-03）review/decision 时序语义（dependsOn 填充后生效）：
   * - executeAllSteps 单轮内按 `_groupStepsByDependency` 拓扑批次顺序执行全部批次
   *   （批次内依赖满足才并行、批次间串行 await）→ A→B→C 链在同一轮即全部完成
   *   （依赖满足即推进）；并非"每轮只跑一个依赖层"。
   * - Review+Decide 在每轮 executeAllSteps 之后批量进行：仅对 `completed && !decision`
   *   步骤 autoDecideStep（幂等，approved/failed 不重审）。需多轮的场景 = review 判 retry
   *   （清 decision + 置回 pending，下轮重跑）或 escalate 后 replan。
   * - 收敛有界：每轮仅 retry 步骤重入 runnable，每步重试 ≤ maxRetries，受 maxIterations 兜底。
   * - ⚠ 勿假设"每步执行完立即 Review"——决策以 executeAllSteps 轮尾批量进行、时机随批次漂移。
   */
  private async _runExecuteDecideLoop(): Promise<PdcaStatus> {
    let allDone = false;
    let iterations = 0;
    // P1/L8（2026-09-06）：上限随最新 plan 每轮重算——replan/escalate 会替换 plan.steps
    // （D5 增量 replan），入口只算一次会在步骤增多后被旧上限误杀（技术报告 E4/P3）。
    // 当前无 replan 时 steps 数每轮恒定 → 上限不变，行为兼容；仅替换后才发生"上限重算"。
    let maxIterations = 0;
    const resolveMaxIterations = (): number => {
      const cap = this._resolvePdcaMaxIterations(
        this.requirePlan().steps.length
      );
      if (cap !== maxIterations) {
        logger.info('[orchestrator] PDCA 轮次上限重算', {
          taskId: this.taskId,
          planId: this.planId,
          prev: maxIterations,
          next: cap,
        });
      }
      this._maxTurns = cap; // 同步 stage metric（_recordGoalStageMetric maxTurns）
      return cap;
    };
    maxIterations = resolveMaxIterations();

    // U-04（2026-10-17）：连续无进展硬停止。
    let lastFingerprint = '';
    let stallRounds = 0;
    const stallThreshold = this.resolveStallRounds();
    // 终态裁决（2026-10-17）：记录"为何以失败退出"，供循环外区分
    // completed / failed / escalate，避免失败出口被无条件写成 completed。
    let failureReason: string | null = null;

    while (!allDone && iterations < maxIterations) {
      iterations++;
      // P1/L8：每轮以最新 plan 重算（replan 后新 steps 当轮即生效）
      maxIterations = resolveMaxIterations();

      // U-04：准入校验（含 replan 后的计划）——坏计划不进入执行。
      const admission = validatePlanAdmission(this.requirePlan(), {
        maxSteps: this.resolveMaxPlanSteps(),
      });
      if (!admission.ok) {
        const badPlan = this.requirePlan();
        badPlan.status = 'failed';
        badPlan.completedAt = new Date().toISOString();
        taskOrchestrator['savePlan']?.(badPlan);
        void handleError(
          new AppError(
            `计划未通过准入校验：${admission.reason}`,
            ErrorCategory.VALIDATION,
            ErrorSeverity.HIGH,
            'PLAN_ADMISSION_REJECTED',
            {
              taskId: this.taskId,
              planId: this.planId,
              reason: admission.reason,
              steps: badPlan.steps.map((s) => s.id),
            }
          ),
          { module: 'tasks:longRunning', action: 'planAdmission' }
        );
        failureReason = 'PLAN_ADMISSION_REJECTED';
        break;
      }

      // Execute
      await this.executeAllSteps();

      // Review + Decide
      const updatedPlan = this.requirePlan();
      for (const step of updatedPlan.steps) {
        if (step.status === 'completed' && !step.decision) {
          await this.autoDecideStep(step.id);
        }
      }

      // 重新检查状态：所有步骤是否都为终态
      const latestPlan = this.requirePlan();
      const terminalStatuses = ['completed', 'failed', 'cancelled'] as const;
      allDone = latestPlan.steps.every((s) =>
        (terminalStatuses as readonly string[]).includes(s.status)
      );

      logger.info('[orchestrator] PDCA 迭代完成', {
        taskId: this.taskId,
        planId: this.planId,
        iteration: iterations,
        maxIterations,
        allDone,
        stepStatuses: latestPlan.steps.map((s) => ({
          id: s.id,
          status: s.status,
          decision: s.decision,
          retryCount: s.retryCount,
        })),
        hasRetry:
          !allDone &&
          latestPlan.steps.some(
            (s) => s.status === 'pending' && s.decision === undefined
          ),
      });

      // U-04（2026-10-17）：连续 N 轮指纹不变 ⇒ 硬停止（避免原地重试耗尽配额）。
      if (!allDone) {
        const fingerprint = computeProgressFingerprint(latestPlan);
        const previous = lastFingerprint;
        if (previous && previous === fingerprint) {
          stallRounds++;
        } else {
          stallRounds = 0;
          lastFingerprint = fingerprint;
        }
        if (
          previous &&
          shouldStopForStall(previous, fingerprint, stallRounds, stallThreshold)
        ) {
          latestPlan.status = 'failed';
          latestPlan.completedAt = new Date().toISOString();
          taskOrchestrator['savePlan']?.(latestPlan);
          void handleError(
            new AppError(
              `PDCA 连续 ${stallRounds} 轮无进展，已硬停止`,
              ErrorCategory.OPERATION,
              ErrorSeverity.HIGH,
              'PDCA_NO_PROGRESS',
              {
                taskId: this.taskId,
                planId: this.planId,
                iterations,
                stallRounds,
                stallThreshold,
                stepStatuses: latestPlan.steps.map((s) => ({
                  id: s.id,
                  status: s.status,
                  decision: s.decision,
                  retryCount: s.retryCount,
                })),
              }
            ),
            { module: 'tasks:longRunning', action: 'stallStop' }
          );
          failureReason = 'PDCA_NO_PROGRESS';
          break;
        }
      } else {
        stallRounds = 0;
        lastFingerprint = '';
      }

      // P1-3（2026-08-31）：目标级收敛判定（对标 Hermes evaluate_after_turn）
      // 步骤全部终态后，用副模型确认"整体目标是否真正达成"；未收敛则阻止
      // "步骤全过但目标未实现"的假完成（转 failed，缺陷清单驱动增量 replan）。
      // PR-5（2026-10-23）：整段外移 `./lro/goalConvergence`（守住 R04-001 行数上限），
      // 语义逐字未变；宿主只按 `kind` 分派控制流。
      if (allDone) {
        const convergence = await runGoalConvergenceGate({
          taskId: this.taskId,
          planId: this.planId,
          sessionId: this._sessionId,
          plan: latestPlan,
          gate: this.goalEvaluateGate,
          ctx: { isolation: this.isolation, executor: this.executor },
          totalTokens: this._totalTokensTracked,
          turnsExtensions: this._turnsExtensions,
          startedAt: this._startedAt,
          setGoalEvaluation: (value) => {
            this._goalEvaluation = value;
          },
          resumeFromCheckpoint: (ck) => this.resumeFromCheckpoint(ck),
        });
        if (convergence.kind === 'replanned') return convergence.status;
        if (convergence.kind === 'unconverged') {
          failureReason = convergence.failureReason;
          allDone = false;
          break;
        }
      }

      if (!allDone) {
        // 有步骤需要重试
        const hasRetry = latestPlan.steps.some(
          (s) => s.status === 'pending' && s.decision === undefined
        );
        if (!hasRetry && iterations >= maxIterations) {
          // 超过上限：保存现场后强制退出
          latestPlan.status = 'failed';
          latestPlan.completedAt = new Date().toISOString();
          taskOrchestrator['savePlan']?.(latestPlan);
          void handleError(
            new AppError(
              'PDCA exceeded max iterations, forced abort',
              ErrorCategory.OPERATION,
              ErrorSeverity.HIGH,
              'PDCA_MAX_ITERATIONS',
              {
                taskId: this.taskId,
                planId: this.planId,
                iterations,
                maxIterations,
                steps: latestPlan.steps.map((s) => ({
                  id: s.id,
                  status: s.status,
                  decision: s.decision,
                })),
              }
            ),
            { module: 'tasks:longRunning', action: 'runFullPdca' }
          );
          failureReason = 'PDCA_MAX_ITERATIONS';
          break;
        }
      }
    }

    // PR-5（2026-10-23）：**步骤级审批挂起** ⇒ 早退，不落 completed/failed。
    // 判定放在终态裁决（含轮次上限、目标评估）之前：等审批既不是"完成"也不是"失败"。
    const suspendedStatus = await suspendPlanForApproval({
      taskId: this.taskId,
      planId: this.planId,
      plan: this.requirePlan(),
      setPhase: (phase) => this.setPhase(phase),
      persistCheckpoint: () => this._persistCheckpoint(),
      getStatus: () => this.getStatus(),
    });
    if (suspendedStatus) return suspendedStatus;

    // 循环因轮次上限自然退出（仍有待重试步骤）同样属失败退出
    if (!allDone && !failureReason) {
      failureReason = 'PDCA_MAX_ITERATIONS';
      const cappedPlan = this.requirePlan();
      cappedPlan.status = 'failed';
      cappedPlan.completedAt = new Date().toISOString();
      taskOrchestrator['savePlan']?.(cappedPlan);
    }

    // ── 终态裁决（2026-10-17 根因修复）────────────────────────────
    // 旧实现：除中止外**一律**落 `setPhase('completed')` ⇒ 准入拒绝 / 停滞 /
    // 目标未收敛 / 超轮次 / escalate 在用户与上游（WorkItem、StageOrchestrator、
    // /goal list）眼里都是"成功"，且 escalate 写下的 replanPending 立即被覆盖失效。
    if (this.isolation.abortController.signal.aborted) {
      // 中止收尾——plan 置 aborted（不标 completed/failed）。
      // abort() 已完成 checkpoint/lifecycle/指标收尾，此处只返回状态。
      const abortedPlan = this.requirePlan();
      abortedPlan.status = 'aborted';
      abortedPlan.completedAt = new Date().toISOString();
      taskOrchestrator['savePlan']?.(abortedPlan);
      // U-02：用户中止 ⇒ 目标落 cancelled（避免目标长期 active 却被续接误唤醒）
      await settleGoalById({
        goalId: this._goalId,
        status: 'cancelled',
        reason: 'user_aborted',
      });
      return this.getStatus();
    }

    const finalPlan = this.requirePlan();
    // escalate 只在"全部步骤终态 + 某步决策为 escalate"时成立（与旧语义一致）；
    // 停滞/准入/超轮次等中途失败一律走 failed 终态，不得借 escalate 保留可续跑状态。
    const hasEscalated =
      allDone && finalPlan.steps.some((s) => s.decision === 'escalate');
    const succeeded = allDone && !hasEscalated;
    finalPlan.status = succeeded ? 'completed' : 'failed';
    finalPlan.completedAt = new Date().toISOString();
    taskOrchestrator['savePlan']?.(finalPlan);

    // U-02（2026-10-19）：PDCA 终态 ↔ 目标状态（按 goalId 精确落定，无 goalId ⇒ no-op）。
    // escalate 属"未达成但可续跑"⇒ blocked（非终态，replan 后可继续）。
    await settleGoalById({
      goalId: this._goalId,
      status: hasEscalated ? 'blocked' : succeeded ? 'completed' : 'failed',
      reason: hasEscalated
        ? 'batch_blocked'
        : succeeded
          ? 'batch_completed'
          : 'batch_failed',
    });

    if (hasEscalated) {
      // PR5（#6，2026-09-05）：escalate 收尾 → checkpoint 写 replanPending /
      // replanFailCount（半自动闭环，决策 4/6/7）。计数持久化、跨 resume/重启累计；
      // 达上限 replanPending=false（转人工介入），resume 入口据此拒绝（见 resumeFromCheckpoint）。
      // **2026-10-17**：此分支**不**调用 setPhase —— phase 必须保持 execute 且
      // status=failed，否则 replanPending 会被终态覆盖，半自动 replan 永远无法被 resume。
      const prevCk = (await readPdcaCheckpoint(this.taskId)) ?? {};
      const prevFail = Number(prevCk.replanFailCount) || 0;
      const next = prevFail + 1;
      const maxReplan = replanMaxRetries();
      const replanPending = next < maxReplan;
      await writePdcaCheckpoint(this.taskId, {
        taskId: this.taskId,
        phase: 'execute',
        status: 'failed',
        replanPending,
        replanFailCount: next,
        replanConvergedAt: replanPending ? undefined : new Date().toISOString(),
      });
      logger.info('[orchestrator] escalate 收尾（半自动 replan）', {
        taskId: this.taskId,
        replanFailCount: next,
        maxReplan,
        replanPending,
      });
    } else if (!succeeded) {
      await this.setPhase('failed');
    }

    if (!succeeded) {
      return this.finalizeFailedPdca(failureReason, hasEscalated);
    }

    // 生成审计报告
    await this.setPhase('completed');
    this.auditReport = this.generateReport();
    this.persistAuditReport(this.auditReport);
    this._recordLifecycle('finalized', TaskStatus.COMPLETED, 'PDCA completed');
    // S2（2026-08-13）：阶段边界落库 goal_metrics（row_type='stage'）
    // T-②02：落库后读回按 turn 预算消耗速率判定目标偏差（顺序保证见 _evaluateGoalDeviation）
    void this._recordGoalStageMetric('pdca_completed').then(() =>
      this._evaluateGoalDeviation()
    );
    // 3-1（2026-09-03）：PDCA 完成 → 轻量记忆回写（复盘决策入长期记忆，供跨会话 recall）
    this._persistMemoryFromAudit('completed');
    // 方向4（2026-09-03）：终态落评估样例（任务级评估集）
    this._persistReviewSample('pdca_completed');
    // T-②06：终态收口点触发经验自动演化（聚合式；防抖见 AdaptationEvolutionService）
    this._runAdaptationEvolution();

    // §5 P2: 任务完成事件广播（前端按 sessionId 过滤渲染）
    const _finalStatus = this.getStatus();
    void this._emitTaskEvent('task:completed', {
      sessionId: this._sessionId ?? '',
      planId: this.planId,
      status: _finalStatus.phase,
    });
    // OBS（M1b）：经典链终态 → pdca:stage:complete（独立通道，非会话消息）
    void emitPdcaLiveEvent(
      'pdca:stage:complete',
      {
        taskId: this.taskId,
        planId: this.planId ?? undefined,
        sessionId: this._sessionId ?? '',
      },
      {
        stage: 'execute',
        status: 'completed',
        tokenCost: this._totalTokensTracked,
        message: 'PDCA 完成',
      }
    );

    return _finalStatus;
  }

  /**
   * 失败/升级终态收尾（2026-10-17 根因修复）。
   *
   * 旧实现把所有非中止出口都当成功收尾 ⇒ 失败被伪装为"已完成"。
   * 本方法只做失败语义：审计落盘 + FAILED 生命周期 + 失败事件；
   * **不**写"已完成"记忆与完成样例（CS04：不制造假成果）。
   */
  private async finalizeFailedPdca(
    failureReason: string | null,
    hasEscalated: boolean
  ): Promise<PdcaStatus> {
    const failedStatus = this.getStatus();
    this.auditReport = this.generateReport();
    this.persistAuditReport(this.auditReport);
    this._recordLifecycle(
      'finalized',
      TaskStatus.FAILED,
      hasEscalated
        ? 'PDCA escalated (replan pending)'
        : `PDCA failed: ${failureReason ?? 'unknown'}`
    );
    void this._recordGoalStageMetric('pdca_failed').then(() =>
      this._evaluateGoalDeviation()
    );
    void this._emitTaskEvent('task:error', {
      sessionId: this._sessionId ?? '',
      planId: this.planId,
      status: failedStatus.phase,
      reason: hasEscalated ? 'escalated' : failureReason,
    });
    void emitPdcaLiveEvent(
      'pdca:stage:complete',
      {
        taskId: this.taskId,
        planId: this.planId ?? undefined,
        sessionId: this._sessionId ?? '',
      },
      {
        stage: 'execute',
        status: 'failed',
        tokenCost: this._totalTokensTracked,
        message: hasEscalated
          ? 'PDCA escalate（待 replan）'
          : `PDCA 失败：${failureReason ?? 'unknown'}`,
      }
    );
    return failedStatus;
  }

  /**
   * 从 checkpoint 跨重启恢复（U-22/S1 外移；实现在 `./lro/resumeFromCheckpoint`）。
   */
  async resumeFromCheckpoint(ck: Record<string, unknown>): Promise<PdcaStatus> {
    return resumeFromCheckpoint(ck, {
      taskId: this.taskId,
      executePlanPhase: (description, sessionId) =>
        this.executePlanPhase(description, sessionId),
      runExecuteDecideLoop: () => this._runExecuteDecideLoop(),
      getStatus: () => this.getStatus(),
      setPhase: (phase) => this.setPhase(phase),
      recordLifecycle: (phase, status, detail) =>
        this._recordLifecycle(phase as LifecyclePhase, status, detail),
      persistCheckpoint: () => this._persistCheckpoint(),
      resolveWorkspaceId: (sessionId) =>
        taskOrchestrator.resolveWorkspaceId(sessionId),
      createPlan: (
        description,
        steps,
        sessionId,
        existingTaskIds,
        acceptanceCriteria,
        workspaceId
      ) =>
        taskOrchestrator.createPlan(
          description,
          steps,
          sessionId,
          existingTaskIds,
          acceptanceCriteria,
          workspaceId
        ),
      getLastEscalations: () => this._lastEscalations,
      setLastEscalations: (value) => {
        this._lastEscalations = value;
      },
      getTurnsExtensions: () => this._turnsExtensions,
      setTurnsExtensions: (value) => {
        this._turnsExtensions = value;
      },
      getStepTurnsMultiplier: () => this._stepTurnsMultiplier,
      setStepTurnsMultiplier: (value) => {
        this._stepTurnsMultiplier = value;
      },
      setPlanId: (planId) => {
        this.planId = planId;
      },
      setSessionId: (sessionId) => {
        this._sessionId = sessionId;
      },
      setTotalTokensTracked: (value) => {
        this._totalTokensTracked = value;
      },
      setStartedAt: (value) => {
        this._startedAt = value;
      },
    }) as Promise<PdcaStatus>;
  }

  /**
   * 获取 Plan，若已被外部删除则自动 dispose 并抛错
   */
  private requirePlan(): Plan {
    if (!this.planId) {
      throw new AppError(
        'No plan associated with this orchestrator',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PDCA_NO_PLAN'
      );
    }
    const plan = taskOrchestrator.getPlan(this.planId);
    if (!plan) {
      // Plan 已被删除，清理自身
      this.dispose();
      throw new AppError(
        `Plan ${this.planId} no longer exists, orchestrator disposed`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PDCA_PLAN_DELETED'
      );
    }
    return plan;
  }

  /** S4（PR9，③）：会话级联中止用（_closeSessionPdca 过滤本会话 orchestrators） */
  getSessionId(): string | null {
    return this._sessionId;
  }

  // ─── 生命周期 ───────────────────────────────────────

  async abort(): Promise<void> {
    this.isolation.abort('User aborted');
    // 2026-10-17 修复：内存 phase 同步终态。原实现只写 checkpoint，
    // `getStatus()`（读 this.phase）在中止后仍显示 execute/review ⇒ 上游以为任务仍在跑。
    this.phase = 'abort';
    const plan = this.planId
      ? taskOrchestrator.getPlan(this.planId)
      : undefined;
    if (plan) {
      plan.status = 'aborted';
      plan.completedAt = plan.completedAt ?? new Date().toISOString();
      taskOrchestrator['savePlan']?.(plan);
    }
    // 2026-10-17 修复：并行批次可能有多个在飞私有 loop ⇒ **逐个**中止
    // （原单槽 `_currentLoop` 只覆盖最后一个，其余继续真实模型调用/工具执行）。
    for (const loop of this._activeStepLoops) {
      try {
        void loop.abort();
      } catch (err) {
        void handleError(err, {
          module: 'tasks:longRunning',
          action: 'abortActiveLoop',
          context: { taskId: this.taskId },
        });
      }
    }
    this._activeStepLoops.clear();
    this._recordLifecycle('finalized', TaskStatus.FAILED, 'Aborted by user');
    // Gap D（1-0c，2026-09-03）：中止必须落 checkpoint 终态。
    // 原实现仅落库 goal_metrics、不写 checkpoint → phase 停留中止前值，
    // /goal list（按 phase∈completed/failed/abort 过滤）不过滤、scan 不回收该任务。
    // 注：LRTO.PdcaPhase 不含 'abort'（bridge 层类型含），此处直接写 checkpoint 文件。
    await writePdcaCheckpoint(this.taskId, {
      phase: 'abort',
      status: 'abort',
      abortedAt: new Date().toISOString(),
    });
    await syncPdcaWorkItemStatus(this.taskId, 'abort');
    // S2（2026-08-13）：中止路径同样落库（超时/失败节点）
    // T-②02：同上，中止路径也做偏差判定（不因中止跳过可观测面）
    void this._recordGoalStageMetric('pdca_aborted').then(() =>
      this._evaluateGoalDeviation()
    );
    // 3-1（2026-09-03）：PDCA 中止 → 轻量记忆回写（记录已执行部分与中止状态）
    this._persistMemoryFromAudit('aborted');
    // 方向4（2026-09-03）：终态落评估样例（任务级评估集）
    this._persistReviewSample('pdca_aborted');
    // T-②06：中止路径同样触发演化（不因中止跳过可观测/演化面）
    this._runAdaptationEvolution();
    // OBS（M2）：中止/取消 → pdca:stage:complete（status cancelled，独立通道；
    // 会话摘要落盘按设计只在终态——此处为纯实时事件，摘要由消费端/UI 决定）
    void emitPdcaLiveEvent(
      'pdca:stage:complete',
      {
        taskId: this.taskId,
        planId: this.planId ?? undefined,
        sessionId: this._sessionId ?? '',
      },
      {
        stage: 'execute',
        status: 'cancelled',
        tokenCost: this._totalTokensTracked,
        message: '用户中止',
      }
    );
  }

  /**
   * S2（2026-08-13）：阶段边界落库 goal_metrics（row_type='stage'，P1-5 §5 S2 + StageOrchestrator §4.6）
   * 仅在真实任务完成/中止时记录；写入失败不阻断主流程（fire-and-forget + handleError 降级日志）。
   */
  private _recordGoalStageMetric(stageId: string): Promise<void> {
    const metrics = this.getMetrics();
    // spec §45：实现外迁 `./lro/terminalHooks`；此处仅注入宿主状态（调用点不变）。
    // 返回值供终态收口点串接**偏差判定**（T-②02：落库 → 读回 → 判定，顺序由调用方保证）
    return recordGoalStageMetric({
      taskId: this.taskId,
      sessionId: this._sessionId,
      stageId,
      maxTurns: this._maxTurns,
      totalSteps: metrics.totalSteps,
      totalTokens: this._totalTokensTracked,
      durationMs: this._startedAt > 0 ? Date.now() - this._startedAt : 0,
    });
  }

  /**
   * T-②06 阶段 2（2026-10-03）：PDCA 终态 ⇒ **经验自动演化**（聚合式，跨任务）。
   *
   * 读评审样本（`queryReviewSamples`）→ 归纳（LLM）→ 写回产物（提示覆盖层 / 技能侧车）
   * + 审计事件 `evolution/applied`（`.trae/specs/adaptation-writeback-evolution.md` §3.3）。
   *
   * **聚合语义**：读的是**全量历史失败样本**（不局限于本次任务）⇒ 与 `_persistReviewSample`
   * 的 fire-and-forget 之间**无需严格顺序**（本批样本可下次纳入；防抖保证不重复演化）。
   * 失败经 `handleError` 留痕，不阻断收尾（CS03）。
   */
  private _runAdaptationEvolution(): void {
    runAdaptationEvolutionHook({
      taskId: this.taskId,
      sessionId: this._sessionId,
    });
  }

  /**
   * T-②02（2026-10-03）：PDCA 终态**目标偏差判定**（`.trae/specs/goal-metrics-closure.md` T1/T2）。
   *
   * 只读查询 → 纯函数判定 → 落事件 + 结构化日志（不新增状态迁移）：
   *   ① 读 `goal_metrics` 的 stage 行（`queryStageMetrics`，补齐其**零生产消费方**）；
   *   ② `evaluateGoalDeviation`（纯函数，`tasks/review/GoalDeviation.ts`）算 turn 预算消耗速率；
   *   ③ 越既有阈值（`UNIFIED_THRESHOLDS`）⇒ `emitGoalDeviation` 落 `goal/deviation` + INFO 日志。
   *
   * **时机**：在 `_recordGoalStageMetric` 落库**之后**（从持久层读回真相，对齐 §1.6 Write-Ahead）
   * —— 故只在本文件两个终态点（completed / aborted）串接调用。
   * 失败经 `handleError` 统一留痕，**不阻断**主流程（CS03：观测面失败不反灌业务）。
   */
  private async _evaluateGoalDeviation(): Promise<void> {
    await evaluateGoalDeviationHook({
      taskId: this.taskId,
      sessionId: this._sessionId,
    });
  }

  /**
   * 3-1（2026-09-03）：PDCA 终态 → 轻量记忆回写（Act 复盘产物化，喂给全局长效 recall）。
   * 喂入源 = 编排器 PlanStep 完整对象（含 decision/reviewResult/dependsOn），非 auditReport（缺 dependsOn）。
   * 映射：整条为 MemoryType.DECISION 复盘（含每步决策/审查结论/依赖），tags 标注来源 pdca+outcome+taskId。
   * 幂等：_memoryWriteDone 单次 guard + createMemory 缓存精确去重（命中返回 existing）兜底。
   * 频控：PDCA 终态每任务一次低频；不重复梦境 cron 精炼管线（MemoryDreamService 职责，防三实现职责重叠）。
   * fire-and-forget：失败降级日志，不阻塞 PDCA 收尾。
   */
  private _persistMemoryFromAudit(outcome: 'completed' | 'aborted'): void {
    if (this._memoryWriteDone) return;
    this._memoryWriteDone = true;
    // spec §45：幂等 guard 留在宿主（写宿主状态），实现外迁 `./lro/terminalHooks`
    persistMemoryFromAudit({
      taskId: this.taskId,
      planId: this.planId,
      outcome,
    });
  }

  /**
   * 方向4（2026-09-03）：PDCA 终态落任务级评估样例（review_samples，方向 4 Spec）。
   * 结构化快照：PlanStep 完整对象（含 dependsOn/decision/reviewResult/retryCount）→ steps_json；
   * 附带 reviewPassRate 运行时快照、GoalEvaluateGate 收敛判定（_goalEvaluation）、成本/时长、自主度启发值。
   * 幂等：_sampleWriteDone 单次 guard + recordReviewSample 内 pdca_task_id 已存在跳过。
   * fire-and-forget：失败降级日志，不阻塞 PDCA 收尾。
   */
  private _persistReviewSample(stage: 'pdca_completed' | 'pdca_aborted'): void {
    if (this._sampleWriteDone) return;
    this._sampleWriteDone = true;
    const metrics = this.getMetrics();
    // spec §45：幂等 guard 留在宿主；实现外迁 `./lro/terminalHooks`
    persistReviewSample({
      taskId: this.taskId,
      planId: this.planId,
      sessionId: this._sessionId,
      stage,
      reviewPassRate: metrics.reviewPassRate,
      totalTokens: this._totalTokensTracked,
      durationMs:
        this._startedAt > 0 ? Date.now() - this._startedAt : undefined,
      goalEvaluation: this._goalEvaluation,
    });
  }

  async shutdown(): Promise<void> {
    this.dispose();
  }

  /**
   * 清理资源，从活跃列表移除（幂等）
   */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // 1. 中止所有异步操作
    this.isolation.abort('Orchestrator disposed');

    // 1.1（2026-10-17）：dispose 同样要中止在飞步骤 loop（会话拆除 / 24h 清理 /
    // plan 被删除都会走到这里）——原实现只 dispose 共享 taorLoop，私有实例继续烧模型。
    for (const loop of this._activeStepLoops) {
      try {
        void loop.abort();
      } catch {
        // dispose 容错：单个 loop 取消失败不阻断清理
      }
    }
    this._activeStepLoops.clear();

    // 1.5 T1.2: 释放执行副作用作用域（abort/文件/沙箱按 LIFO 释放，
    //    dispose 幂等 + 内部容错上报，不阻断主流程）
    void this.scope.dispose();

    // 2. 清理 TAORLoop 实例
    if (this.taorLoop) {
      try {
        (this.taorLoop as any).dispose?.();
      } catch {
        // dispose 清理失败不影响主流程（非关键路径）
      }
    }

    // 3. 清理 LifecycleTracker
    this.lifecycle.clear();

    // 4. 释放所有文件锁
    const released = this.fileLockManager.releaseAll(this.taskId);
    if (released > 0) {
      logger.info('File locks released on dispose', {
        taskId: this.taskId,
        count: released,
      });
    }

    // 5. 从活跃列表移除
    activeOrchestrators.delete(this.taskId);

    logger.info('LongRunningTaskOrchestrator disposed', {
      taskId: this.taskId,
      planId: this.planId,
    });
  }

  private _disposed = false;
}

/** 活跃的 PDCA 编排器实例 */
const activeOrchestrators = new Map<string, LongRunningTaskOrchestrator>();

/** 编排器最大存活时间（24h），超时自动清理 */
const ORCHESTRATOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** 定时清理过期编排器（每 30 分钟） */
setInterval(
  () => {
    const now = Date.now();
    for (const [taskId, orchestrator] of activeOrchestrators) {
      const lifecycle = (orchestrator as any).lifecycle;
      const lastActivity = lifecycle?.getLastActivityTime?.();
      if (lastActivity && now - lastActivity > ORCHESTRATOR_MAX_AGE_MS) {
        logger.warn('Orchestrator exceeded max age, auto-disposing', {
          taskId,
          lastActivity,
          ageMs: now - lastActivity,
        });
        orchestrator.dispose();
      }
    }
  },
  30 * 60 * 1000
).unref();

/** 步骤编排所用 TAORLoop 工厂的签名（与 `PdcaLauncher.deps.taorLoopFactory` 一致） */
export type StepLoopFactory = (
  sessionId: string,
  opts?: { maxTurnsMultiplier?: number; privateInstance?: boolean }
) => TAORLoop;

/**
 * 步骤 TAORLoop 工厂（进程级，由 chat 层在启动时注册一次）。
 *
 * **2026-10-08（长程任务「执行不了」根因修复）**：`getOrCreateOrchestrator()` 原先
 * **从不注入** TAORLoop ⇒ 经该入口启动的任务（前端「用编排推进」按钮 = `POST /v1/pdca/start`、
 * CLI `/goal start`）每个步骤都退化为「**纯 LLM 文本执行**」：模型既看不到工具、也无处执行
 * 工具调用。事故 `pdca_muz3wada` 实测即此路径（日志 `进入默认 executor 路径…hasTAORLoop:false`，
 * 9 步 / 0 次工具调用 ⇒ 审查全不过 ⇒ `PDCA_GOAL_NOT_CONVERGED`）。
 * 此前仅 `PdcaLauncher`（会话内升级 / 阶段链）显式注入过 ⇒ **同一编排器两条入口行为分裂**。
 */
let stepLoopFactory: StepLoopFactory | undefined;

/**
 * 注册步骤 TAORLoop 工厂（chat 层启动时调用；未注册 ⇒ 退回纯文本执行，不报错）。
 * 传 `undefined` 可清除注册（测试还原进程级状态用）。
 */
export function setStepLoopFactory(factory: StepLoopFactory | undefined): void {
  stepLoopFactory = factory;
}

export function getOrCreateOrchestrator(
  taskId: string
): LongRunningTaskOrchestrator {
  let orchestrator = activeOrchestrators.get(taskId);
  if (!orchestrator) {
    orchestrator = new LongRunningTaskOrchestrator(taskId);
    // 工厂可用 ⇒ 步骤走 TAOR 分支（真实工具执行）；否则回退默认 executor（纯文本）
    if (stepLoopFactory) {
      orchestrator.setTAORLoopFactory(stepLoopFactory);
    }
    activeOrchestrators.set(taskId, orchestrator);
  }
  return orchestrator;
}

export function getOrchestrator(
  taskId: string
): LongRunningTaskOrchestrator | undefined {
  return activeOrchestrators.get(taskId);
}

export function getAllOrchestrators(): LongRunningTaskOrchestrator[] {
  return Array.from(activeOrchestrators.values());
}
