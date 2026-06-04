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

import { Logger } from '@modules/monitoring/logs/Logger';
import { taskOrchestrator } from './TaskOrchestrator';
import type { Plan, PlanStep, PlanProgress } from './TaskOrchestrator';
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

const logger = new Logger();

/** PDCA 阶段 */
export type PdcaPhase = 'plan' | 'execute' | 'review' | 'decide' | 'completed';

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

export class LongRunningTaskOrchestrator {
  private taskId: string;
  private planId: string | null = null;
  private phase: PdcaPhase = 'plan';
  private lifecycle: LifecycleTracker;
  private isolation: ReturnType<typeof createAgentIsolation>;
  private executor: ExecutorFn;
  private decisionAwait: Promise<ReviewDecision> | null = null;
  private decisionResolve: ((d: ReviewDecision) => void) | null = null;
  private auditReport: AuditReport | null = null;
  private stepDurations: Map<string, { startMs: number; endMs?: number }> =
    new Map();

  constructor(taskId: string, executor?: ExecutorFn) {
    this.taskId = taskId;
    this.lifecycle = new LifecycleTracker();
    this.isolation = createAgentIsolation(taskId);
    this.lifecycle.record('created', 'pending' as any);

    // 默认 executor：通过 AI 服务执行
    this.executor =
      executor ??
      (async (params) => {
        try {
          const { createAIService } = await import('../ai');
          // FIXME: 迁移到新的 AIService API（generate/stream 替代 chat）
          const service = createAIService({
            defaultModel: 'claude-sonnet-4-20250514',
            apiKey: process.env.ANTHROPIC_API_KEY || '',
          } as any);
          const response = await (service as any).chat({
            messages: [
              { role: 'system', content: params.systemPrompt },
              { role: 'user', content: params.userPrompt },
            ],
          });
          return typeof response === 'string' ? response : response?.content ?? '';
        } catch (e) {
          logger.warn('AI executor failed, using mock', { error: String(e) });
          return `[模拟输出] 执行完成: ${params.userPrompt.slice(0, 100)}`;
        }
      });
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

  // ─── Phase 1: PLAN ──────────────────────────────────

  async executePlanPhase(description: string, sessionId: string): Promise<Plan> {
    throwIfAborted(this.isolation);
    this.phase = 'plan';
    this.lifecycle.record('started', 'running' as any, 'Plan phase started');

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
    } catch {
      // 非 JSON 输出，按行分割
      const lines = planText.split('\n').filter((l) => l.trim());
      if (lines.length > 1) {
        steps = lines.slice(0, 10);
      }
    }

    // 创建 Plan
    const plan = taskOrchestrator.createPlan(
      description,
      steps,
      sessionId,
      undefined,
      acceptance,
    );

    this.planId = plan.id;
    this.lifecycle.record('progress', 'running' as any, `Plan created with ${steps.length} steps`);

    return plan;
  }

  // ─── Phase 2: EXECUTE ──────────────────────────────

  async executeAllSteps(): Promise<Plan> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    this.phase = 'execute';
    const plan = taskOrchestrator.getPlan(this.planId)!;
    plan.status = 'running';

    for (const step of plan.steps) {
      if (this.isolation.abortController.signal.aborted) break;

      // 跳过已完成/失败/取消的步骤
      if (step.status === 'completed' || step.status === 'failed' || step.status === 'cancelled') {
        continue;
      }

      await this.executeSingleStep(step, plan);
    }

