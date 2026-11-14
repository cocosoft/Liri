// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `/plan preview` 的选择逻辑（D7 二期，2026-11-14）
 *
 * 目的：给"计划影响预演"一个**用户入口**（此前只有库函数与续跑指令在用）。
 * 选择口径（纯函数，确定性）：
 * 1. 指定 `planId`（支持前缀）⇒ 唯一命中才返回；
 * 2. 未指定 ⇒ 只在该会话的计划里挑：**优先未终态**（`running`/`pending`），其次按最近心跳倒序；
 * 3. 无候选 ⇒ `null`（命令侧如实提示，不虚构计划）。
 */

import { type Plan, STEP_STATUS_COMPLETED } from '../TaskOrchestrator';

/** 未终态计划状态（本地判别：只看"是否已结束"，不引入新状态词汇） */
function isOpenPlan(plan: Plan): boolean {
  // 复用状态常量（避免在本文件新起状态字面量；`aborted` 不在已登记词汇表内）
  return plan.status !== STEP_STATUS_COMPLETED && plan.status !== 'aborted';
}

function heartbeatOf(plan: Plan): number {
  const ms = Date.parse(plan.lastHeartbeatAt ?? plan.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

export interface SelectPlanForPreviewResult {
  plan?: Plan;
  /** 前缀歧义时的候选 id（供命令侧提示） */
  ambiguous?: string[];
}

/**
 * 选出要预演的计划。
 *
 * @param plans 全部计划（调用方先 `taskOrchestrator.initialize()`）
 * @param params.sessionId 会话过滤（未给 ⇒ 不按会话过滤）
 * @param params.planId 指定计划（精确或**唯一前缀**）
 */
export function selectPlanForPreview(
  plans: readonly Plan[],
  params: { sessionId?: string; planId?: string } = {}
): SelectPlanForPreviewResult {
  const scoped = params.sessionId
    ? plans.filter((p) => p.sessionId === params.sessionId)
    : [...plans];

  const key = params.planId?.trim() ?? '';
  if (key) {
    const exact = scoped.find((p) => p.id === key);
    if (exact) return { plan: exact };
    const matches = scoped.filter((p) => p.id.startsWith(key));
    if (matches.length === 1) return { plan: matches[0] };
    if (matches.length > 1) {
      return { ambiguous: matches.map((p) => p.id) };
    }
    return {};
  }

  const ordered = [...scoped].sort((a, b) => heartbeatOf(b) - heartbeatOf(a));
  const open = ordered.filter(isOpenPlan);
  const picked = open[0] ?? ordered[0];
  return picked ? { plan: picked } : {};
}
