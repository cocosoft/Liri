/**
 * Tips历史记录
 * 记录已显示的提示，避免重复显示
 *
 * 基于CC源码 cc_code/backend/services/tips/tipHistory.ts 实现
 */

interface TipsConfig {
  tipsHistory?: Record<string, number>;
  numStartups?: number;
}

let tipsConfig: TipsConfig = {};

/**
 * 初始化Tips配置
 */
export function initTipsHistory(config: TipsConfig): void {
  tipsConfig = config;
}

/**
 * 记录提示已显示
 */
export function recordTipShown(tipId: string): void {
  const numStartups = tipsConfig.numStartups ?? 0;
  const history = tipsConfig.tipsHistory ?? {};
  if (history[tipId] === numStartups) return;
  tipsConfig.tipsHistory = { ...history, [tipId]: numStartups };
}

/**
 * 获取自上次显示以来的会话数
 */
export function getSessionsSinceLastShown(tipId: string): number {
  const lastShown = tipsConfig.tipsHistory?.[tipId];
  if (!lastShown) return Infinity;
  return (tipsConfig.numStartups ?? 0) - lastShown;
}
