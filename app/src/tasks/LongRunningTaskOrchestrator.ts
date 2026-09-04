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
 *   AgentIsolation（隔离）、toolsets（角色权限）
 */

import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { Span, SpanStatusCode } from '@opentelemetry/api';
import { configManager } from '@modules/config';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir, resolveDbPath } from '@modules/core/paths';
import { trackUsage } from '@modules/ai';
import { taskOrchestrator } from './TaskOrchestrator';
import { emitPdcaLiveEvent } from './PdcaLiveEvents';
import type { Plan, PlanStep, PlanProgress } from './TaskOrchestrator';
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
import { computeToolNames, resolveToolsets } from '../tools/toolsets';
import { generateAuditReport } from './AuditReport';
import type { AuditReport } from './AuditReport';
import { formatReviewSummary } from './PlanReview';
import type { PlanReview, ReviewDecision } from './PlanReview';
// E-4（2026-08-23，T-G）：PDCA 旁路轨迹文件（子步骤完整轨迹，会话外诊断数据）
import { TrajectoryTrailRecorder } from '@modules/session';
import { createReviewGate } from './review/ReviewGate.js';
import type { ReviewGate, ReviewGateContext } from './review/ReviewGate.js';
import {
  GoalEvaluateGate,
  isGoalEvaluateEnabled,
} from './review/GoalEvaluateGate.js';
import { TAORLoop, createTAORLoopDeps } from '@modules/query';
import type { TAORLoopDeps } from '@modules/query';
import { VerifierAgent, createVerifierAgent } from '@modules/query';
import type { VerificationResult } from '@modules/query';
import { FileLockManager, fileLockManager } from './FileLockManager.js';
import { inboxManager } from '@modules/runtime/InboxManager.js';
import {
  syncPdcaWorkItemStatus,
  writePdcaCheckpoint,
  readPdcaCheckpoint,
} from './PdcaWorkItemBridge';
import { globalToolManager } from '../tools/index.js';
import type { ToolUseContext } from '../tools/types/Tool.js';

const logger = getLogger('tasks:longRunning');

/** PDCA 阶段 */
export type PdcaPhase =
  | 'plan'
  | 'plan_pending'
  | 'execute'
  | 'review'
  | 'decide'
  | 'completed'
  /** D1（M7，2026-08-13）：阶段审批挂起（区别于 plan_pending，阶段产物待审批） */
  | 'stage_awaiting_approval';

/**
 * Gap D（1-0b，2026-09-03）：phase → checkpoint.status 联动映射。
 * findExistingTask（排除 abort/failed/completed）与 scanAndAbortStalePdcaTasks
 * （命中 started/running）都依赖 checkpoint.status 的完整生命周期演进；
 * 仅做字段 merge 而 status 停在初始 'started' 时，幂等排除依然永假。
 */
function pdcaCheckpointStatus(
  phase: PdcaPhase
): 'started' | 'running' | 'completed' {
  switch (phase) {
    case 'completed':
      return 'completed';
    case 'execute':
    case 'review':
    case 'decide':
      return 'running';
    case 'plan':
    case 'plan_pending':
    case 'stage_awaiting_approval':
      return 'started';
  }
}

/** 1-3（2026-09-03）：task_audit_log 写入面（复用 SqliteTaskStore.writeAuditLog，TaskRegistry 同模式） */
interface AuditLogEntry {
  taskId: string;
  eventType: string;
  oldStatus: string | null;
  newStatus: string;
  timestamp: number;
}

type AuditStoreLike = { writeAuditLog(entry: AuditLogEntry): Promise<void> };

/**
 * 1-3（2026-09-03）：审计存储惰性单例（动态加载避免启动期循环依赖）。
 * 复用 SqliteTaskStore 与 goalMetricsService 同款独立实例模式，不侵入 TaskRegistry。
 * 注：曾用"每次短连接"（开→写→关），但每 lifecycle 事件都全量建表 DDL 开销过大，
 * 改回单例长连接；Windows 测试清理 EBUSY 由测试 afterEach 容错处理。
 */
let _auditStorePromise: Promise<AuditStoreLike | null> | null = null;
async function resolveAuditStore(): Promise<AuditStoreLike | null> {
  _auditStorePromise ??= (async () => {
    try {
      const { createSqliteTaskStore } = await import('./db/SqliteTaskStore.js');
      const store = createSqliteTaskStore(resolveDbPath());
      await store.init();
      return store;
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'resolveAuditStore',
      });
      return null;
    }
  })();
  return _auditStorePromise;
}

/** 记忆写回的最小接口（评审 1 修复：复用共享 manager，避免多实例索引竞态） */
interface MemoryWritebackManager {
  createMemory(args: { content: string; metadata: unknown }): Promise<unknown>;
}

/**
 * 3-1 加固（评审 1，2026-09-03）：记忆写回 manager 惰性单例。
 * 原实现每次 PDCA 终态 new MemoryManagerImpl()——多实例各自持 store/retriever 检索索引与
 * 关系图，异步加载下 saveIndex/saveRelationGraph 整体覆写可能互相覆盖；且每次构造触发全量
 * refreshSummaryCache 扫描。改为共享单例（对齐 memory-handlers.ts 惰性单例模式）。
 */
let _memoryWritebackManager: MemoryWritebackManager | null = null;
async function resolveMemoryWritebackManager(): Promise<MemoryWritebackManager | null> {
  if (!_memoryWritebackManager) {
    try {
      const { MemoryManagerImpl } = await import('@modules/memory');
      _memoryWritebackManager = new MemoryManagerImpl();
    } catch (err) {
      await handleError(err, {
        module: 'tasks:longRunning',
        action: 'resolveMemoryWriteback',
      });
    }
  }
  return _memoryWritebackManager;
}

/** PDCA 状态快照（前端查询用） */
export interface PdcaStatus {
  taskId: string;
  planId: string;
  phase: PdcaPhase;
  plan?: Plan;
  progress?: PlanProgress;
  currentStep?: PlanStep;
  awaitUserDecision: boolean;
  decisionPrompt?: string;
  audit?: AuditReport;
  lifecycle: LifecycleEvent[];
}

/** PDCA 监控指标 */
export interface PdcaMetrics {
  /** 总 PDCA 循环次数 */
  totalCycles: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 完成步骤数 */
  completedSteps: number;
  /** 失败步骤数 */
  failedSteps: number;
  /** 平均每步耗时（ms） */
  avgStepDurationMs: number;
  /** 平均 Review 分数（0-100） */
  avgReviewScore: number;
  /** Review 通过率 */
  reviewPassRate: number;
  /** 工具调用失败导致步骤失败数 */
  toolFailureSteps: number;
  /** 中断率（aborted / total） */
  abortRate: number;
}

/** 子 Agent 执行句柄 */
interface SubAgentHandle {
  agentId: string;
  isolation: ReturnType<typeof createAgentIsolation>;
  output: string;
  completed: boolean;
  error?: string;
}

/**
 * 角色配置
 */
interface RoleConfig {
  name: string;
  toolsets: string[];
  systemPrompt: string;
}

const PLANNER_ROLE: RoleConfig = {
  name: 'Planner',
  toolsets: ['research', 'search', 'file'],
  systemPrompt:
    '你是一个任务规划师。分析用户需求，将复杂任务拆解为可执行的步骤序列。每个步骤需包含验收标准（完成后可验证的标准）。只输出分析结果，不执行任何代码或文件修改。',
};

const EXECUTOR_ROLE: RoleConfig = {
  name: 'Executor',
  toolsets: ['terminal', 'code', 'file', 'browser', 'search'],
  systemPrompt:
    '你是一个任务执行者。严格按照给定的步骤描述和验收标准执行。完成后汇报执行结果。',
};

