// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepReviewDecide —— LRTO 的 REVIEW / DECIDE 阶段（LRO 拆分批 U-22/S3）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `_buildReviewGateContext` /
 * `reviewStep` / `decideStep` / `autoDecideStep`。
 *
 * **职责（单一：一步的审查与处置）**：
 *   ① 构建 ReviewGate 上下文（taskId/planId/step/isolation/executor/verifier）；
 *   ② `reviewStep`：委托 ReviewGate 审查并落 `step.reviewResult`；
 *   ③ `decideStep`：approved / retry（含上限升级 escalate）/ skip / escalate 的**唯一处置点**；
 *   ④ `autoDecideStep`：门关闭 ⇒ 直接批准；否则审查 + `reviewGate.decide` + 阶段广播。
 *
 * **行为等价**：日志文案/字段、OTel span、重试与升级语义、广播载荷**逐字未变**。
 */

import { SpanStatusCode } from '@opentelemetry/api';

import { handleError } from '@modules/error';
import { getLogger, getOTelTracing } from '@modules/monitoring';
import { throwIfAborted } from '@modules/agent';

import { emitPdcaLiveEvent } from '../PdcaLiveEvents';
import { formatReviewSummary } from '../PlanReview';
import type { PlanReview, ReviewDecision } from '../PlanReview';
import type { PlanStep } from '../TaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
import { TaskStatus } from '../types';
import type { ExecutorFn } from './contracts.js';
import type { ReviewGate, ReviewGateContext } from '../review/ReviewGate.js';

const logger = getLogger('tasks:longRunning');

export interface StepReviewDecideDeps {
  taskId: string;
  planId: string | null;
  sessionId: string | null;
  isolation: Parameters<ExecutorFn>[0]['isolation'];
  executor: ExecutorFn;
  verifier: ReviewGateContext['verifier'];
  reviewGate: ReviewGate;
  getPlan: (planId: string) => Plan | null;
  recordLifecycle: (phase: string, status: TaskStatus, detail?: string) => void;
  recordEscalation: (step: PlanStep) => Promise<void>;
  /** 上一轮该步骤耗时（毫秒；未跑过 ⇒ undefined） */
  previousStepDurationMs: (stepId: string) => number | undefined;
}

/** 构建 ReviewGate 执行上下文（Orchestrator 运行时依赖注入） */
export function buildReviewGateContext(
  deps: StepReviewDecideDeps,
  step: PlanStep
): ReviewGateContext {
  return {
    taskId: deps.taskId,
    planId: deps.planId!,
    step,
    isolation: deps.isolation,
    executor: deps.executor,
    verifier: deps.verifier,
  };
}

/** Phase 3: REVIEW —— 委托 ReviewGate 审查单步。 */
export async function reviewStep(
  stepId: string,
  deps: StepReviewDecideDeps
): Promise<PlanReview> {
  throwIfAborted(deps.isolation);
  if (!deps.planId) throw new Error('No plan created');

  const plan = deps.getPlan(deps.planId)!;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);

  const otel = getOTelTracing();
  const span = otel.startSpan('pdca.review', {
    'task.id': deps.taskId,
    'plan.id': deps.planId,
    'step.id': stepId,
  });

  try {
    // 委托 ReviewGate 执行审查（默认实现：机械验证 + LLM Reviewer + VerifierAgent 双指标）
    const review = await deps.reviewGate.reviewStep(
      buildReviewGateContext(deps, step)
    );
    step.reviewResult = review;

    deps.recordLifecycle(
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
      context: { taskId: deps.taskId, stepId },
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    throw e;
  }
}

