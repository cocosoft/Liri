/**
 * Ticket 用量累计（P34 收尾，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P34/P35。
 *
 * 为什么单独成模块：同一个 Ticket 可能被**多次执行**（重试 / 唤醒 / 新 Assignment），
 * `budgetUsedTokens` / `costTokens` 必须**累加**而不是被最后一轮覆盖 —— 两个写入点
 * （cron `onJobEnd`、`ticketRunConsumer`）共用本函数，避免各写一套口径（CS01）。
 *
 * 诚实边界：只累计 **tokens**；USD 用量需要按模型定价折算，当前没有逐轮 USD 事实
 * （`budgetUsedUsd` 仍由外部写入）⇒ 此处不臆造。
 */

/** 累计后的字段（无新增用量 ⇒ 空对象，调用方据此决定是否写） */
export interface TicketUsagePatch {
  budgetUsedTokens: number;
  costTokens: number;
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * 把本轮 tokens 计入 Ticket 的累计用量。
 *
 * @param existing Ticket 当前记录（`data` 视图）
 * @param tokens 本轮 tokens（≤0 / 非有限 ⇒ 返回 `undefined`，不写字段）
 */
export function accumulateTicketUsage(
  existing: Record<string, unknown>,
  tokens: number
): TicketUsagePatch | undefined {
  if (!Number.isFinite(tokens) || tokens <= 0) return undefined;
  const used = finiteOrZero(existing.budgetUsedTokens);
  const cost = finiteOrZero(existing.costTokens);
  return {
    budgetUsedTokens: used + tokens,
    costTokens: cost + tokens,
  };
}
