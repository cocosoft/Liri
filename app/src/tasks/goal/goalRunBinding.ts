// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalRunBinding —— 把**执行结果**绑到**目标状态**上（M-6/M-7 接线，2026-09-22）
 *
 * 为什么需要：M-6（`TaskGoalStore`）与 M-8（`chargeGoalUsage`）落地后**没有生产消费方**
 * ⇒ 长程任务的"为何停下"仍无人写入。本模块是**首个接线点**：让并行批次收口时，
 * 若该会话存在未终结目标，就按批次结果落定目标状态。
 *
 * 设计约束（零回归优先）：
 * - **无目标 ⇒ 什么都不做**（返回 `null`，不建行、不写库）⇒ 对既有批次路径**零影响**；
 * - **不新建目标**：目标由显式路径创建（当前无自动创建入口），本模块只"落状态"；
 *   避免"每个批次都生成一行 goal"的噪声（也避免替用户决定目标是什么）；
 * - 状态映射：`全通过 ⇒ completed`、`部分成功 ⇒ blocked`（未达成但非全败，
 *   需后续介入才能推进）、`全失败 ⇒ failed`、`批次取消 ⇒ cancelled`；
 * - **停止条件**（2026-09-22）：连续 `blocked` 达 `NO_PROGRESS_STOP_THRESHOLD` ⇒
 *   不再停留非终态，落 `failed` + `progress_stalled` 指令（详见 `settleGoalForRun`）。
 */

import { getTaskGoalStore, type TaskGoalStore } from './TaskGoalStore';
import { chargeGoalUsage } from './goalBudget';
import { renderGoalTemplate } from './goalTemplates';

/** 批次收口的事实（由调用方从 `AgentSwarmResult` 派生，避免本模块依赖 swarm 类型） */
export interface GoalRunOutcome {
  /** 该批次**全部** worker 通过（gate fail-closed 后的 `allPassed`） */
  allPassed: boolean;
  /** 成功 worker 数 */
  okCount: number;
  /** 批次是否被取消（收尾阶段取消也算） */
  cancelled: boolean;
}

export interface GoalRunSettlement {
  goalId: string;
  /**
   * 落定的状态。
   * - `budget_limited`：因用量触顶收尾；
   * - `failed`：本次批次全败，**或**连续未达成达停止阈值（见 `NO_PROGRESS_STOP_THRESHOLD`）。
   */
  status: 'completed' | 'blocked' | 'failed' | 'cancelled' | 'budget_limited';
  /** 触顶时的**收尾指令**（`budget_limit` 模板渲染；未触顶 ⇒ undefined） */
  closingInstruction?: string;
  /** **停止条件**成立时的指令（`progress_stalled` 模板渲染）⇒ 该次已落终态 */
  stopInstruction?: string;
  /** 本次记账后的连续未达成批次数（仅 `blocked` 路径给出） */
  noProgressStreak?: number;
}

/**
 * **停止条件阈值**（连续未达成批次数）：达此值即判定"停滞"，落终态 `failed` 并停止推进。
 *
 * 取值依据：与 `ReActToolLoop` 的**轮级无进展熔断**同量级（`maxRepeatedRounds ?? 3`，
 * 见 `ReActLoop` 注释"连续 N 轮工具名+状态签名完全相同 ⇒ 视为死循环"）—— 轮级用 3，
 * 批次级（粒度更粗、代价更高）沿用 3，避免两处阈值口径分裂。
 */
export const NO_PROGRESS_STOP_THRESHOLD = 3;

/** 目标状态映射（纯函数，便于单测；见文件头"状态映射"说明） */
export function deriveGoalStatus(
  outcome: GoalRunOutcome
): GoalRunSettlement['status'] {
  if (outcome.cancelled) return 'cancelled';
  if (outcome.allPassed) return 'completed';
  if (outcome.okCount > 0) return 'blocked';
  return 'failed';
}

/**
 * 批次收口 ⇒ 落定该会话**未终结目标**的状态（无目标 ⇒ `null`）。
 *
 * 只取**第一个**未终结目标（`listActive` 按创建时间升序）—— 同一会话同时推进多个
 * 长程目标属未支持场景（当前无创建入口），此处不做多头映射的投机设计。
 *
 * **停止条件**（2026-09-22）：批次落到"部分成功"（`blocked`）时对
 * `no_progress_streak` 计数；达 `NO_PROGRESS_STOP_THRESHOLD` ⇒ **不再让它停留
 * `blocked`**（`blocked` 是非终态、会被 `listActive` 反复选中续推，不收敛），
 * 改落终态 `failed` 并给出 `progress_stalled` 指令 —— "为何停下"因此有唯一答案。
 */
export async function settleGoalForRun(params: {
  sessionId?: string;
  outcome: GoalRunOutcome;
  /** 本批次 worker **真实用量**（未提供 / ≤0 ⇒ 不记账，也不触顶） */
  tokens?: number;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<GoalRunSettlement | null> {
  const { sessionId, outcome } = params;
  if (!sessionId) return null; // 无归属会话 ⇒ 无目标可落
  const store = params.store ?? getTaskGoalStore();

  const active = await store.listActive(sessionId);
  const goal = active[0];
  if (!goal) return null; // 该会话没有未终结目标 ⇒ 零影响

  // M-8：**先记账** —— 触顶则落 `budget_limited`（终态）并给出收尾指令，
  // 不再按批次结果落定（"预算受限"是比"本次跑成没跑成"更高优先的结论）。
  const tokens = params.tokens ?? 0;
  if (tokens > 0) {
    const charge = await chargeGoalUsage({ goalId: goal.id, tokens, store });
    if (charge?.exceeded) {
      return {
        goalId: goal.id,
        status: 'budget_limited',
        closingInstruction: charge.closingInstruction,
      };
    }
  }

  const derived = deriveGoalStatus(outcome);
  let status: GoalRunSettlement['status'] = derived;
  let stopInstruction: string | undefined;
  let noProgressStreak: number | undefined;

  // 停止条件：只有"部分成功"（`blocked`）才计入连续无进展——
  // `completed` 是达成（终态）、`cancelled`/`failed` 本就是终态，均无需计数。
  if (derived === 'blocked') {
    const streak = await store.bumpNoProgressStreak(goal.id);
    noProgressStreak = streak ?? undefined;
    if (streak !== null && streak >= NO_PROGRESS_STOP_THRESHOLD) {
      status = 'failed';
      stopInstruction = renderGoalTemplate('progress_stalled', {
        streak,
        objective: goal.objective,
      });
    }
  }

  const changed = await store.updateStatus(goal.id, status);
  if (!changed) {
    // **同态情形**（`blocked → blocked`）：状态机按 I4/D2 拒绝"同态自迁移"，
    // 但本次收口的**计数确实推进了** ⇒ 如实返回事实，不谎报"什么都没发生"。
    // 其余未变更情形（并发下被他人先落定 / 目标已是终态）⇒ `null`，不谎报"本次落定"。
    if (status === 'blocked' && goal.status === 'blocked') {
      return { goalId: goal.id, status, noProgressStreak };
    }
    return null;
  }
  return {
    goalId: goal.id,
    status,
    ...(stopInstruction ? { stopInstruction } : {}),
    ...(noProgressStreak !== undefined ? { noProgressStreak } : {}),
  };
}
