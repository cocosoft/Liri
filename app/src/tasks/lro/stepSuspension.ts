// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepSuspension — 步骤级审批挂起的**落点与恢复**（PR-5，2026-10-23）
 *
 * 背景（方案 §3.10.6）：LRO 步骤内工具可返回 `requireApproval`，旧实现把它当普通结果
 * 进证据 ⇒ 审查门判"未产出" ⇒ retry/escalate（**把等审批当成模型失败**）。
 *
 * 现口径：
 * - 审查门 `decide` 见 `toolOutcomes.pendingApproval > 0` ⇒ `suspend`；
 * - 编排循环见任一 `decision==='suspend'` ⇒ 阶段转 `stage_awaiting_approval` 并**早退**
 *   （不落 completed / failed，也不进入目标级评估）；
 * - 用户批准后（`inboxApproval` → `resumeAfterApproval`）把挂起步骤置回 `pending` 重跑。
 *
 * 为什么外移：`LongRunningTaskOrchestrator` 已接近 R04-001 的 2000 行上限；
 * 本模块只做纯状态搬运 + 一次审计日志，不持有状态。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { PdcaPhase } from '@modules/tasks/phases';
import type { Plan, PlanStep } from '../TaskOrchestrator';
import {
  STEP_STATUS_COMPLETED,
  STEP_STATUS_FAILED,
  STEP_STATUS_PENDING,
} from '../TaskOrchestrator';
import type { PdcaStatus } from './contracts.js';
import { emitPdcaReceipt } from './terminalReceipt.js';
// 2026-11-08：挂起轮次持久化（跨重启累计；超上限后停止循环）
import { readPdcaCheckpoint, writePdcaCheckpoint } from '../PdcaWorkItemBridge';

const logger = getLogger('tasks:longRunning');

/** 挂起等待审批的步骤（`decision==='suspend'`） */
export function listSuspendedSteps(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => s.decision === 'suspend');
}

/**
 * 在等人工审批的步骤（2026-11-07 真机）。
 *
 * 批次调度用：`executeAllSteps` 在每批结束后调用 —— 有任一步的工具结果
 * `pendingApproval > 0` 时**不得**再启动后续批次，否则依赖步骤会基于"尚未执行"的
 * 产物空转（真机：step_1 的 bash 被 ask 挂起后，step_2/3 仍并行跑了数分钟）。
 */
export function listStepsAwaitingApproval(plan: Plan): PlanStep[] {
  return plan.steps.filter((s) => (s.toolOutcomes?.pendingApproval ?? 0) > 0);
}

/** 是否有步骤在等人工审批（挂起决策 或 工具结果标记） */
export function hasPendingApproval(plan: Plan): boolean {
  return (
    listSuspendedSteps(plan).length > 0 ||
    listStepsAwaitingApproval(plan).length > 0
  );
}

/**
 * 2026-11-07 真机：批次/轮次调度的「待审批」短路判定（有则落一条日志）。
 *
 * - `batch`：本批结束后**不得**再启动后续批次 —— 否则依赖步骤会基于"尚未执行"的产物
 *   空转（真机 step_1 被 ask 挂起后 step_2/3 仍并行跑了数分钟）；
 * - `iteration`：本轮结束后**直接退出** PDCA 循环，交给 `suspendPlanForApproval` 落
 *   `stage_awaiting_approval` —— 否则下一轮会继续执行依赖步骤，且目标级评估会把
 *   "等待审批"判成未收敛（plan.status=failed + P2 告警）。
 */
export function shouldStopForPendingApproval(
  scope: 'batch' | 'iteration',
  taskId: string,
  planId: string | null,
  plan: Plan
): boolean {
  if (!hasPendingApproval(plan)) return false;
  logger.warn(
    scope === 'batch'
      ? '[orchestrator] 检测到待审批步骤 ⇒ 停止后续批次'
      : '[orchestrator] 存在待审批步骤 ⇒ 结束本轮循环，等待人工审批',
    {
      taskId,
      planId,
      stepIds: [
        ...listSuspendedSteps(plan),
        ...listStepsAwaitingApproval(plan),
      ].map((s) => s.id),
    }
  );
  return true;
}

