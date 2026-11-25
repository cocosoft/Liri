/**
 * 梦境经验公式（唯一事实源）
 *
 * 背景（2026-11-25 四模块联调排查）：梦境经验曾有两套公式 ——
 * SSE `dream:cycle:completed` 用 `sessions×10 + memories×5 + insights×3`，
 * 伙伴 `DreamGrowthTracker` 用 `sessions×10 + insights×5`。同一个梦在 UI 与伙伴成长里
 * 显示不同经验值。现收敛到本模块：**伙伴侧（真实落盘、派生等级）为准**，
 * SSE 只做同一数字的透出。
 */

/** 每条整理会话的经验 */
export const DREAM_XP_PER_SESSION = 10;

/** 每条洞察的经验 */
export const DREAM_XP_PER_INSIGHT = 5;

export interface DreamXpInput {
  /** 本轮整理的会话数 */
  sessions: number;
  /** 本轮产出的洞察数 */
  insights: number;
}

/**
 * 计算一次梦境的经验值。
 *
 * 非有限值 / 负数 / 小数统一收敛（负数按 0、小数向下取整），避免 NaN 传播到
 * 伙伴成长与 UI。
 */
export function computeDreamXp(input: DreamXpInput): number {
  const sessions = Number.isFinite(input.sessions)
    ? Math.max(0, Math.floor(input.sessions))
    : 0;
  const insights = Number.isFinite(input.insights)
    ? Math.max(0, Math.floor(input.insights))
    : 0;
  return sessions * DREAM_XP_PER_SESSION + insights * DREAM_XP_PER_INSIGHT;
}