/** Phase 4: DECIDE —— 单步处置的唯一入口。 */
export async function decideStep(
  stepId: string,
  decision: ReviewDecision,
  deps: StepReviewDecideDeps
): Promise<void> {
  throwIfAborted(deps.isolation);
  if (!deps.planId) throw new Error('No plan created');

  const plan = deps.getPlan(deps.planId)!;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);

  const otel = getOTelTracing();
  const span = otel.startSpan('pdca.decide', {
    'task.id': deps.taskId,
    'plan.id': deps.planId,
    'step.id': stepId,
    decision: decision,
  });

  try {
    step.decision = decision;

    switch (decision) {
      case 'approved':
        // 已完成，无需更多操作
        deps.recordLifecycle(
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
          await deps.recordEscalation(step);
          deps.recordLifecycle(
            'progress',
            TaskStatus.RUNNING,
            `Retry limit exceeded for: ${step.description}`
          );
          logger.warn('[orchestrator] 重试上限超标，升级为 escalate', {
            taskId: deps.taskId,
            planId: deps.planId,
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
        deps.recordLifecycle(
          'progress',
          TaskStatus.RUNNING,
          `Retry #${step.retryCount} for: ${step.description}`
        );
        logger.info('[orchestrator] 步骤重试已就绪', {
          taskId: deps.taskId,
          planId: deps.planId,
          stepId: step.id,
          stepDesc: step.description.slice(0, 60),
          retryCount: step.retryCount,
          maxRetries,
          prevDurationMs: deps.previousStepDurationMs(step.id),
        });
        break;
      }

      case 'skip':
        step.status = 'cancelled';
        deps.recordLifecycle(
          'progress',
          TaskStatus.RUNNING,
          `Skipped: ${step.description}`
        );
        break;

      case 'escalate':
        step.status = 'failed';
        deps.recordLifecycle(
          'progress',
          TaskStatus.RUNNING,
          `Escalated: ${step.description}`
        );
        // D5（M6）：捕获缺陷清单 → 增量 replan 输入（基线 + 缺陷 → 局部修订）
        await deps.recordEscalation(step);
        break;

      /**
       * PR-5（2026-10-23）：本步有工具调用在等人工审批 ⇒ **挂起**。
       *
       * 不改步骤状态（保持 completed + 证据）、不判失败、不计重试：
       * 编排循环见 `decision==='suspend'` 时置阶段 `stage_awaiting_approval` 并停止，
       * 获批后由 `resumeAfterApproval` 把该步置回 pending 重跑。
       */
      case 'suspend':
        deps.recordLifecycle(
          'progress',
          TaskStatus.RUNNING,
          `Suspend awaiting approval: ${step.description}`
        );
        logger.info('[orchestrator] 步骤挂起：等待人工审批', {
          taskId: deps.taskId,
          planId: deps.planId,
          stepId: step.id,
          pendingApproval: step.toolOutcomes?.pendingApproval ?? 0,
        });
        break;
    }

    otel.endSpan(span, SpanStatusCode.OK);
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'decideStep',
      context: { taskId: deps.taskId, stepId },
    });
    otel.recordError(span, e instanceof Error ? e : new Error(String(e)));
    otel.endSpan(span, SpanStatusCode.ERROR, String(e));
    throw e;
  }
}

/**
 * 自动决策：委托 ReviewGate.decide（默认：审查通过 → approve，未通过且可重试 → retry，否则 escalate）
 * 若 ReviewGate.shouldReview 返回 false（如 disabled 模式），直接 approve。
 */
export async function autoDecideStep(
  stepId: string,
  deps: StepReviewDecideDeps
): Promise<ReviewDecision> {
  if (!deps.planId) throw new Error('No plan created');

  const plan = deps.getPlan(deps.planId)!;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);

  const gateCtx = buildReviewGateContext(deps, step);

  // 门关闭：跳过审查直接批准（NoopReviewGate / disabled 模式）
  if (!deps.reviewGate.shouldReview(gateCtx)) {
    logger.info('[orchestrator] ReviewGate 关闭，直接批准', {
      taskId: deps.taskId,
      planId: deps.planId,
      stepId: step.id,
      stepDesc: step.description.slice(0, 60),
      gateName: deps.reviewGate.name,
    });
    await decideStep(stepId, 'approved', deps);
    // OBS/C3（2026-09-06）：链条 A 阶段（decision 结果）广播
    void emitPdcaLiveEvent(
      'pdca:stage:phase',
      {
        taskId: deps.taskId,
        planId: deps.planId ?? undefined,
        sessionId: deps.sessionId ?? '',
      },
      {
        stage: 'decide',
        status: 'completed',
        decision: 'approved',
        message: '步骤决策: approved（审查通过）',
        stepId: step.id,
      }
    );
    return 'approved';
  }

  if (!step.reviewResult) {
    await reviewStep(stepId, deps);
  }

  const decision = await deps.reviewGate.decide(
    buildReviewGateContext(deps, step)
  );

  logger.info('[orchestrator] autoDecideStep 决策', {
    taskId: deps.taskId,
    planId: deps.planId,
    stepId: step.id,
    stepDesc: step.description.slice(0, 60),
    decision,
    reviewScore: step.reviewResult?.score,
    reviewPass: step.reviewResult?.pass,
    reviewIssues: step.reviewResult?.issues
      ?.slice(0, 3)
      .map((i) => `${i.severity}:${i.description}`.slice(0, 80)),
    remainingRetries:
      (step.maxRetries ?? deps.reviewGate.getConfig().maxRetries) -
      step.retryCount,
  });

  await decideStep(stepId, decision, deps);
  // OBS/C3（2026-09-06）：链条 A 阶段（decision 结果）广播——retry 语义为进入下一轮 Do
  void emitPdcaLiveEvent(
    'pdca:stage:phase',
    {
      taskId: deps.taskId,
      planId: deps.planId ?? undefined,
      sessionId: deps.sessionId ?? '',
    },
    {
      stage: 'decide',
      status: decision === 'retry' ? 'running' : 'completed',
      decision,
      message: `步骤决策: ${decision}`,
      stepId: step.id,
    }
  );
  return decision;
}