/** 默认执行器函数类型 */
type ExecutorFn = (params: {
  systemPrompt: string;
  userPrompt: string;
  tools: string[];
  isolation: ReturnType<typeof createAgentIsolation>;
}) => Promise<string>;

/**
 * §5 P1: 任务消息回写格式（长程任务 → 对话会话）
 * RC-C（08-09）：任务内工具已从 LLM 模拟改为真实执行（globalToolManager），
 * content 为真实执行摘要文本，前端据 isTaskMessage 渲染为摘要样式。
 */
export interface TaskMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

/**
 * D5（M6，2026-08-13）：阶段回退增量 replan 记录
 * escalate 时捕获失败步骤与缺陷清单，重开循环时注入增量 replan 指令。
 */
export interface EscalationRecord {
  stepId: string;
  stepDescription: string;
  /** 缺陷清单（severity + description） */
  defects: string[];
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
  /** 方向4（2026-09-03）：GoalEvaluateGate 收敛判定捕获（评估关闭时不设） */
  private _goalEvaluation?: {
    converged: boolean;
    confidence: number;
    reason?: string;
  };
  /** 方向4（2026-09-03）：评估样例落库防重（同任务仅写一次） */
  private _sampleWriteDone = false;
  // 1-1d（2026-09-03）：stepDurations[].tokens = 该步累计 token（跨 retry 累计），
  // 供 per-step 独立核算/审计聚合；总口径仍以 _totalTokensTracked 为准。
  private stepDurations: Map<
    string,
    { startMs: number; endMs?: number; tokens?: number }
  > = new Map();
  /**
   * Phase 2: TAORLoop 统一编排器（ENABLE_LOOP_V8_PHASE2 时注入）
   */
  private taorLoop?: TAORLoop;
  /**
   * D2（M3，2026-08-13）：每步独立 TAORLoop 工厂（BatchRunner 并行安全前提）
   * 注入工厂后 executeSingleStep 为每个步骤创建独立实例，杜绝共享实例状态串扰；
   * 未注入时回退共享 taorLoop 串行执行（现状零回归）。
   */
  private taorLoopFactory?: (sessionId: string) => TAORLoop;
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