/**
 * 把挂起步骤置回 `pending` 并清 `decision`（**保留** result / 其余工具证据）。
 *
 * 2026-11-07（隐藏缺陷）：`toolOutcomes.pendingApproval` 必须**清零** —— 它同时是
 * 「批次/轮次调度判据」的输入（`listStepsAwaitingApproval`）。恢复后若该步不在首批执行
 * （依赖未满足），旧计数会让后续批次继续短路 ⇒ 再次挂起但**没有新卡**（永久等待）。
 *
 * @returns 被恢复的步骤 id 列表（空 = 没有可恢复的挂起步骤）
 */
export function resumeSuspendedSteps(plan: Plan): string[] {
  const resumed: string[] = [];
  for (const step of plan.steps) {
    if (step.decision === 'suspend') {
      step.status = STEP_STATUS_PENDING;
      step.decision = undefined;
      // 2026-11-08（真机 `pdca_mw760faj`）：**旧审查结论必须作废** —— 挂起前那条审查是
      // "命令未执行（等审批）"的结论；恢复后重跑会产出新证据，但 `autoDecideStep` 见
      // `reviewResult` 已存在就**跳过重新审查**、直接按旧结论判 `retry` ⇒ 白跑一轮执行
      // （真机进度 50%→25%，多一次完整步骤执行 + 审查）。
      step.reviewResult = undefined;
      if (step.toolOutcomes) {
        // 2026-11-08（真机 `pdca_mw6wxxk1`）：**只清计数不够** —— `outcomes[]` 里的条目仍带
        // `pendingApproval: true`，而计数现在按条目重算（`summarizeToolOutcomes` /
        // `mergeToolOutcomeSummaries`）⇒ 已批准的"待审批"被复活，任务再次挂起却**不会再提交
        // 新卡**（卡在 stage_awaiting_approval、收件箱里一条 pending 都没有，用户无处可点）。
        // 恢复语义：这些条目代表"未执行"，批准后应作废（不是证据），一并剔除。
        const kept = step.toolOutcomes.outcomes.filter(
          (o) => !o.pendingApproval
        );
        step.toolOutcomes = {
          ...step.toolOutcomes,
          outcomes: kept,
          total: kept.length,
          pendingApproval: 0,
        };
      }
      resumed.push(step.id);
    }
  }
  return resumed;
}

/**
 * 同一任务最多**连续无进展**地「挂起等审批」的轮次（2026-11-08，真机 `pdca_mw6vophl`）。
 *
 * 为什么会无限循环：每次批准后模型换一条**等价但不同**的命令（`node -e …` → `node a.js`
 * → `del a.js` → `node b.js`…），每条都要独立人工批准 ⇒ "挂起 → 批准 → 再挂起"永不收敛，
 * 用户永远点不完（该任务实测连续 3 张卡仍在挂起）。
 *
 * 2026-11-08（真机 `pdca_mw6z3y1o`）：**只数"没有新增完成步骤"的连续轮次** —— 绝对次数会把
 * 正常任务误杀：4 条不同命令本就该各批一次，旧实现批准 3 次后（每轮都多完成一步）第 4 条
 * 直接判 `[SUSPEND_LIMIT]`，任务在 20% 失败。有进展 ⇒ 计数重置为 1。
 *
 * 超过上限 ⇒ 不再挂起：把挂起步如实标 failed 并交给终态裁决（escalate / 待 replan），
 * 让会话里出现 ⚠️ 结论，而不是再弹一张卡。
 */
export const MAX_SUSPEND_ROUNDS_PER_TASK = 3;

/**
 * 本轮挂起的"无进展连击"值（纯函数，供单测）。
 *
 * @param prevStreak    上次挂起时的连击值
 * @param prevCompleted 上次挂起时的**已完成步数最高水位**
 * @param completedNow  本次挂起时的已完成步数
 */
export function nextSuspendStreak(input: {
  prevStreak: number;
  prevCompleted: number;
  completedNow: number;
}): number {
  return input.completedNow > input.prevCompleted ? 1 : input.prevStreak + 1;
}

/** 是否已达到"连续无进展挂起"上限 */
export function isSuspendLimitReached(streak: number): boolean {
  return streak > MAX_SUSPEND_ROUNDS_PER_TASK;
}

