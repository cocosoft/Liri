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
import { resolveDataDir } from '@modules/core/paths';
import { trackUsage } from '@modules/ai';
import { taskOrchestrator } from './TaskOrchestrator';
import type { Plan, PlanStep, PlanProgress } from './TaskOrchestrator';
import { TaskStatus } from './types';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import { LifecycleTracker } from './LifecycleTracker';
import type { LifecycleEvent } from './LifecycleTracker';
import { createAgentIsolation, throwIfAborted } from '../agent/AgentIsolation';
import { computeToolNames, resolveToolsets } from '../tools/toolsets';
import { generateAuditReport } from './AuditReport';
import type { AuditReport } from './AuditReport';
import {
  parseReviewFromText,
  isReviewPassed,
  formatReviewSummary,
} from './PlanReview';
import type { PlanReview, ReviewDecision } from './PlanReview';
import { TAORLoop, createTAORLoopDeps } from '../query/TAORLoop.js';
import type { TAORLoopDeps } from '../query/TAORLoop.js';
import { VerifierAgent, createVerifierAgent } from '../query/VerifierAgent.js';
import type { VerificationResult } from '../query/VerifierAgent.js';
import { FileLockManager, fileLockManager } from './FileLockManager.js';
import { inboxManager } from '@modules/runtime/InboxManager.js';
import { syncPdcaWorkItemStatus } from './PdcaWorkItemBridge';
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
  | 'completed';

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