    // 检查全部完成
    this.phase = 'review';
    return taskOrchestrator.getPlan(this.planId)!;
  }

  private async executeSingleStep(step: PlanStep, plan: Plan): Promise<void> {
    taskOrchestrator.markStepRunning(step.id);
    this.stepDurations.set(step.id, { startMs: Date.now() });
    this.lifecycle.record('progress', 'running' as any, `Executing step: ${step.description}`);

    const execPrompt = [
      `执行以下步骤: ${step.description}`,
      step.acceptanceCriteria
        ? `验收标准: ${step.acceptanceCriteria}`
        : '',
      step.reviewResult
        ? `注意: 上次审查发现以下问题，本次请修正：\n${step.reviewResult.issues.map((i) => `- ${i.description}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    try {
      const result = await this.executor({
        systemPrompt: EXECUTOR_ROLE.systemPrompt,
        userPrompt: execPrompt,
        tools: computeToolNames(EXECUTOR_ROLE.toolsets),
        isolation: this.isolation,
      });

      taskOrchestrator.markStepCompleted(step.id, result);
      const dur = this.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();

      this.lifecycle.record(
        'progress',
        'running' as any,
        `Step completed: ${step.description}`,
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      taskOrchestrator.markStepFailed(step.id, errMsg);
      const dur = this.stepDurations.get(step.id);
      if (dur) dur.endMs = Date.now();

      this.lifecycle.record(
        'progress',
        'running' as any,
        `Step failed: ${step.description} — ${errMsg}`,
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

    const reviewPrompt = [
      `审查以下步骤的执行结果：`,
      `步骤: ${step.description}`,
      step.acceptanceCriteria
        ? `验收标准: ${step.acceptanceCriteria}`
        : '',
      `实际输出: ${step.result || '(无输出)'}`,
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

    this.lifecycle.record(
      'progress',
      'running' as any,
      `Review: ${formatReviewSummary(review)}`,
    );

    return review;
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

  async decideStep(
    stepId: string,
    decision: ReviewDecision,
  ): Promise<void> {
    throwIfAborted(this.isolation);
    if (!this.planId) throw new Error('No plan created');

    const plan = taskOrchestrator.getPlan(this.planId)!;
    const step = plan.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Step not found: ${stepId}`);

    step.decision = decision;

    switch (decision) {
      case 'approved':
        // 已完成，无需更多操作
        this.lifecycle.record(
          'progress',
          'running' as any,
          `Approved: ${step.description}`,
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
            'running' as any,
            `Retry limit exceeded for: ${step.description}`,
          );
          break;
        }

        // 重置状态准备重试
        step.status = 'pending';
        step.retryCount++;
        step.decision = undefined;
        step.reviewResult = undefined;
        this.lifecycle.record(
          'progress',
          'running' as any,
          `Retry #${step.retryCount} for: ${step.description}`,
        );
        break;
      }

      case 'skip':
        step.status = 'cancelled';
        this.lifecycle.record(
          'progress',
          'running' as any,
          `Skipped: ${step.description}`,
        );
        break;

      case 'escalate':
        step.status = 'failed';
        this.lifecycle.record(
          'progress',
          'running' as any,
          `Escalated: ${step.description}`,
        );
        break;
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

    const isPassed = step.reviewResult ? isReviewPassed(step.reviewResult) : false;
    const maxRetries = step.maxRetries ?? 3;

    let decision: ReviewDecision;
    if (isPassed) {
      decision = 'approved';
    } else if (step.retryCount < maxRetries) {
      decision = 'retry';
    } else {
      decision = 'escalate';
    }

    await this.decideStep(stepId, decision);
    return decision;
  }

  // ─── 全流程自动化 ───────────────────────────────────

  /**
   * 运行完整 PDCA 流程：Plan → Execute → Review → Decide
   * 自动循环直到所有步骤完成或失败。
   */
  async runFullPdca(description: string, sessionId: string): Promise<PdcaStatus> {
    // Plan
    const plan = await this.executePlanPhase(description, sessionId);

    let allDone = false;
    while (!allDone) {
      // Execute
      await this.executeAllSteps();

      // Review + Decide
      const updatedPlan = taskOrchestrator.getPlan(this.planId!)!;
      for (const step of updatedPlan.steps) {
        if (step.status === 'completed' && !step.decision) {
          await this.autoDecideStep(step.id);
        }
      }

      // 重新执行 retry 步骤
      const latestPlan = taskOrchestrator.getPlan(this.planId!)!;
      const hasRetry = latestPlan.steps.some(
        (s) => s.status === 'pending' && s.decision === undefined,
      );
      const hasEscalated = latestPlan.steps.some(
        (s) => s.decision === 'escalate',
      );

      if (!hasRetry) {
        allDone = true;
        if (hasEscalated) {
          latestPlan.status = 'failed';
        } else {
          latestPlan.status = 'completed';
          latestPlan.completedAt = new Date().toISOString();
        }
      }
    }

    // 生成审计报告
    this.phase = 'completed';
    this.auditReport = this.generateReport();
    this.lifecycle.record('finalized', 'completed' as any, 'PDCA completed');

    return this.getStatus();
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
          durationMs: dur
            ? (dur.endMs ?? Date.now()) - dur.startMs
            : 0,
          error: s.error,
        };
      }),
    });
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

  // ─── 生命周期 ───────────────────────────────────────

  async abort(): Promise<void> {
    this.isolation.abort('User aborted');
    this.lifecycle.record('finalized', 'failed' as any, 'Aborted by user');
  }

  async shutdown(): Promise<void> {
    this.isolation.cleanup();
  }
}

/** 活跃的 PDCA 编排器实例 */
const activeOrchestrators = new Map<string, LongRunningTaskOrchestrator>();

export function getOrCreateOrchestrator(
  taskId: string,
): LongRunningTaskOrchestrator {
  let orchestrator = activeOrchestrators.get(taskId);
  if (!orchestrator) {
    orchestrator = new LongRunningTaskOrchestrator(taskId);
    activeOrchestrators.set(taskId, orchestrator);
  }
  return orchestrator;
}

export function getOrchestrator(
  taskId: string,
): LongRunningTaskOrchestrator | undefined {
  return activeOrchestrators.get(taskId);
}

export function getAllOrchestrators(): LongRunningTaskOrchestrator[] {
  return Array.from(activeOrchestrators.values());
}
