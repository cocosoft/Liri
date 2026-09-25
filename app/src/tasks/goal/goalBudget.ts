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
 *
 * X8（2026-09-23）：**主会话**这一半也在此层 —— `chargeSessionGoalUsage`（把主会话用量
 * 记到该会话的目标上）与 `injectMainSessionBudgetWrapUp`（触顶后下一轮请求前经 steering
 * 注入收尾指令，幂等由持久化标记保证）。swarm 批次那一半仍在
 * `goalRunBinding.settleGoalForRun` / `GoalEvents.takeBatchGoalInstruction`，两者互不重复记账。
 */

import { getTaskGoalStore, type TaskGoalStore } from './TaskGoalStore';
import {
  emitGoalStatusChanged,
  takeMainSessionBudgetWrapUp,
} from './GoalEvents';
import { renderGoalTemplate } from './goalTemplates';
// P2-10（2026-09-25）：任务级触顶判定收敛到**统一预算策略层**（纯计算、无 IO）
import {
  evaluateGoalBudget,
  TokenBudgetStatus,
} from '@modules/core/tokenBudget/BudgetPolicy';

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
 * **B2-5 / D4ⓑ（2026-09-23）**：记账与晋升合并为**原子**路径
 * （`TaskGoalStore.addUsageAndPromote`）—— 触顶判定与 `budget_limited` 写入在同一条
 * 条件 UPDATE 内求值，消除旧"两步法"（`addUsage` → `updateStatus`）之间的一致窗口；
 * `promoted`（= 首次晋升）即 `statusChanged`，是"收尾只报一次"的唯一判据。
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
  // 先取归属会话（事件是**会话级**；`addUsageAndPromote` 只回记账事实，不含 sessionId）
  const before = await store.get(params.goalId);
  if (!before) return null;

  const charged = await store.addUsageAndPromote(params.goalId, params.tokens);
  if (!charged) return null;
  const { tokensUsed, tokenBudget: budget, promoted, from } = charged;

  // P2-10：触顶判定经**统一策略层**（语义等价于原 `budget !== undefined && tokensUsed >= budget`）
  // —— 策略为纯计算 ⇒ 阈值判定可独立单测，且"预算是多少、为何这个值"有了单一入口。
  // 记账 / 落事件 / steering 注入（幂等与可重建语义）**保持不动**。
  const exceeded =
    evaluateGoalBudget({ tokensUsed, tokenBudget: budget }).status ===
    TokenBudgetStatus.EXCEEDED;
  if (!exceeded) {
    return {
      goalId: before.id,
      tokensUsed,
      tokenBudget: budget,
      exceeded: false,
      statusChanged: false,
    };
  }

  // 触顶：`promoted` 由**单条条件 UPDATE** 的 `changes` 给出 ⇒ 恰好一次为 true
  //（并发 N 路记账不会重复报收尾；终态不可改写 ⇒ 重复记账恒 false）。
  // B2-2（2026-09-23）：首次晋升**成对落事件**（"为何停下"因此可由事件日志重建）。
  if (promoted) {
    await emitGoalStatusChanged({
      sessionId: before.sessionId,
      goalId: before.id,
      from: from ?? before.status,
      to: 'budget_limited',
      reason: 'budget_limit',
      tokensUsed,
      tokenBudget: budget,
    });
  }
  return {
    goalId: before.id,
    tokensUsed,
    tokenBudget: budget,
    exceeded: true,
    statusChanged: promoted,
    closingInstruction: renderGoalTemplate('budget_limit', {
      tokensUsed,
      tokenBudget: budget,
    }),
  };
}

/**
 * **主会话用量入账**：把一次 LLM 响应的 token 记到该会话**当前未终结目标**上
 * （X8，2026-09-23；Spec §5.5）。
 *
 * 与 swarm 批次路径（`settleGoalForRun` 的 `tokens` = 批次 worker 汇总用量）**不重复计数**：
 * 两者是**不同来源的真实用量** —— 批次侧计入 worker 消耗，此处计入主会话编排自身的
 * prompt/completion；同一 token 不会被两条路径各记一次。
 *
 * 单目标口径与 `goalRunBinding` 一致（只取 `listActive` 的**第一个** —— 一会话一目标，
 * Spec §N4）。**调用方负责 fire-and-forget 与失败留痕**（记账属观测面，不阻塞响应）。
 *
 * @returns 该会话无未终结目标 ⇒ `null`（零影响：不建行、不写库）
 */
export async function chargeSessionGoalUsage(params: {
  sessionId: string;
  tokens: number;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<GoalBudgetChargeResult | null> {
  const store = params.store ?? getTaskGoalStore();
  const goal = (await store.listActive(params.sessionId))[0];
  if (!goal) return null;
  return chargeGoalUsage({ goalId: goal.id, tokens: params.tokens, store });
}

/**
 * 主会话预算触顶 ⇒ **下一次请求前**经 steering 注入 `budget_limit` 收尾指令
 * （X8，2026-09-23；Spec §5.5）。
 *
 * 三件事的组合点：① **认领**（幂等，持久化标记 `budget_limit_reported_at`）；
 * ② **渲染 + 落盘**（委托 `GoalEvents.takeMainSessionBudgetWrapUp` ⇒ §1.6 红线）；
 * ③ 交给 **steering 通道**（由调用方注入 ⇒ 本模块不持有具体 loop，保持策略层可测）。
 *
 * **时机**：由编排层在**每轮请求前的既有闸门**调用（`ReActToolLoop.beforeReasoning`，
 * 即 `checkBeforeRequest` 调用处）—— 注入进 steering 队列，在**下一轮请求前**生效；
 * 本函数**不主动发起任何请求**（软停语义）。
 *
 * **幂等**：`claimBudgetLimitWrapUp` 的**单条条件 UPDATE + `changes` 判首次**保证
 * "每个目标至多注入一次"，且跨实例 / 重启后同样成立（不用内存 flag）。
 *
 * @returns 本次实际注入的 `{goalId, text}`；无待收尾目标 / 已被认领 ⇒ `undefined`（调用方 no-op）
 */
export async function injectMainSessionBudgetWrapUp(params: {
  sessionId: string;
  /** steering 注入器（编排层提供，如 `ReActToolLoop.queueSteering`） */
  steer: (text: string) => void;
  /** 可注入 store（测试用）；缺省取全局单例 */
  store?: TaskGoalStore;
}): Promise<{ goalId: string; text: string } | undefined> {
  const store = params.store ?? getTaskGoalStore();
  const goal = await store.claimBudgetLimitWrapUp(params.sessionId);
  if (!goal) return undefined;
  // 渲染与落盘**先于**注入（§1.6：模型看到了什么必须可从事件逐字重建）
  const text = await takeMainSessionBudgetWrapUp({
    sessionId: params.sessionId,
    goalId: goal.id,
    tokensUsed: goal.tokensUsed,
    tokenBudget: goal.tokenBudget,
  });
  params.steer(text);
  return { goalId: goal.id, text };
}