    // 默认 executor：通过 AI 服务执行
    this.executor =
      executor ??
      (async (params) => {
        const { createAIService } = await import('@modules/ai');
        const service = createAIService({
          defaultModel: '',
          apiKey: configManager.env('ANTHROPIC_API_KEY') || '',
        });
        const _trackStart = Date.now();
        const response = await (service as any).chat({
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userPrompt },
          ],
        });
        const trackPayload =
          typeof response === 'string'
            ? { content: response }
            : (response as {
                content?: string;
                model?: string;
                usage?: Record<string, unknown>;
              });
        trackUsage(trackPayload, {
          model: trackPayload.model || 'unknown',
          providerId: 'default',
          latencyMs: Date.now() - _trackStart,
        });
        return typeof response === 'string'
          ? response
          : (response?.content ?? '');
      });
  }

  /** 设置阶段并同步 WorkItem 状态 */
  private setPhase(phase: PdcaPhase): void {
    this.phase = phase;
    syncPdcaWorkItemStatus(this.taskId, phase);
    this._persistCheckpoint(); // P0(M2)：阶段变更即落盘步骤级快照（跨重启恢复）
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
  private _persistCheckpoint(): void {
    try {
      const plan = this.planId
        ? taskOrchestrator.getPlan(this.planId)
        : undefined;
      writePdcaCheckpoint(this.taskId, {
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
          // 1-1c（2026-09-03）：快照携带依赖（resume 按快照顺序位置映射重建）
          dependsOn: s.dependsOn,
        })),
        // D5（M6）：escalate 缺陷清单（跨重启恢复后增量 replan 仍生效）
        lastEscalations: this._lastEscalations,
        // D4（M4）：TAORLoop token 累计（阶段边界结算 → StageOrchestrator 成本护栏）
        totalTokens: this._totalTokensTracked,
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
      envEnabled: configManager.env('ENABLE_LOOP_V8_PHASE2'),
    });
  }

  /**
   * D2（M3，2026-08-13）：注入每步独立 TAORLoop 工厂（无依赖步骤批次并行的安全前提）
   * 工厂签名与 PdcaLauncher.deps.taorLoopFactory 一致：(sessionId) => TAORLoop。
   */
  setTAORLoopFactory(factory: (sessionId: string) => TAORLoop): void {
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
  }

  /** 构建 ReviewGate 执行上下文（Orchestrator 运行时依赖注入） */
  private _buildReviewGateContext(step: PlanStep): ReviewGateContext {
    return {
      taskId: this.taskId,
      planId: this.planId!,
      step,
      isolation: this.isolation,
      executor: this.executor,
      verifier: this.verifier,
    };
  }

  // ─── Phase 1: PLAN ──────────────────────────────────

  async executePlanPhase(
    description: string,
    sessionId: string
  ): Promise<Plan> {
    throwIfAborted(this.isolation);
    this.setPhase('plan');
    this._recordLifecycle('started', TaskStatus.RUNNING, 'Plan phase started');

    const otel = getOTelTracing();
    const span = otel.startSpan('pdca.plan', {
      'task.id': this.taskId,
      'session.id': sessionId,
    });

    try {
      // D5（M6，2026-08-13）：阶段回退增量 replan —— 仅重生成受缺陷影响部分，不全盘重来
      const replanSection =
        this._lastEscalations.length > 0
          ? `\n\n【增量修订要求】（上次执行存在缺陷，仅修订受影响部分，未变部分沿用原计划）
上次失败步骤: ${this._lastEscalations.map((e) => `"${e.stepDescription}"`).join('、')}
缺陷清单:
${
  this._lastEscalations
    .flatMap((e) => e.defects)
    .map((d) => `- ${d}`)
    .join('\n') || '- （无明细，按失败步骤范围修订）'
}
修订范围: 仅针对上述缺陷重规划受影响步骤；与缺陷无关的已有步骤保持原样。`
          : '';

      // 让 Planner 分析并输出步骤
      const planPrompt = `请分析以下任务并输出 JSON 格式的执行计划：
任务描述: ${description}
${replanSection}

输出格式：
{
  "steps": ["步骤1描述", "步骤2描述"],
  "acceptanceCriteria": ["步骤1的验收标准", "步骤2的验收标准"],
  "dependsOn": [[], [0], [0, 1]]
}
说明：dependsOn 为可选字段，长度与 steps 对齐；
第 i 步依赖 steps 中哪些前置步骤，填这些步骤的下标（0-based）；无依赖填 []；
不允许依赖自身或后续步骤（依赖错误时执行器会按无依赖/串行安全兜底）。`;

      const planText = await this.executor({
        systemPrompt: PLANNER_ROLE.systemPrompt,
        userPrompt: planPrompt,
        tools: computeToolNames(PLANNER_ROLE.toolsets),
        isolation: this.isolation,
      });

      // 解析 Planner 输出
      let steps: string[] = [description];
      let acceptance: string[] = [];
      // 1-1a（2026-09-03）：可选依赖（按步骤 0-based 序号）。仅首轮规划解析——
      // 增量 replan（缺陷修订）时步骤编号与旧计划可能漂移，填充错误依赖风险大于收益，保持串行保守。
      let dependsOn: number[][] | undefined;

      try {
        const parsed = JSON.parse(planText);
        steps = parsed.steps || [description];
        acceptance = parsed.acceptanceCriteria || [];
        if (
          this._lastEscalations.length === 0 &&
          Array.isArray(parsed.dependsOn)
        ) {
          dependsOn = parsed.dependsOn.map((deps: unknown) =>
            Array.isArray(deps)
              ? deps
                  .map((d) => Number(d))
                  .filter((d) => Number.isInteger(d) && d >= 0)
              : []
          );
        }
      } catch (err) {
        // 非 JSON 输出，按行分割（非关键路径，无需 handleError）
        const lines = planText.split('\n').filter((l) => l.trim());
        if (lines.length > 1) {
          steps = lines.slice(0, 10);
        }
        logger.debug('Plan output is not JSON, splitting by lines', {
          error: String(err),
        });
      }

      // 创建 Plan（workspaceId 从会话解析，用于项目编排面板隔离）
      const workspaceId = await taskOrchestrator.resolveWorkspaceId(sessionId);
      const plan = taskOrchestrator.createPlan(
        description,
        steps,
        sessionId,
        undefined,
        acceptance,
        workspaceId,
        dependsOn
      );

      this.planId = plan.id;
      this._recordLifecycle(
        'progress',
        TaskStatus.RUNNING,
        `Plan created with ${steps.length} steps`
      );

      span.setAttribute('plan.id', plan.id);
      span.setAttribute('plan.steps', steps.length);
      otel.endSpan(span, SpanStatusCode.OK);
      return plan;
    } catch (e) {
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'executePlanPhase',
        context: { taskId: this.taskId },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
  }

  // ─── Phase 2: EXECUTE ──────────────────────────────

  async executeAllSteps(): Promise<Plan> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    this.setPhase('execute');
    const plan = taskOrchestrator.getPlan(this.planId)!;
    plan.status = 'running';

    // D2（M3，2026-08-13）：无依赖步骤批次并行（依赖 step.dependsOn 拓扑分组）
    const batches = this._groupStepsByDependency(plan.steps);
    for (const batch of batches) {
      if (this.isolation.abortController.signal.aborted) break;

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

    // 检查全部完成
    this.setPhase('review');
    return taskOrchestrator.getPlan(this.planId)!;
  }

  /**
   * D2（M3，2026-08-13）：按 step.dependsOn 做拓扑批次分组。
   * 无 dependsOn 的步骤视为相互独立（可并行）；有 dependsOn 的步骤延迟到依赖批次之后。
   * 当前 PDCA 流程未填充 dependsOn → 单批次（全部独立）；依赖模型启用后自动生效。
   * 死锁/循环依赖兜底：整批剩余步骤串行执行（不阻塞主流程）。
   */
  private _groupStepsByDependency(steps: PlanStep[]): PlanStep[][] {
    const remaining = new Map(steps.map((s) => [s.id, s]));
    const batches: PlanStep[][] = [];

    while (remaining.size > 0) {
      const ready: PlanStep[] = [];
      for (const step of remaining.values()) {
        const deps = step.dependsOn ?? [];
        // 依赖不在剩余集合 = 已执行完成或属于更早批次
        if (deps.every((d) => !remaining.has(d))) ready.push(step);
      }
      if (ready.length === 0) {
        // 循环依赖或残留依赖缺失：兜底按剩余顺序串行执行
        batches.push([...remaining.values()]);
        remaining.clear();
        break;
      }
      for (const s of ready) remaining.delete(s.id);
      batches.push(ready);
    }
    return batches;
  }

  /**
   * §5 P2: 任务事件广播（/v1/events 常驻事件总线，前端 sseService.on 订阅）
   * 动态 import 避免启动期循环依赖；广播失败不影响任务执行
   */
  private async _emitTaskEvent(
    event: 'task:progress' | 'task:completed' | 'task:error',
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      await broadcastEvent(event, { taskId: this.taskId, ...payload });
    } catch (e) {
      // @ignore-catch — 事件广播失败不影响任务执行
      logger.debug('任务事件广播失败', {
        taskId: this.taskId,
        event,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /**
   * §5 P1: 将任务消息回写到对话会话（注入的回调不存在或回写失败不阻断任务）
   */
  /**
   * RC-C 修复：为长程任务内工具执行创建最小 ToolUseContext。
   * 复用对话侧 ToolExecutor 真实执行，豁免审批（任务启动即用户授权）。
   */
  private _createToolContext(): ToolUseContext {
    return {
      abortController: this.isolation.abortController,
      sessionId: this._sessionId ?? undefined,
      options: {
        commands: [],
        debug: false,
        mainLoopModel: '',
        tools: globalToolManager.getAllTools(),
        verbose: false,
        thinkingConfig: {},
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: {},
        cwd: this.isolation.workspace,
      },
      readFileState: {},
      getAppState: () => ({}),
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: (f) => f(0),
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: [],
    };
  }

  private _emitTaskMessage(msgs: TaskMessage[]): void {
    if (!this._sessionId || !this._onTaskMessage) {
      logger.debug(
        '[orchestrator] _emitTaskMessage 跳过（无 sessionId 或回调）',
        {
          taskId: this.taskId,
          hasSessionId: !!this._sessionId,
          hasCallback: !!this._onTaskMessage,
          msgCount: msgs.length,
        }
      );
      return;
    }
    try {
      logger.info('[orchestrator] _emitTaskMessage 回写消息', {
        taskId: this.taskId,
        sessionId: this._sessionId,
        msgCount: msgs.length,
        roles: msgs.map((m) => m.role),
        contentPreviews: msgs.map((m) => m.content.slice(0, 60)),
      });
      this._onTaskMessage(this._sessionId, msgs);
    } catch (e) {
      logger.warn('任务消息回写失败（不影响任务执行）', {
        taskId: this.taskId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    // §5 P2: 顺带广播进度事件（fire-and-forget，限频由调用方控制：step 级）
    const last = msgs[msgs.length - 1];
    if (last) {
      void this._emitTaskEvent('task:progress', {
        sessionId: this._sessionId,
        status: 'running',
        stepDesc: last.content.slice(0, 120),
      });
    }
    // E-4（2026-08-23，T-G）：PDCA 子步骤完整轨迹落旁路文件（会话外诊断数据，
    // 不占会话体积/上下文；会话内回写仍保持 slice 节流）
    for (const m of msgs) {
      void TrajectoryTrailRecorder.append(this._sessionId, {
        type: 'task_step',
        taskId: this.taskId,
        desc: m.content.slice(0, 500),
        detail: { role: m.role },
      });
    }
  }

  private async executeSingleStep(step: PlanStep, plan: Plan): Promise<void> {
    taskOrchestrator.markStepRunning(step.id);
    this._persistCheckpoint(); // P0(M2)：步骤状态变更即落盘
    this.stepDurations.set(step.id, { startMs: Date.now() });
    this._recordLifecycle(
      'progress',
      TaskStatus.RUNNING,
      `Executing step: ${step.description}`
    );

    logger.info('[orchestrator] executeSingleStep 开始', {
      taskId: this.taskId,
      planId: plan.id,
      stepId: step.id,
      stepDesc: step.description.slice(0, 80),
      hasTAORLoop: !!this.taorLoop,
      envEnabled: configManager.env('ENABLE_LOOP_V8_PHASE2'),
      hasAcceptanceCriteria: !!step.acceptanceCriteria,
      hasReviewResult: !!step.reviewResult,
      retryCount: step.retryCount,
      maxRetries: step.maxRetries,
    });

    if (step.retryCount > 0) {
      logger.info('[orchestrator] 执行重试步骤', {
        taskId: this.taskId,
        stepId: step.id,
        retryCount: step.retryCount,
        maxRetries: step.maxRetries,
        hasReviewResult: !!step.reviewResult,
        reviewIssues: step.reviewResult?.issues
          ?.slice(0, 3)
          .map((i) => i.description),
      });
    }

    const execPrompt = [
      `执行以下步骤: ${step.description}`,
      step.acceptanceCriteria ? `验收标准: ${step.acceptanceCriteria}` : '',
      step.reviewResult
        ? `注意: 上次审查发现以下问题，本次请修正：\n${step.reviewResult.issues.map((i) => `- ${i.description}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    // Phase 2: 委托 TAORLoop 编排（如果已注入且 ENABLE_LOOP_V8_PHASE2 启用）
    // D2（M3，2026-08-13）：优先每步独立实例（工厂注入，并行安全）；否则共享实例（串行）
    const loop = this.taorLoopFactory
      ? this.taorLoopFactory(this.taskId)
      : this.taorLoop;
    if (loop && configManager.env('ENABLE_LOOP_V8_PHASE2') !== 'false') {
      logger.info('[orchestrator] 进入 TAORLoop 分支（真实工具执行）', {
        taskId: this.taskId,
        stepId: step.id,
        perStepInstance: !!this.taorLoopFactory,
        toolNames: computeToolNames(EXECUTOR_ROLE.toolsets),
      });
      let taorStart = 0;
      try {
        const isolation = this.isolation;
        const executor = this.executor;
        const taskId = this.taskId;
        (loop as any).config.sessionId = this.taskId;

        // 持久化缓冲区（PDCA 模式下保持消息上下文）
        const persistedMessages: any[] = [];

        const deps = createTAORLoopDeps({
          callModel: async function* (msgs: any[], signal: AbortSignal) {
            // 构建完整对话上下文（修复：之前只取最后一条消息）
            const conversationContext = msgs
              .map((m) =>
                typeof m.content === 'string'
                  ? `[${m.role}] ${m.content}`
                  : `[${m.role}] ${JSON.stringify(m.content)}`
              )
              .join('\n\n');
            const callStart = Date.now();
            const result = await executor({
              systemPrompt: EXECUTOR_ROLE.systemPrompt,
              userPrompt: execPrompt + '\n\n' + conversationContext,
              tools: computeToolNames(EXECUTOR_ROLE.toolsets),
              isolation,
            });
            const callElapsed = Date.now() - callStart;
            logger.info('[orchestrator] callModel 完成', {
              taskId,
              stepId: step.id,
              elapsedMs: callElapsed,
              resultLength: result?.length ?? 0,
              msgCount: msgs.length,
            });
            yield { type: 'text', content: result };
            yield { type: 'done' };
          },
          executeTools: async (
            toolCalls: Array<{
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            }>,
            _signal: AbortSignal
          ) => {
            // RC-C 修复：真实工具执行（替代 LLM 模拟）
            // 复用对话侧 ToolExecutor，豁免审批（任务启动即用户授权）
            const toolContext = this._createToolContext();
            const executeToolsStart = Date.now();
            const results: Array<{
              toolCallId?: string;
              toolName?: string;
              result?: unknown;
              error?: string;
            }> = [];
            logger.info('[orchestrator] executeTools 开始执行', {
              taskId: this.taskId,
              stepId: step.id,
              toolCount: toolCalls.length,
              toolNames: toolCalls.map((tc) => tc.name),
            });
            for (const tc of toolCalls) {
              const toolStart = Date.now();
              try {
                const tool = globalToolManager
                  .getAllTools()
                  .find((t) => t.name === tc.name);
                if (!tool) {
                  logger.warn('[orchestrator] 工具未注册', {
                    taskId: this.taskId,
                    stepId: step.id,
                    toolName: tc.name,
                    toolCallId: tc.id,
                    registeredTools: globalToolManager
                      .getAllTools()
                      .map((t) => t.name),
                  });
                  results.push({
                    toolCallId: tc.id,
                    toolName: tc.name,
                    error: `工具未注册: ${tc.name}`,
                  });
                  continue;
                }
                const toolResult = await tool.execute(
                  tc.arguments,
                  toolContext
                );
                const elapsed = Date.now() - toolStart;
                const resultPreview: string =
                  typeof toolResult === 'string'
                    ? (toolResult as string).slice(0, 100)
                    : typeof toolResult === 'object' && toolResult !== null
                      ? JSON.stringify(toolResult).slice(0, 100)
                      : String(toolResult).slice(0, 100);
                logger.info('[orchestrator] 工具执行成功', {
                  taskId: this.taskId,
                  stepId: step.id,
                  toolName: tc.name,
                  toolCallId: tc.id,
                  elapsedMs: elapsed,
                  resultType: typeof toolResult,
                  resultPreview,
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  result: toolResult,
                });
              } catch (e) {
                const elapsed = Date.now() - toolStart;
                await handleError(e, {
                  module: 'tasks:longRunning',
                  action: 'executeTools',
                  context: {
                    toolName: tc.name,
                    stepId: step.id,
                    toolCallId: tc.id,
                    elapsedMs: elapsed,
                  },
                });
                results.push({
                  toolCallId: tc.id,
                  toolName: tc.name,
                  error: String(e),
                });
              }
            }
            logger.info('[orchestrator] executeTools 执行完毕', {
              taskId: this.taskId,
              stepId: step.id,
              total: results.length,
              success: results.filter((r) => !r.error).length,
              failed: results.filter((r) => r.error).length,
              failedNames: results
                .filter((r) => r.error)
                .map((r) => r.toolName),
              totalElapsedMs: Date.now() - executeToolsStart,
            });
            return results;
          },
          persistMessages: async (msgs: any[], _signal?: AbortSignal) => {
            // 缓存消息到内存，PDCA 完成后统一持久化
            persistedMessages.push(...msgs);
          },
        });

        const messages: any[] = [{ role: 'user', content: execPrompt }];
        taorStart = Date.now();
        const result = await loop.runCollect({
          messages: messages as never,
          deps,
        } as never);
        const taorElapsed = Date.now() - taorStart;
        // S2（2026-08-13）：累计 TAORLoop token，阶段边界结算落库 goal_metrics
        // 1-1d（2026-09-03）：每步独立记账（跨 retry 累计）+ 聚合单值双写。
        // 并发安全依据：本结算点为无 await 的同步语句，事件循环下 += 不丢更新；
        // stepDurations[].tokens 提供 per-step 明细，供审计/评估集聚合校验。
        this._totalTokensTracked += result.totalTokens;
        const stepTok = this.stepDurations.get(step.id);
        if (stepTok) {
          stepTok.tokens = (stepTok.tokens ?? 0) + result.totalTokens;
        }

        taskOrchestrator.markStepCompleted(
          step.id,
          `[TAORLoop] turns=${result.turnCount} tokens=${result.totalTokens} elapsed=${taorElapsed}ms`
        );
        this._persistCheckpoint(); // P0(M2)
        const log = (loop as any).getLastRunLog?.();
        const dur = this.stepDurations.get(step.id);
        if (dur) dur.endMs = Date.now();
        const stepElapsed = dur && dur.endMs ? dur.endMs - dur.startMs : -1;
        logger.info('[orchestrator] TAORLoop 步骤完成', {
          taskId: this.taskId,
          stepId: step.id,
          turns: result.turnCount,
          totalTokens: result.totalTokens,
          taorElapsedMs: taorElapsed,
          stepElapsedMs: stepElapsed,
          persistedMsgCount: persistedMessages.length,
          taorResult: log,
        });
        // OBS（M1b）：经典链步骤完成 → pdca:stage:phase（独立通道，非会话消息）
        void emitPdcaLiveEvent(
          'pdca:stage:phase',
          {
            taskId: this.taskId,
            planId: this.planId ?? undefined,
            sessionId: this._sessionId ?? '',
          },
          {
            stage: 'execute',
            status: 'completed',
            stepId: step.id,
            completedSteps: this.stepDurations.size,
            totalSteps: plan.steps.length,
            tokenCost: result.totalTokens,
            durationMs: taorElapsed,
            currentStep: step.description.slice(0, 80),
          }
        );
        // §5 P1: 消费死缓冲 — step 完成后批量回写（此前 persistedMessages 只 push 从未消费）
        if (persistedMessages.length > 0) {
          this._emitTaskMessage(
            persistedMessages.slice(-10).map((m) => ({
              // P2（08-09）：保留原始 role（不再强制伪装为 assistant）
              role: (m.role === 'user' || m.role === 'tool'
                ? m.role
                : 'assistant') as TaskMessage['role'],
              content:
                typeof m.content === 'string'
                  ? m.content.slice(0, 500)
                  : JSON.stringify(m.content).slice(0, 500),
              toolCallId: m.toolCallId as string | undefined,
            }))
          );
        }
        return;
      } catch (e) {
        const taorElapsedOnFail = Date.now() - taorStart;
        await handleError(e, {
          module: 'tasks:longRunning',
          action: 'taorLoop_delegation',
          context: { stepId: step.id },
        });
        logger.warn('[orchestrator] TAORLoop 执行失败，降级到默认 executor', {
          taskId: this.taskId,
          stepId: step.id,
          stepDesc: step.description.slice(0, 60),
          elapsedMs: taorElapsedOnFail,
          error: String(e),
          errorType: e instanceof Error ? e.constructor.name : typeof e,
        });
      }
    }

    // 默认路径：直接调用 executor
    logger.info('[orchestrator] 进入默认 executor 路径（纯 LLM 文本执行）', {
      taskId: this.taskId,
      stepId: step.id,
      hasTAORLoop: !!this.taorLoop,
      envEnabled: configManager.env('ENABLE_LOOP_V8_PHASE2'),
    });
    try {
      const executorStart = Date.now();
      const result = await this.executor({
        systemPrompt: EXECUTOR_ROLE.systemPrompt,
        userPrompt: execPrompt,
        tools: computeToolNames(EXECUTOR_ROLE.toolsets),
        isolation: this.isolation,
      });
      const executorElapsed = Date.now() - executorStart;

      taskOrchestrator.markStepCompleted(step.id, result);
      this._persistCheckpoint(); // P0(M2)
      const dur = this.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();
      const stepElapsed = dur && dur.endMs ? dur.endMs - dur.startMs : -1;

      logger.info('[orchestrator] 默认 executor 步骤完成', {
        taskId: this.taskId,
        stepId: step.id,
        executorElapsedMs: executorElapsed,
        stepElapsedMs: stepElapsed,
        resultLength: result?.length ?? 0,
      });

      // §5 P1: 默认路径从零建立消息记录（此前直接 executor 路径无任何消息回写）
      this._emitTaskMessage([
        {
          role: 'assistant',
          content: `[任务步骤完成] ${step.description}\n${(result || '').slice(0, 500)}`,
        },
      ]);

      this._recordLifecycle(
        'progress',
        TaskStatus.RUNNING,
        `Step completed: ${step.description}`
      );
    } catch (e) {
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'executor',
        context: { stepId: step.id },
      });
      const errMsg = e instanceof Error ? e.message : String(e);
      taskOrchestrator.markStepFailed(step.id, errMsg);
      this._persistCheckpoint(); // P0(M2)
      // §5 P1: 失败也回写执行摘要
      this._emitTaskMessage([
        {
          role: 'assistant',
          content: `[任务步骤失败] ${step.description} — ${errMsg}`,
        },
      ]);
      const dur = this.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();

      this._recordLifecycle(
        'progress',
        TaskStatus.RUNNING,
        `Step failed: ${step.description} — ${errMsg}`
      );
    }
  }

  // ─── Phase 3: REVIEW ────────────────────────────────

  async reviewStep(stepId: string): Promise<PlanReview> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    const otel = getOTelTracing();
    const span = otel.startSpan('pdca.review', {
      'task.id': this.taskId,
      'plan.id': this.planId,
      'step.id': stepId,
    });

    try {
      // 委托 ReviewGate 执行审查（默认实现：机械验证 + LLM Reviewer + VerifierAgent 双指标）
      const review = await this.reviewGate.reviewStep(
        this._buildReviewGateContext(step)
      );
      step.reviewResult = review;

      this._recordLifecycle(
        'progress',
        TaskStatus.RUNNING,
        `Review: ${formatReviewSummary(review)}`
      );

      span.setAttribute('review.pass', review.pass);
      span.setAttribute('review.score', review.score);
      otel.endSpan(span, SpanStatusCode.OK);
      return review;
    } catch (e) {
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'reviewStep',
        context: { taskId: this.taskId, stepId },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
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
  }

  // ─── Phase 4: DECIDE ────────────────────────────────

  async decideStep(stepId: string, decision: ReviewDecision): Promise<void> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    const otel = getOTelTracing();
    const span = otel.startSpan('pdca.decide', {
      'task.id': this.taskId,
      'plan.id': this.planId,
      'step.id': stepId,
      decision: decision,
    });

    try {
      step.decision = decision;

      switch (decision) {
        case 'approved':
          // 已完成，无需更多操作
          this._recordLifecycle(
            'progress',
            TaskStatus.RUNNING,
            `Approved: ${step.description}`
          );
          break;

        case 'retry': {
          const maxRetries = step.maxRetries ?? 3;
          if (step.retryCount >= maxRetries) {
            // 超过重试上限
            step.decision = 'escalate';
            step.status = 'failed';
            step.error = `Exceeded max retries (${maxRetries})`;
            // D5（M6）：重试上限升级 escalate 同样捕获缺陷 → 增量 replan
            this._recordEscalation(step);
            this._recordLifecycle(
              'progress',
              TaskStatus.RUNNING,
              `Retry limit exceeded for: ${step.description}`
            );
            logger.warn('[orchestrator] 重试上限超标，升级为 escalate', {
              taskId: this.taskId,
              planId: this.planId,
              stepId: step.id,
              stepDesc: step.description.slice(0, 60),
              retryCount: step.retryCount,
              maxRetries,
              reviewScore: step.reviewResult?.score,
              reviewPass: step.reviewResult?.pass,
              reviewIssues: step.reviewResult?.issues
                ?.slice(0, 3)
                .map((i) => i.description),
            });
            break;
          }

          // 重置状态准备重试
          step.status = 'pending';
          step.retryCount++;
          step.decision = undefined;
          step.reviewResult = undefined;
          this._recordLifecycle(
            'progress',
            TaskStatus.RUNNING,
            `Retry #${step.retryCount} for: ${step.description}`
          );
          logger.info('[orchestrator] 步骤重试已就绪', {
            taskId: this.taskId,
            planId: this.planId,
            stepId: step.id,
            stepDesc: step.description.slice(0, 60),
            retryCount: step.retryCount,
            maxRetries,
            prevDurationMs: this.stepDurations.get(step.id)?.endMs
              ? this.stepDurations.get(step.id)!.endMs! -
                this.stepDurations.get(step.id)!.startMs
              : undefined,
          });
          break;
        }

        case 'skip':
          step.status = 'cancelled';
          this._recordLifecycle(
            'progress',
            TaskStatus.RUNNING,
            `Skipped: ${step.description}`
          );
          break;

        case 'escalate':
          step.status = 'failed';
          this._recordLifecycle(
            'progress',
            TaskStatus.RUNNING,
            `Escalated: ${step.description}`
          );
          // D5（M6）：捕获缺陷清单 → 增量 replan 输入（基线 + 缺陷 → 局部修订）
          this._recordEscalation(step);
          break;
      }

      otel.endSpan(span, SpanStatusCode.OK);
    } catch (e) {
      await handleError(e, {
        module: 'tasks:longRunning',
        action: 'decideStep',
        context: { taskId: this.taskId, stepId },
      });
      otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
      otel.endSpan(span, SpanStatusCode.ERROR, String(e));
      throw e;
    }
  }

  /**
   * D5（M6，2026-08-13）：捕获 escalate 缺陷 → 增量 replan 输入（基线 + 缺陷清单）
   * 缺陷取自步骤 reviewResult.issues（severity + description），落 checkpoint 支持跨重启恢复。
   */
  private _recordEscalation(step: PlanStep): void {
    const defects = (step.reviewResult?.issues ?? [])
      .map((issue) => {
        const i = issue as { severity?: string; description?: string };
        const desc = i.description ?? '';
        return desc ? `[${i.severity ?? 'unknown'}] ${desc}` : '';
      })
      .filter(Boolean);
    this._lastEscalations.push({
      stepId: step.id,
      stepDescription: step.description,
      defects,
    });
    this._persistCheckpoint();
    logger.info('[orchestrator] escalate 已捕获缺陷（增量 replan 输入）', {
      taskId: this.taskId,
      stepId: step.id,
      defectCount: defects.length,
      stepDesc: step.description.slice(0, 60),
    });
  }

  /**
   * 自动决策：委托 ReviewGate.decide（默认：审查通过 → approve，未通过且可重试 → retry，否则 escalate）
   * 若 ReviewGate.shouldReview 返回 false（如 disabled 模式），直接 approve。
   */
  async autoDecideStep(stepId: string): Promise<ReviewDecision> {
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    const gateCtx = this._buildReviewGateContext(step);

    // 门关闭：跳过审查直接批准（NoopReviewGate / disabled 模式）
    if (!this.reviewGate.shouldReview(gateCtx)) {
      logger.info('[orchestrator] ReviewGate 关闭，直接批准', {
        taskId: this.taskId,
        planId: this.planId,
        stepId: step.id,
        stepDesc: step.description.slice(0, 60),
        gateName: this.reviewGate.name,
      });
      await this.decideStep(stepId, 'approved');
      return 'approved';
    }

    if (!step.reviewResult) {
      await this.reviewStep(stepId);
    }

    const decision = await this.reviewGate.decide(
      this._buildReviewGateContext(step)
    );

    logger.info('[orchestrator] autoDecideStep 决策', {
      taskId: this.taskId,
      planId: this.planId,
      stepId: step.id,
      stepDesc: step.description.slice(0, 60),
      decision,
      reviewScore: step.reviewResult?.score,
      reviewPass: step.reviewResult?.pass,
      reviewIssues: step.reviewResult?.issues
        ?.slice(0, 3)
        .map((i) => `${i.severity}:${i.description}`.slice(0, 80)),
      remainingRetries:
        (step.maxRetries ?? this.reviewGate.getConfig().maxRetries) -
        step.retryCount,
    });

    await this.decideStep(stepId, decision);
    return decision;
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
    }
  ): Promise<PdcaStatus> {
    // §5 P1: 记录回写目标会话与回调，供 executeSingleStep 使用
    this._sessionId = sessionId;
    this._onTaskMessage = opts?.onTaskMessage;
    this._startedAt = Date.now();
    const requireApproval = opts?.requirePlanApproval ?? false;

    logger.info('[orchestrator] runFullPdca 开始', {
      taskId: this.taskId,
      sessionId,
      hasTAORLoop: !!this.taorLoop,
      envEnabled: configManager.env('ENABLE_LOOP_V8_PHASE2'),
      hasOnTaskMessage: !!opts?.onTaskMessage,
      requireApproval,
      descPreview: description.slice(0, 80),
    });

    // Plan
    const plan = await this.executePlanPhase(description, sessionId);
    this.setPhase('plan');

    // 计划前置审批：在 EXECUTE 前插入审批断点
    if (requireApproval) {
      this.setPhase('plan_pending');

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

    return this._runExecuteDecideLoop();
  }

  // ─── 报告 ───────────────────────────────────────────

  generateReport(): AuditReport {
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    return generateAuditReport({
      taskId: this.taskId,
      planId: this.planId,
      steps: plan.steps.map((s) => {
        const dur = this.stepDurations.get(s.id);
        return {
          id: s.id,
          description: s.description,
          status: s.status,
          reviewResult: s.reviewResult,
          retryCount: s.retryCount,
          durationMs: dur ? (dur.endMs ?? Date.now()) - dur.startMs : 0,
          error: s.error,
        };
      }),
    });
  }

  /**
   * BUG 修复: 将审计报告持久化到文件，重启后可恢复。
   * 保存路径: ~/.pyapp/data/task-audits/{taskId}.json
   */
  private persistAuditReport(report: AuditReport): void {
    try {
      const dir = join(resolveDataDir(), 'task-audits');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${report.taskId}.json`),
        JSON.stringify(report, null, 2),
        'utf-8'
      );
    } catch (err) {
      // 持久化失败不影响任务完成状态
      logger.warn('审计报告持久化失败', {
        taskId: report.taskId,
        error: String(err),
      });
    }
  }

  // ─── 状态查询 ───────────────────────────────────────

  getStatus(): PdcaStatus {
    const plan = this.planId
      ? taskOrchestrator.getPlan(this.planId)
      : undefined;
    const progress = this.planId
      ? taskOrchestrator.getPlanProgress(this.planId)
      : undefined;

    let currentStep: PlanStep | undefined;
    if (plan) {
      currentStep = plan.steps.find((s) => s.status === 'running');
    }

    return {
      taskId: this.taskId,
      planId: this.planId || '',
      phase: this.phase,
      plan,
      progress,
      currentStep,
      awaitUserDecision: this.decisionAwait !== null,
      audit: this.auditReport || undefined,
      lifecycle: this.lifecycle.getHistory(),
    };
  }

  /** 获取 PDCA 监控指标 */
  getMetrics(): PdcaMetrics {
    const plan = this.planId
      ? taskOrchestrator.getPlan(this.planId)
      : undefined;
    const steps = plan?.steps ?? [];
    const lifecycle = this.lifecycle.getHistory();

    const totalSteps = steps.length;
    const completedSteps = steps.filter((s) => s.status === 'completed').length;
    const failedSteps = steps.filter((s) => s.status === 'failed').length;

    // 平均每步耗时（1-1d 口径：per-step 墙钟跨度均值）。
    // 依赖批次并行时各步同时计时，此为"每步平均占用跨度"而非任务总耗时；
    // 任务级成本口径看 _totalTokensTracked / goal_metrics.total_tokens。
    const durations = Array.from(this.stepDurations.values())
      .filter((d) => d.endMs)
      .map((d) => d.endMs! - d.startMs);
    const avgStepDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Review 指标
    const reviewedSteps = steps.filter(
      (s) => s.reviewResult?.score !== undefined
    );
    const avgReviewScore =
      reviewedSteps.length > 0
        ? Math.round(
            reviewedSteps.reduce(
              (sum, s) => sum + (s.reviewResult?.score ?? 0),
              0
            ) / reviewedSteps.length
          )
        : 0;
    const passedReviews = reviewedSteps.filter(
      (s) => s.reviewResult?.pass
    ).length;
    const reviewPassRate =
      reviewedSteps.length > 0
        ? Math.round((passedReviews / reviewedSteps.length) * 100)
        : 100;

    // 工具调用失败
    const toolFailureSteps = steps.filter(
      (s) => s.error && s.error.includes('tool')
    ).length;

    // 中断率
    const abortedEvents = lifecycle.filter(
      (e) => e.phase === 'finalized' && e.status === TaskStatus.FAILED
    ).length;
    const abortRate =
      lifecycle.length > 0
        ? Math.round((abortedEvents / lifecycle.length) * 100)
        : 0;

    return {
      totalCycles: lifecycle.filter((e) => e.phase === 'progress').length,
      totalSteps,
      completedSteps,
      failedSteps,
      avgStepDurationMs,
      avgReviewScore,
      reviewPassRate,
      toolFailureSteps,
      abortRate,
    };
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
    if (this.phase !== 'plan_pending') {
      const ck = readPdcaCheckpoint(this.taskId);
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

    this.setPhase('execute');
    logger.info('Plan approved, resuming PDCA execution', {
      taskId: this.taskId,
      planId: this.planId,
    });

    // 继续 EXECUTE → REVIEW → DECIDE 循环（复用统一执行循环，P0 抽取去重）
    return this._runExecuteDecideLoop();
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
    const plan = this.requirePlan();
    // P1-2（2026-08-31）：turn 预算上限——动态兜底（步骤数*5，最少 20）防误杀；
    // 显式配置 TASK_GOAL_MAX_TURNS 时优先作为硬上限（对标 Hermes goal_max_turns）
    const dynamicMax = Math.max(20, plan.steps.length * 5);
    const configuredMax = Number(configManager.env('TASK_GOAL_MAX_TURNS')) || 0;
    const maxIterations = configuredMax > 0 ? configuredMax : dynamicMax;
    this._maxTurns = maxIterations;

    while (!allDone && iterations < maxIterations) {
      iterations++;
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

      // P1-3（2026-08-31）：目标级收敛判定（对标 Hermes evaluate_after_turn）
      // 步骤全部终态后，用副模型确认"整体目标是否真正达成"；未收敛则阻止
      // "步骤全过但目标未实现"的假完成（转 failed，缺陷清单驱动增量 replan）
      if (allDone && isGoalEvaluateEnabled()) {
        const goalConv = await this.goalEvaluateGate.evaluate(
          {
            goal: latestPlan.description,
            steps: latestPlan.steps.map((s) => ({
              description: s.description,
              status: s.status,
              result: s.result,
              review: s.reviewResult?.summary,
            })),
          },
          { isolation: this.isolation, executor: this.executor }
        );
        // 方向4（2026-09-03）：收敛判定捕获 → review_samples 落库（评估关闭时不捕获）
        if (goalConv.evaluated) {
          this._goalEvaluation = {
            converged: goalConv.converged,
            confidence: goalConv.confidence,
            reason: goalConv.reason,
          };
        }
        if (goalConv.evaluated && !goalConv.converged) {
          logger.warn('目标级评估未收敛，阻止假完成', {
            taskId: this.taskId,
            planId: this.planId,
            reason: goalConv.reason,
            confidence: goalConv.confidence,
          });
          latestPlan.status = 'failed';
          latestPlan.completedAt = new Date().toISOString();
          taskOrchestrator['savePlan']?.(latestPlan);
          void handleError(
            new AppError(
              `目标未收敛：${goalConv.reason}`,
              ErrorCategory.OPERATION,
              ErrorSeverity.HIGH,
              'PDCA_GOAL_NOT_CONVERGED',
              {
                taskId: this.taskId,
                planId: this.planId,
                reason: goalConv.reason,
                confidence: goalConv.confidence,
              }
            ),
            { module: 'tasks:longRunning', action: 'runFullPdca' }
          );
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
          break;
        }
      }
    }

    // 标记终态
    if (allDone) {
      const finalPlan = this.requirePlan();
      const hasEscalated = finalPlan.steps.some(
        (s) => s.decision === 'escalate'
      );
      finalPlan.status = hasEscalated ? 'failed' : 'completed';
      finalPlan.completedAt = new Date().toISOString();
    }

    // 生成审计报告
    this.setPhase('completed');
    this.auditReport = this.generateReport();
    this.persistAuditReport(this.auditReport);
    this._recordLifecycle('finalized', TaskStatus.COMPLETED, 'PDCA completed');
    // S2（2026-08-13）：阶段边界落库 goal_metrics（row_type='stage'）
    this._recordGoalStageMetric('pdca_completed');
    // 3-1（2026-09-03）：PDCA 完成 → 轻量记忆回写（复盘决策入长期记忆，供跨会话 recall）
    this._persistMemoryFromAudit('completed');
    // 方向4（2026-09-03）：终态落评估样例（任务级评估集）
    this._persistReviewSample('pdca_completed');

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
   * P0(M9)：从 checkpoint 跨重启恢复执行（/goal resume 入口）。
   * 读取 checkpoint 中的 plan.steps 快照 → 重建 Plan 到 taskOrchestrator →
   * 回填步骤状态 → 按 phase 继续（plan_pending 等待审批；否则进入统一执行循环）。
   */
  async resumeFromCheckpoint(ck: Record<string, unknown>): Promise<PdcaStatus> {
    const sessionId = (ck.sessionId as string | undefined) ?? '';
    const steps =
      (ck.steps as Array<Record<string, unknown>> | undefined) ?? [];
    const phase = (ck.phase as string | undefined) ?? 'execute';

    // Gap D（1-0c，2026-09-03）：终态任务（abort/completed/failed）拒绝恢复。
    // 此前 abort 不写 checkpoint → /goal resume 会把已中止任务复活重跑；
    // status 演进后（1-0b）终态在 checkpoint.status/phase 双字段可见，此处双查。
    const ckStatus = ck.status as string | undefined;
    if (
      phase === 'completed' ||
      phase === 'abort' ||
      phase === 'failed' ||
      ckStatus === 'completed' ||
      ckStatus === 'abort' ||
      ckStatus === 'failed'
    ) {
      throw new AppError(
        `任务 ${this.taskId} 已处于终态（phase=${phase}, status=${ckStatus ?? '-'}），不可恢复`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        'PDCA_RESUME_TERMINAL',
        { taskId: this.taskId, phase, status: ckStatus }
      );
    }

    // 重建 Plan（新 taskId 由 taskOrchestrator 生成；workspaceId 从会话解析）
    const workspaceId = await taskOrchestrator.resolveWorkspaceId(sessionId);
    const restored = taskOrchestrator.createPlan(
      (ck.description as string | undefined) ?? '恢复的 PDCA 任务',
      steps.map((s) => (s.description as string | undefined) ?? ''),
      sessionId,
      undefined,
      undefined,
      workspaceId
    );
    // 1-1c（2026-09-03）：依赖恢复用快照顺序位置映射——
    // checkpoint 存的是旧 plan 的 stepId，resume 重建 plan 生成新 stepId，
    // 按快照中旧 stepId 的位置（== 重建后 steps 同一下标）换算依赖。
    const ckStepIds = steps.map((s) => (s.id as string | undefined) ?? '');
    // 回填步骤状态（executeAllSteps 会跳过 completed/failed/cancelled）
    steps.forEach((s, i) => {
      const step = restored.steps[i];
      if (!step) return;
      step.status = (s.status as PlanStep['status']) ?? 'pending';
      step.result = s.result as string | undefined;
      step.error = s.error as string | undefined;
      step.reviewResult = s.reviewResult as PlanReview | undefined;
      step.decision = s.decision as ReviewDecision | undefined;
      step.retryCount = (s.retryCount as number) ?? 0;
      step.maxRetries = (s.maxRetries as number) ?? 3;
      step.acceptanceCriteria = s.acceptanceCriteria as string | undefined;
      // 1-1c：恢复依赖（旧 stepId → 位置 → 新 stepId；仅前置、越界/缺失自愈忽略）
      const depIds = (s.dependsOn as string[] | undefined) ?? [];
      if (depIds.length > 0) {
        const mapped = depIds
          .map((d) => ckStepIds.indexOf(d))
          .filter((j) => j >= 0 && j < i && restored.steps[j]);
        if (mapped.length > 0) {
          step.dependsOn = mapped.map((j) => restored.steps[j].id);
        }
      }
    });
    restored.status = 'running';

    this.planId = restored.id;
    this._sessionId = sessionId || null;
    // D5（M6）：恢复 escalate 缺陷清单（增量 replan 输入跨重启保持）
    this._lastEscalations =
      (ck.lastEscalations as EscalationRecord[] | undefined) ?? [];
    // 1-1d（2026-09-03）：resume 回填 token 累计，防跨重启少计——
    // checkpoint 阶段边界已持久化 totalTokens（_persistCheckpoint），恢复续跑必须续上，
    // 否则终态 goal_metrics.total_tokens 从 0 起少计。
    this._totalTokensTracked = Number(ck.totalTokens) || 0;
    this._recordLifecycle(
      'started',
      TaskStatus.RUNNING,
      'PDCA resumed from checkpoint'
    );
    this._persistCheckpoint();

    logger.info('[orchestrator] 从 checkpoint 恢复', {
      taskId: this.taskId,
      planId: this.planId,
      phase,
      stepCount: steps.length,
    });

    if (phase === 'plan_pending') {
      this.setPhase('plan_pending');
      return this.getStatus(); // 等待审批
    }
    this.setPhase('execute');
    return this._runExecuteDecideLoop();
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

  // ─── 生命周期 ───────────────────────────────────────

  async abort(): Promise<void> {
    this.isolation.abort('User aborted');
    this._recordLifecycle('finalized', TaskStatus.FAILED, 'Aborted by user');
    // Gap D（1-0c，2026-09-03）：中止必须落 checkpoint 终态。
    // 原实现仅落库 goal_metrics、不写 checkpoint → phase 停留中止前值，
    // /goal list（按 phase∈completed/failed/abort 过滤）不过滤、scan 不回收该任务。
    // 注：LRTO.PdcaPhase 不含 'abort'（bridge 层类型含），此处直接写 checkpoint 文件。
    writePdcaCheckpoint(this.taskId, {
      phase: 'abort',
      status: 'abort',
      abortedAt: new Date().toISOString(),
    });
    syncPdcaWorkItemStatus(this.taskId, 'abort');
    // S2（2026-08-13）：中止路径同样落库（超时/失败节点）
    this._recordGoalStageMetric('pdca_aborted');
    // 3-1（2026-09-03）：PDCA 中止 → 轻量记忆回写（记录已执行部分与中止状态）
    this._persistMemoryFromAudit('aborted');
    // 方向4（2026-09-03）：终态落评估样例（任务级评估集）
    this._persistReviewSample('pdca_aborted');
  }

  /**
   * S2（2026-08-13）：阶段边界落库 goal_metrics（row_type='stage'，P1-5 §5 S2 + StageOrchestrator §4.6）
   * 仅在真实任务完成/中止时记录；写入失败不阻断主流程（fire-and-forget + handleError 降级日志）。
   */
  private _recordGoalStageMetric(stageId: string): void {
    const metrics = this.getMetrics();
    void goalMetricsService
      .init()
      .then(() =>
        goalMetricsService.recordStageMetric({
          goalId: this.taskId,
          sessionId: this._sessionId ?? '',
          stageId,
          maxTurns: this._maxTurns > 0 ? this._maxTurns : undefined,
          totalTurns: metrics.totalSteps,
          totalTokens: this._totalTokensTracked,
          durationMs: this._startedAt > 0 ? Date.now() - this._startedAt : 0,
        })
      )
      .catch((err) =>
        handleError(err, {
          module: 'tasks:longRunning',
          action: 'goalMetricsRecord',
          context: { taskId: this.taskId, stageId },
        })
      );
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
    void (async () => {
      try {
        const plan = this.planId
          ? taskOrchestrator.getPlan(this.planId)
          : undefined;
        if (!plan || plan.steps.length === 0) return;
        const goal = plan.description;
        const lines = plan.steps.map((s, i) => {
          const review = s.reviewResult
            ? `评分${s.reviewResult.score ?? '-'}${s.reviewResult.pass ? '(通过)' : '(未过)'}`
            : '';
          const deps =
            s.dependsOn && s.dependsOn.length > 0
              ? `(依赖${s.dependsOn.length}个前序)`
              : '';
          return `${i + 1}. ${s.description.slice(0, 120)} [${s.status}] 决策=${s.decision ?? '无'} ${review} ${deps}`.trim();
        });
        const content =
          `PDCA ${outcome === 'completed' ? '完成' : '中止'}复盘\n目标: ${goal.slice(0, 200)}\n步骤:\n${lines.join('\n')}`.slice(
            0,
            4000
          );

        const [mm, { createMemoryMetadata }, { MemoryType }] =
          await Promise.all([
            resolveMemoryWritebackManager(),
            import('../memory/types/MemoryMetadata.js'),
            import('../memory/types/MemoryType.js'),
          ]);
        if (!mm) return;
        await mm.createMemory({
          content,
          metadata: createMemoryMetadata({
            name: `PDCA ${outcome}: ${goal.slice(0, 40)}`,
            type: MemoryType.DECISION,
            tags: ['pdca', outcome, `task:${this.taskId}`],
            priority: 15,
          }),
        });
        logger.info('[orchestrator] PDCA 终态记忆回写完成', {
          taskId: this.taskId,
          outcome,
          stepCount: plan.steps.length,
        });
      } catch (err) {
        await handleError(err, {
          module: 'tasks:longRunning',
          action: 'memoryWriteback',
          context: { taskId: this.taskId, outcome },
        });
      }
    })();
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
    void (async () => {
      try {
        const plan = this.planId
          ? taskOrchestrator.getPlan(this.planId)
          : undefined;
        if (!plan || plan.steps.length === 0) return;
        const stepsJson = JSON.stringify(
          plan.steps.map((s) => ({
            id: s.id,
            description: s.description,
            status: s.status,
            decision: s.decision ?? null,
            dependsOn: s.dependsOn ?? [],
            retryCount: s.retryCount,
            maxRetries: s.maxRetries,
            reviewScore: s.reviewResult?.score ?? null,
            reviewPass: s.reviewResult?.pass ?? null,
            error: s.error ?? null,
          }))
        );
        const hasDeps = plan.steps.some(
          (s) => s.dependsOn && s.dependsOn.length > 0
        );
        // 自主度启发（对齐方向 4 Spec §4：可人工回填修正）
        const autonomyLevel =
          plan.steps.length >= 2 && hasDeps
            ? 5
            : plan.steps.length >= 2
              ? 4
              : 3;
        const metrics = this.getMetrics();
        await goalMetricsService.init();
        await goalMetricsService.recordReviewSample({
          pdcaTaskId: this.taskId,
          sessionId: this._sessionId ?? undefined,
          goalText: plan.description,
          stage,
          stepsJson,
          reviewPassRate: metrics.reviewPassRate,
          converged: this._goalEvaluation?.converged,
          confidence: this._goalEvaluation?.confidence,
          reason: this._goalEvaluation?.reason,
          autonomyLevel,
          totalTokens: this._totalTokensTracked,
          durationMs:
            this._startedAt > 0 ? Date.now() - this._startedAt : undefined,
        });
        logger.info('[orchestrator] PDCA 终态评估样例已落库', {
          taskId: this.taskId,
          stage,
          stepCount: plan.steps.length,
        });
      } catch (err) {
        await handleError(err, {
          module: 'tasks:longRunning',
          action: 'persistReviewSample',
          context: { taskId: this.taskId, stage },
        });
      }
    })();
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

export function getOrCreateOrchestrator(
  taskId: string
): LongRunningTaskOrchestrator {
  let orchestrator = activeOrchestrators.get(taskId);
  if (!orchestrator) {
    orchestrator = new LongRunningTaskOrchestrator(taskId);
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