const REVIEWER_ROLE: RoleConfig = {
  name: 'Reviewer',
  toolsets: ['search', 'file'],
  systemPrompt:
    '你是一个任务审查员。对比验收标准和实际执行结果，给出审查意见。只读操作，不修改任何文件。输出 JSON 格式：{"pass":bool,"score":0-100,"issues":[],"summary":"..."}',
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

export class LongRunningTaskOrchestrator {
  private taskId: string;
  private planId: string | null = null;
  private phase: PdcaPhase = 'plan';
  private lifecycle: LifecycleTracker;
  private isolation: ReturnType<typeof createAgentIsolation>;
  private executor: ExecutorFn;
  /** §5 P1: 任务消息回写回调（runFullPdca 注入）与当前 sessionId */
  private _onTaskMessage?: (sessionId: string, msgs: TaskMessage[]) => void;
  private _sessionId: string | null = null;
  private decisionAwait: Promise<ReviewDecision> | null = null;
  private decisionResolve: ((d: ReviewDecision) => void) | null = null;
  private auditReport: AuditReport | null = null;
  private stepDurations: Map<string, { startMs: number; endMs?: number }> =
    new Map();
  /**
   * Phase 2: TAORLoop 统一编排器（ENABLE_LOOP_V8_PHASE2 时注入）
   */
  private taorLoop?: TAORLoop;
  /**
   * Phase 4: VerifierAgent（双指标验证：CheckPassRate + Confidence）
   */
  private verifier: VerifierAgent;
  /**
   * Phase 6: 文件级并发锁（多会话冲突保护）
   */
  readonly fileLockManager: FileLockManager;

  constructor(taskId: string, executor?: ExecutorFn) {
    this.taskId = taskId;
    this.lifecycle = new LifecycleTracker();
    this.isolation = createAgentIsolation(taskId);
    this.lifecycle.record('created', TaskStatus.PENDING);
    this.verifier = createVerifierAgent({ enabled: true });
    this.fileLockManager = fileLockManager;

    // 默认 executor：通过 AI 服务执行
    this.executor =
      executor ??
      (async (params) => {
        const { createAIService } = await import('../ai');
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
  }

  getTaskId(): string {
    return this.taskId;
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

  // ─── Phase 1: PLAN ──────────────────────────────────

  async executePlanPhase(
    description: string,
    sessionId: string
  ): Promise<Plan> {
    throwIfAborted(this.isolation);
    this.setPhase('plan');
    this.lifecycle.record('started', TaskStatus.RUNNING, 'Plan phase started');

    const otel = getOTelTracing();
    const span = otel.startSpan('pdca.plan', {
      'task.id': this.taskId,
      'session.id': sessionId,
    });

    try {
      // 让 Planner 分析并输出步骤
      const planPrompt = `请分析以下任务并输出 JSON 格式的执行计划：
任务描述: ${description}

输出格式：
{
  "steps": ["步骤1描述", "步骤2描述"],
  "acceptanceCriteria": ["步骤1的验收标准", "步骤2的验收标准"]
}`;

      const planText = await this.executor({
        systemPrompt: PLANNER_ROLE.systemPrompt,
        userPrompt: planPrompt,
        tools: computeToolNames(PLANNER_ROLE.toolsets),
        isolation: this.isolation,
      });

      // 解析 Planner 输出
      let steps: string[] = [description];
      let acceptance: string[] = [];

      try {
        const parsed = JSON.parse(planText);
        steps = parsed.steps || [description];
        acceptance = parsed.acceptanceCriteria || [];
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

      // 创建 Plan
      const plan = taskOrchestrator.createPlan(
        description,
        steps,
        sessionId,
        undefined,
        acceptance
      );

      this.planId = plan.id;
      this.lifecycle.record(
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

    for (const step of plan.steps) {
      if (this.isolation.abortController.signal.aborted) break;

      // 跳过已完成/失败/取消的步骤
      if (
        step.status === 'completed' ||
        step.status === 'failed' ||
        step.status === 'cancelled'
      ) {
        continue;
      }

      await this.executeSingleStep(step, plan);
    }

    // 检查全部完成
    this.setPhase('review');
    return taskOrchestrator.getPlan(this.planId)!;
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
      const { broadcastEvent } =
        await import('@modules/infrastructure/http/LocalHTTPServiceSSE.js');
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
  }

  private async executeSingleStep(step: PlanStep, plan: Plan): Promise<void> {
    taskOrchestrator.markStepRunning(step.id);
    this.stepDurations.set(step.id, { startMs: Date.now() });
    this.lifecycle.record(
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
    if (
      this.taorLoop &&
      configManager.env('ENABLE_LOOP_V8_PHASE2') !== 'false'
    ) {
      logger.info('[orchestrator] 进入 TAORLoop 分支（真实工具执行）', {
        taskId: this.taskId,
        stepId: step.id,
        toolNames: computeToolNames(EXECUTOR_ROLE.toolsets),
      });
      let taorStart = 0;
      try {
        const isolation = this.isolation;
        const executor = this.executor;
        const taskId = this.taskId;
        (this.taorLoop as any).config.sessionId = this.taskId;

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
        const result = await this.taorLoop.run(messages, deps);
        const taorElapsed = Date.now() - taorStart;

        taskOrchestrator.markStepCompleted(
          step.id,
          `[TAORLoop] turns=${result.turnCount} tokens=${result.totalTokens} elapsed=${taorElapsed}ms`
        );
        const log = (this.taorLoop as any).getLastRunLog?.();
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

      this.lifecycle.record(
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
      // §5 P1: 失败也回写执行摘要
      this._emitTaskMessage([
        {
          role: 'assistant',
          content: `[任务步骤失败] ${step.description} — ${errMsg}`,
        },
      ]);
      const dur = this.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();

      this.lifecycle.record(
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
      // 2026-08-06：PDCA C（Review）接入机械验证（verifyProject）——先跑编译/测试，
      // 结果作为 Reviewer 输入上下文，形成"机械验证 + LLM 语义审查"两级防线。
      let mechanicalVerify = '';
      try {
        const { verifyProject } = await import('../query/verifyProject.js');
        const verifyResult = await Promise.race([
          verifyProject(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('verify_timeout')), 30000)
          ),
        ]).catch((err) => `verify skipped: ${String(err)}`);
        if (typeof verifyResult === 'string' && verifyResult) {
          mechanicalVerify = verifyResult;
        }
      } catch (_err) {
        // @ignore-catch: 机械验证失败不阻塞 Review（降级为仅语义审查）
      }

      const reviewPrompt = [
        `审查以下步骤的执行结果：`,
        `步骤: ${step.description}`,
        step.acceptanceCriteria ? `验收标准: ${step.acceptanceCriteria}` : '',
        `实际输出: ${step.result || '(无输出)'}`,
        mechanicalVerify ? `机械验证结果:\n${mechanicalVerify}` : '',
        `请输出 JSON 审查结果: {"pass":bool,"score":0-100,"issues":[{"severity":"critical|major|minor","description":"..."}],"summary":"..."}`,
      ].join('\n');

      const reviewText = await this.executor({
        systemPrompt: REVIEWER_ROLE.systemPrompt,
        userPrompt: reviewPrompt,
        tools: computeToolNames(REVIEWER_ROLE.toolsets),
        isolation: this.isolation,
      });

      const review = parseReviewFromText(reviewText, stepId);
      step.reviewResult = review;

      // Phase 4: VerifierAgent 双指标验证
      try {
        const verifyResult = await this.verifier.verify(
          {
            messages: [
              { role: 'system', content: REVIEWER_ROLE.systemPrompt },
              { role: 'user', content: reviewPrompt },
              { role: 'assistant', content: reviewText },
            ],
            toolResults: [],
            turnCount: 0,
            sessionId: this.taskId,
          },
          this.isolation.abortController.signal
        );

        const { passed, confidence, verdict } = verifyResult;

        // VerifierAgent 判定集成到 Review
        if (!passed) {
          if (verdict === 'REJECT') {
            review.pass = false;
            review.issues.push({
              severity: 'major',
              description: `VerifierAgent REJECT: confidence=${confidence.toFixed(2)}`,
            });
          } else if (verdict === 'ESCALATE') {
            review.pass = false;
            review.issues.push({
              severity: 'critical',
              description: `VerifierAgent ESCALATE: confidence=${confidence.toFixed(2)}，需人工介入。反馈：${verifyResult.feedback || '无'}`,
            });
          }
        }
        // APPROVE 时保持 Reviewer 原有评分

        span.setAttribute('review.verifierVerdict', verdict);
        span.setAttribute('review.verifierConfidence', confidence);
      } catch (verifyErr) {
        logger.warn(
          'VerifierAgent failed in reviewStep, continuing with Reviewer score only',
          {
            error: String(verifyErr),
          }
        );
      }

      this.lifecycle.record(
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
          this.lifecycle.record(
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
            this.lifecycle.record(
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
          this.lifecycle.record(
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
          this.lifecycle.record(
            'progress',
            TaskStatus.RUNNING,
            `Skipped: ${step.description}`
          );
          break;

        case 'escalate':
          step.status = 'failed';
          this.lifecycle.record(
            'progress',
            TaskStatus.RUNNING,
            `Escalated: ${step.description}`
          );
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
   * 自动决策：审查通过 → approve，未通过且可重试 → retry，否则 escalate
   */
  async autoDecideStep(stepId: string): Promise<ReviewDecision> {
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    if (!step.reviewResult) {
      await this.reviewStep(stepId);
    }

    const isPassed = step.reviewResult
      ? isReviewPassed(step.reviewResult)
      : false;
    const maxRetries = step.maxRetries ?? 3;

    let decision: ReviewDecision;
    if (isPassed) {
      decision = 'approved';
    } else if (step.retryCount < maxRetries) {
      decision = 'retry';
    } else {
      decision = 'escalate';
    }

    logger.info('[orchestrator] autoDecideStep 决策', {
      taskId: this.taskId,
      planId: this.planId,
      stepId: step.id,
      stepDesc: step.description.slice(0, 60),
      decision,
      isPassed,
      retryCount: step.retryCount,
      maxRetries,
      reviewScore: step.reviewResult?.score,
      reviewPass: step.reviewResult?.pass,
      reviewIssues: step.reviewResult?.issues
        ?.slice(0, 3)
        .map((i) => `${i.severity}:${i.description}`.slice(0, 80)),
      remainingRetries: maxRetries - step.retryCount,
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
    const requireApproval = opts?.requirePlanApproval ?? false;

    const pdcaStart = Date.now();
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

    let allDone = false;
    let iterations = 0;
    // 动态上限：步骤数 * 5，最少 20，防止长任务被误杀
    const maxIterations = Math.max(20, plan.steps.length * 5);

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
    this.lifecycle.record('finalized', TaskStatus.COMPLETED, 'PDCA completed');

    // §5 P2: 任务完成事件广播（前端按 sessionId 过滤渲染）
    const _finalStatus = this.getStatus();
    void this._emitTaskEvent('task:completed', {
      sessionId: this._sessionId ?? '',
      planId: this.planId,
      status: _finalStatus.phase,
    });

    const pdcaElapsed = Date.now() - pdcaStart;
    logger.info('[orchestrator] runFullPdca 结束', {
      taskId: this.taskId,
      planId: this.planId,
      phase: _finalStatus.phase,
      totalElapsedMs: pdcaElapsed,
      stepCount: _finalStatus.plan?.steps.length ?? 0,
      iterations,
    });

    return _finalStatus;
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

    // 平均每步耗时
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
   * 审批通过后从 plan_pending 阶段恢复执行
   * 继续 PDCA 的 EXECUTE → REVIEW → DECIDE 循环
   */
  async resumeAfterApproval(sessionId: string): Promise<PdcaStatus> {
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

    // 继续 EXECUTE → REVIEW → DECIDE 循环（与 runFullPdca 的后半段相同）
    let allDone = false;
    let iterations = 0;
    const plan = this.requirePlan();
    const maxIterations = Math.max(20, plan.steps.length * 5);

    while (!allDone && iterations < maxIterations) {
      iterations++;
      await this.executeAllSteps();

      const updatedPlan = this.requirePlan();
      for (const step of updatedPlan.steps) {
        if (step.status === 'completed' && !step.decision) {
          await this.autoDecideStep(step.id);
        }
      }

      const latestPlan = this.requirePlan();
      const terminalStatuses = ['completed', 'failed', 'cancelled'] as const;
      allDone = latestPlan.steps.every((s) =>
        (terminalStatuses as readonly string[]).includes(s.status)
      );

      if (!allDone) {
        const hasRetry = latestPlan.steps.some(
          (s) => s.status === 'pending' && s.decision === undefined
        );
        if (!hasRetry && iterations >= maxIterations) {
          latestPlan.status = 'failed';
          latestPlan.completedAt = new Date().toISOString();
          taskOrchestrator['savePlan']?.(latestPlan);
          void handleError(
            new AppError(
              'PDCA exceeded max iterations after approval',
              ErrorCategory.OPERATION,
              ErrorSeverity.HIGH,
              'PDCA_MAX_ITERATIONS_APPROVAL',
              {
                taskId: this.taskId,
                iterations,
                maxIterations,
              }
            ),
            { module: 'tasks:longRunning', action: 'runFullPdca' }
          );
        }
      }
    }

    this.setPhase('completed');
    this.auditReport = this.generateReport();
    this.persistAuditReport(this.auditReport);
    this.lifecycle.record('finalized', TaskStatus.COMPLETED, 'PDCA completed');
    return this.getStatus();
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
    this.lifecycle.record('finalized', TaskStatus.FAILED, 'Aborted by user');
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