/** 读取本任务的挂起连击与已完成步数最高水位（检查点持久化，跨重启累计） */
async function readSuspendState(
  taskId: string
): Promise<{ streak: number; completed: number }> {
  const ck = await readPdcaCheckpoint(taskId);
  const raw = (ck ?? {}) as {
    suspendRounds?: unknown;
    suspendCompleted?: unknown;
  };
  return {
    streak: Number(raw.suspendRounds) || 0,
    completed: Number(raw.suspendCompleted) || 0,
  };
}

/**
 * 若计划中有挂起步骤 ⇒ 阶段转 `stage_awaiting_approval`、落检查点并返回当前状态；
 * 否则返回 `null`（调用方继续走既有终态裁决）。
 *
 * 超过 `MAX_SUSPEND_ROUNDS_PER_TASK` ⇒ 不再挂起，返回 `null`（挂起步如实标 failed）。
 */
export async function suspendPlanForApproval(args: {
  taskId: string;
  planId: string | null;
  plan: Plan;
  setPhase: (phase: PdcaPhase) => Promise<void>;
  persistCheckpoint: () => Promise<void>;
  getStatus: () => PdcaStatus;
  /** 有推送通道（CLI/REPL 的 `onTaskMessage`）⇒ 不发回执，避免同一结果两条消息 */
  hasPushChannel?: boolean;
}): Promise<PdcaStatus | null> {
  const suspended = listSuspendedSteps(args.plan);
  if (suspended.length === 0) return null;

  const state = await readSuspendState(args.taskId);
  // 已完成步数（含"产物已写好、只剩一条命令等批准"的挂起步）—— 它增长即代表本轮有实际进展
  const completedNow = args.plan.steps.filter(
    (s) => s.status === STEP_STATUS_COMPLETED
  ).length;
  const streak = nextSuspendStreak({
    prevStreak: state.streak,
    prevCompleted: state.completed,
    completedNow,
  });
  if (isSuspendLimitReached(streak)) {
    for (const step of suspended) {
      step.status = STEP_STATUS_FAILED;
      step.error =
        `[SUSPEND_LIMIT] 连续 ${streak} 次挂起等待审批都没有新增完成步骤（命令反复变化，每条都要单独批准）；` +
        '已停止该步骤。请调整权限/改用其它实现方式后 replan。';
    }
    await args.persistCheckpoint();
    logger.warn('[orchestrator] 挂起轮次达上限 ⇒ 停止再挂起，交终态裁决', {
      taskId: args.taskId,
      planId: args.planId,
      streak,
      completedNow,
      max: MAX_SUSPEND_ROUNDS_PER_TASK,
      stepIds: suspended.map((s) => s.id),
    });
    return null;
  }
  // 已完成步数取**最高水位**：审查重试会把已通过的步置回 pending，水位不能被冲掉
  await writePdcaCheckpoint(args.taskId, {
    suspendRounds: streak,
    suspendCompleted: Math.max(state.completed, completedNow),
  });

  await args.setPhase('stage_awaiting_approval');
  await args.persistCheckpoint();
  // 2026-11-08：挂起回执（HTTP 启动的任务会话此前只有这一条消息，也是审批卡的承载消息）
  emitPdcaReceipt({
    taskId: args.taskId,
    sessionId: args.plan.sessionId,
    phase: 'stage_awaiting_approval',
    // 挂起时"可见步骤恰好全部完成"是常态（产物已写好，只剩一条命令等批准）⇒ 必须显式标注，
    // 否则文案会误报「✅ 完成」（真机 `pdca_mw6tie3k`）
    paused: true,
    completed: args.plan.steps.filter((s) => s.status === STEP_STATUS_COMPLETED)
      .length,
    total: args.plan.steps.length,
    failed: args.plan.steps.filter((s) => s.status === STEP_STATUS_FAILED)
      .length,
    hasPushChannel: args.hasPushChannel,
  });
  logger.info('[orchestrator] PDCA 挂起：等待人工审批', {
    taskId: args.taskId,
    planId: args.planId,
    steps: suspended.map((s) => ({
      id: s.id,
      pendingApproval: s.toolOutcomes?.pendingApproval ?? 0,
    })),
  });
  return args.getStatus();
}
