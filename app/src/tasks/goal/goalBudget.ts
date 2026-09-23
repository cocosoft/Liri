// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * goalBudget —— **任务级预算 + 触顶收尾**（M-8，2026-09-22）
 *
 * 方案要求（§10.4 M-8）：`tokenBudget` 触顶 ⇒ 按 `budget_limit` 模板收尾并落
 * `budget_limited`，**不静默截断**。
 *
 * 分层（spec §3 D4）：本模块是**策略层**，只做两件事：
 * 1. 记账（委托 `TaskGoalStore.addUsage`，累加写）；
 * 2. 触顶判定 + **落状态**（`budget_limited`，终态幂等）+ 产出**收尾指令**。
 * 它**不**自己发消息、也**不**改上下文预算 —— 收尾指令交调用方注入（保持可测、可组合）。
 */

import { getTaskGoalStore, type TaskGoalStore } from './TaskGoalStore';
import { renderGoalTemplate } from './goalTemplates';

/** 一次记账的结果 */
export interface GoalBudgetChargeResult {
  goalId: string;
  /** 记账后的累计用量 */
  tokensUsed: number;
  /** 任务级预算（未设 ⇒ undefined，语义为"不限"） */
  tokenBudget?: number;
  /** 本次记账后是否已触顶（`tokensUsed >= tokenBudget`） */
  exceeded: boolean;
  /** 本次调用是否**首次**把目标落为 `budget_limited`（幂等：重复调用恒 false） */
  statusChanged: boolean;
  /**
   * 触顶时的**收尾指令**（`budget_limit` 模板渲染）。
   *
   * 语义：只要 `exceeded` 为真就给出（便于调用方在任意时刻取用）；
   * 是否"应当据它收尾"由调用方结合 `statusChanged` 判断（避免重复收尾）。
   */
  closingInstruction?: string;
}

/**
 * 记一笔用量并判定触顶。
 *
 * @returns 目标不存在 ⇒ `null`（不抛：预算记账属观测面，缺失目标不应中断执行）
 */
export async function chargeGoalUsage(params: {
  goalId: string;
  tokens: number;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<GoalBudgetChargeResult | null> {
  const store = params.store ?? getTaskGoalStore();
  const tokensUsed = await store.addUsage(params.goalId, params.tokens);
  if (tokensUsed === null) return null;

  const goal = await store.get(params.goalId);
  if (!goal) return null;

  const budget = goal.tokenBudget;
  const exceeded = budget !== undefined && tokensUsed >= budget;
  if (!exceeded) {
    return {
      goalId: goal.id,
      tokensUsed,
      tokenBudget: budget,
      exceeded: false,
      statusChanged: false,
    };
  }

  // 触顶：落 `budget_limited`（终态幂等 —— 已是终态时 `updateStatus` 返回 false，
  // 从而"首次收尾"与"重复记账"可被调用方区分）
  const statusChanged = await store.updateStatus(goal.id, 'budget_limited');
  return {
    goalId: goal.id,
    tokensUsed,
    tokenBudget: budget,
    exceeded: true,
    statusChanged,
    closingInstruction: renderGoalTemplate('budget_limit', {
      tokensUsed,
      tokenBudget: budget,
    }),
  };
}
