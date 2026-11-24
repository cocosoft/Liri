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

import { getLogger } from '@openliri/infra/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@openliri/infra/error';

import {
  taskOrchestrator,
  PLAN_STATUS_FAILED,
  PLAN_STATUS_RUNNING,
  PLAN_ACCEPTANCE_ACCEPTED,
  PLAN_ACCEPTANCE_PENDING,
  PLAN_ACCEPTANCE_REJECTED,
} from '../TaskOrchestrator';
import type { Plan } from '../TaskOrchestrator';
// P2-1（2026-11-24，R09-013）：计划状态转移审计（唯一入口）
import { auditPlanStatusChange } from '../plan/planStatusAudit';
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';
import {
  isGoalEvaluateEnabled,
  type GoalEvaluateContext,
  type GoalEvaluateGate,
} from '../review/GoalEvaluateGate.js';
import {
  isAutoReplanEnabled,
  isPendingAcceptanceEnabled,
  replanMaxRetries,
} from './portResolvers.js';
import type { PdcaStatus } from './contracts.js';

const logger = getLogger('tasks:longRunning');

/** 收敛判定的收尾结论（调用方据此决定是否早退 / 继续终态裁决） */
export type GoalConvergenceOutcome =
  | { kind: 'continue' }
  | { kind: 'replanned'; status: PdcaStatus }
  /**
   * G5-D3（2026-11-18）：步骤全终态但目标门**未决**（超时/降级），且开关
   * `PDCA_PENDING_ACCEPTANCE` 打开 ⇒ 「已执行，待验收」：不置 completed、不判失败，
   * 计划保持 `running`（`acceptance='pending'`），由 `/resume` 收口。
   */
  | { kind: 'pendingAcceptance' }
  /**
   * `detail`：目标门给出的**可读原因**（2026-11-08，真机 `pdca_mw7tuuy5`）。
   * 此前只回错误码 ⇒ 终态 lifecycle 只有 `PDCA failed: PDCA_GOAL_NOT_CONVERGED`，
   * 用户看不到"为什么失败"（真正的 reason 只在日志里）。
   */
  | { kind: 'unconverged'; failureReason: string; detail?: string };

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
        // 2026-11-09（真机 `pdca_mw8nknox`）：带上产物台账 ⇒ 目标门可回读**最终产物**取证，
        // 避免仅凭历史审查文本判未收敛（假失败 + 全量 replan）。
        artifacts: s.artifacts,
        // G5-D5（2026-11-18）：验收标准随评估输入下发（盲审口径下作为判定依据）
        acceptanceCriteria: s.acceptanceCriteria,
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
  // G5-D1/D3（2026-11-18）：目标门给出**明确**结论时落验收子态（纯数据，不改控制流）。
  // `undefined`（评估失败/超时/降级）默认保持缺省（消费方按「缺省 = accepted」兼容旧数据）；
  // `PDCA_PENDING_ACCEPTANCE` 打开（**2026-11-19 起默认开**）时落 `pending`。
  if (goalConv.converged === true) {
    plan.acceptance = PLAN_ACCEPTANCE_ACCEPTED;
  } else if (goalConv.converged === false) {
    plan.acceptance = PLAN_ACCEPTANCE_REJECTED;
  } else if (
    isPendingAcceptanceEnabled() &&
    // 2026-11-19（翻默认开的安全护栏）：**既有明确否定不被"未决"降级** ——
    // `rejected` 是上一轮目标门给出的明确结论，本次"超时/降级"不足以推翻它
    // （旧数据/重跑场景）；此时保持原值走旧口径（与开关关时逐字一致）。
    // 用例：`goalConvergenceAcceptance.test.ts`「旧数据缺省不误判」。
    plan.acceptance !== PLAN_ACCEPTANCE_REJECTED
  ) {
    // G5-D3（2026-11-18）：未决（超时/降级/未给明确 bool）⇒「已执行，待验收」。
    // 既不谎报完成，也不判失败：计划保持 running，用户可 `/resume` 重跑目标门收口。
    // 注意：`PDCA_GOAL_EVALUATE=false` 已在函数入口早退（不会走到这里），
    // 避免"评估被关闭 ⇒ 永远待验收"的组合。
    plan.acceptance = PLAN_ACCEPTANCE_PENDING;
    // 2026-11-19（真机 `pdca_mwna1g2b`）：**把"保持 running"真正落实**。
    // 步骤全部落终态时 `TaskOrchestrator._settlePlanFinalStatus` 已把计划置 `completed`
    // （早于目标门，属既有行为）⇒ 此处不显式回退，就会出现
    // `status=completed` 与 `acceptance=pending` 自相矛盾：① 前端"待验收"徽标
    // （条件为 `running && pending`）永不命中；② 计划终态语义与回执「待验收」冲突。
    // 与设计 §3/§4-2「计划保持 running」一致（开关开才走本分支 ⇒ 默认行为不变）。
    auditPlanStatusChange(plan, PLAN_STATUS_RUNNING, 'goal_pending_acceptance');
    plan.status = PLAN_STATUS_RUNNING;
    delete plan.completedAt;
    taskOrchestrator['savePlan']?.(plan);
    logger.info('目标级评估未决 ⇒ 待验收（不置 completed）', {
      taskId,
      planId,
      confidence: goalConv.confidence,
      reason: goalConv.reason,
    });
    return { kind: 'pendingAcceptance' };
  }
  // 2026-11-09：成功路径也留一条可断言记录（验收脚本据此确认"目标门确实执行过"，
  // 避免场景 A 在评估从未到达时被"没有未收敛标记"误判为通过）。
  logger.info('目标级评估完成', {
    taskId,
    planId,
    converged: goalConv.converged,
    confidence: goalConv.confidence,
    evaluated: goalConv.evaluated,
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
  auditPlanStatusChange(plan, PLAN_STATUS_FAILED, 'goal_not_converged');
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

  return {
    kind: 'unconverged',
    failureReason: 'PDCA_GOAL_NOT_CONVERGED',
    // 2026-11-08（真机 `pdca_mw7tuuy5`）：带上可读原因，终态 detail 不再只有错误码
    detail: goalConv.reason,
  };
}
