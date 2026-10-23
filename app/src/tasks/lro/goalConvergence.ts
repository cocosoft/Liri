// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalConvergence — 目标级收敛判定与「未收敛」收尾（PR-5 外移，2026-10-23）
 *
 * **来源**：从 `LongRunningTaskOrchestrator._runExecuteDecideLoop` 外移「步骤全部终态后
 * 的目标级收敛判定」整段（P1-3 / L7 / U-02 的既有逻辑**逐字未变**）。
 *
 * **为什么外移**：宿主已逼近 R04-001 的 2000 行上限；本段是循环内**唯一**可独立成篇的
 * 闭环（评估 → 阻止假完成 → 可选自动 replan），宿主只需按 `kind` 分派控制流。
 *
 * **行为等价**：日志字段、错误码（`PDCA_GOAL_NOT_CONVERGED`）、检查点字段、评估开关
 * （`PDCA_GOAL_EVALUATE`）与自动 replan 开关（`PDCA_AUTO_REPLAN`）语义全部保持原样。
 */

import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

import { taskOrchestrator, PLAN_STATUS_FAILED } from '../TaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import {
  isGoalEvaluateEnabled,
  type GoalEvaluateContext,
  type GoalEvaluateGate,
} from '../review/GoalEvaluateGate.js';
import { isAutoReplanEnabled, replanMaxRetries } from './portResolvers.js';
import type { PdcaStatus } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/** 收敛判定的收尾结论（调用方据此决定是否早退 / 继续终态裁决） */
export type GoalConvergenceOutcome =
  | { kind: 'continue' }
  | { kind: 'replanned'; status: PdcaStatus }
  | { kind: 'unconverged'; failureReason: string };

export interface GoalConvergenceDeps {
  taskId: string;
  planId: string | null;
  sessionId: string | null;
  plan: Plan;
  gate: GoalEvaluateGate;
  /** 副模型调用上下文（isolation + executor） */
  ctx: GoalEvaluateContext;
  totalTokens: number;
  turnsExtensions: number;
  startedAt: number;
  /** 收敛判定快照（写入宿主的 `_goalEvaluation`，供评估样例落库） */
  setGoalEvaluation: (value: {
    converged: boolean | undefined;
    confidence: number;
    reason?: string;
  }) => void;
  /** 自动 replan：复用宿主「缺陷驱动增量 replan」入口 */
  resumeFromCheckpoint: (ck: Record<string, unknown>) => Promise<PdcaStatus>;
}

/**
 * P1-3（2026-08-31）：目标级收敛判定（对标 Hermes evaluate_after_turn）。
 *
 * 步骤全部终态后用副模型确认"整体目标是否真正达成"；未收敛则阻止
 * "步骤全过但目标未实现"的假完成（转 failed，缺陷清单驱动增量 replan）。
 */
export async function runGoalConvergenceGate(
  deps: GoalConvergenceDeps
): Promise<GoalConvergenceOutcome> {
  if (!isGoalEvaluateEnabled()) return { kind: 'continue' };
  const { plan, taskId, planId } = deps;

  const goalConv = await deps.gate.evaluate(
    {
      goal: plan.description,
      steps: plan.steps.map((s) => ({
        description: s.description,
        status: s.status,
        result: s.result,
        review: s.reviewResult?.summary,
      })),
    },
    deps.ctx
  );
  // 方向4（2026-09-03）：收敛判定捕获 → review_samples 落库（评估关闭时不捕获）。
  // L7（2026-09-06）三态：未决 undefined 也如实记录（converged 存 null），
  // 避免审计/记忆把"跳过结论"误报成"已确认达成"。
  deps.setGoalEvaluation({
    converged: goalConv.converged,
    confidence: goalConv.confidence,
    reason: goalConv.reason,
  });
  // L7（2026-09-06）：仅模型明确 false 才阻止假完成——undefined（评估失败/超时/
  // 未给明确 bool）按"跳过结论"处理，不阻塞主流程也不误判未达成。
  if (goalConv.converged !== false) return { kind: 'continue' };

  logger.warn('目标级评估未收敛，阻止假完成', {
    taskId,
    planId,
    reason: goalConv.reason,
    confidence: goalConv.confidence,
  });
  plan.status = PLAN_STATUS_FAILED;
  plan.completedAt = new Date().toISOString();
  taskOrchestrator['savePlan']?.(plan);
  void handleError(
    new AppError(
      `目标未收敛：${goalConv.reason}`,
      ErrorCategory.OPERATION,
      ErrorSeverity.HIGH,
      'PDCA_GOAL_NOT_CONVERGED',
      {
        taskId,
        planId,
        reason: goalConv.reason,
        confidence: goalConv.confidence,
      }
    ),
    { module: 'tasks:longRunning', action: 'runFullPdca' }
  );

  // U-02（2026-10-19）：**目标控制器**（默认关闭，`PDCA_AUTO_REPLAN=true` 开启）。
  // 未收敛不再直接收场：写 replanPending 检查点后复用「缺陷驱动增量 replan」闭环
  // 立即重规划续跑；次数与 escalate 共用计数（PDCA_REPLAN_MAX_RETRIES）。
  if (isAutoReplanEnabled()) {
    const prevCk = (await readPdcaCheckpoint(taskId)) ?? {};
    const next = (Number(prevCk.replanFailCount) || 0) + 1;
    if (next < replanMaxRetries()) {
      const autoReplanCk = {
        ...prevCk,
        taskId,
        sessionId: deps.sessionId ?? undefined,
        phase: 'execute',
        status: PLAN_STATUS_FAILED,
        replanPending: true,
        replanFailCount: next,
        description: plan.description,
        totalTokens: deps.totalTokens,
        turnsExtensions: deps.turnsExtensions,
        startedAt: deps.startedAt || undefined,
        lastEscalations: [
          {
            stepId: '',
            stepDescription: plan.description,
            defects: [goalConv.reason],
          },
        ],
      };
      await writePdcaCheckpoint(taskId, autoReplanCk);
      logger.info('[orchestrator] 目标未收敛 ⇒ 自动 replan', {
        taskId,
        replanFailCount: next,
        maxReplan: replanMaxRetries(),
      });
      return {
        kind: 'replanned',
        status: await deps.resumeFromCheckpoint(
          autoReplanCk as Record<string, unknown>
        ),
      };
    }
    logger.warn('[orchestrator] 目标未收敛且 replan 预算耗尽，转人工', {
      taskId,
      replanFailCount: next,
      maxReplan: replanMaxRetries(),
    });
  }

  return { kind: 'unconverged', failureReason: 'PDCA_GOAL_NOT_CONVERGED' };
}
