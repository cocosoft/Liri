// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * YieldSettlementBridge — 子代理结算 → yield 等待收敛的桥（阶段 A / A1-d-settle）
 *
 * 形态与 `core/tokenBudget/SubAgentTokenBridge.ts` 一致：**模块级监听器数组**，
 * 避免"子代理侧 → chat 侧"的循环依赖。
 *
 * 语义：子代理 run 结束时通知"该会话有一个子代理已结算"，
 * 由恢复器（`YieldResumer`）据此判定等待中的父会话是否可以继续。
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat:yield:settlementBridge');

export interface YieldSettlementSignal {
  /** 结算归属的父会话（AgentTool 从工具上下文取得） */
  sessionId: string;
  /** 结算时间戳（收敛判定的第二道防线：早于 yieldedAt 的一律忽略） */
  endedAt: number;
  /**
   * O8⑤：是否为**重放投递**（来自投递台账的 `attempting/failed/pending` 行）。
   *
   * 语义：该信号可能**此前已投递过**（对端可能已恢复）⇒ 恢复侧必须带**可见标记**，
   * 避免把"重复恢复"当成首次恢复（G15）。
   */
  restored?: boolean;
}

/**
 * 结算监听器：返回**是否真的完成了投递**（O8③ 的 ack 通道）。
 *
 * 由恢复器实现（`handleYieldSettlement` 的 `true` = 会话确实被恢复）。
 * 忽略返回值即退化为"只广播不回执"（旧行为）。
 */
export type YieldSettlementListener = (
  signal: YieldSettlementSignal
) => boolean | Promise<boolean>;

/** 全局结算监听器列表（与 subAgentTokenListeners 同构） */
export const yieldSettlementListeners: YieldSettlementListener[] = [];

/** 重放投递的 `reason` 取值（与 `YieldResumer` 同源，避免字面量散落） */
export const YIELD_SETTLEMENT_RESTORED_REASON = 'subagents_settled_restored';

/** 子代理结算的**正常**续跑正文（模型可见） */
export const YIELD_RESUME_PROMPT =
  '子代理已全部完成。请基于它们的结果继续完成任务（系统自动续跑，无需用户确认）。';

/**
 * O8⑤（v7.1 补）：按投递来源生成**模型可见**的续跑正文。
 *
 * 为什么必须进正文（而不仅进 metadata / 日志）：`restored` 的语义是"该结算信号来自
 * 崩溃后的**重放**，恢复可能此前已发生过"—— 若模型看不到该标记，会把"重复恢复"当作首次，
 * 从而**重做已完成的工作**（正是 G15 要防的重复副作用）。原实现只把它写进 metadata
 * （`yieldReason`）与日志 ⇒ 对模型不可见，属"标记半接线"。
 */
export function buildYieldResumePrompt(reason?: string): string {
  if (reason !== YIELD_SETTLEMENT_RESTORED_REASON) return YIELD_RESUME_PROMPT;
  return (
    '[重放投递] 以下为崩溃后**重放**的结算信号（此前可能已恢复过一次）。' +
    '请先核对已有结果、避免重复劳动：' +
    YIELD_RESUME_PROMPT
  );
}

/**
 * 通知"某会话的一个子代理 run 已结算"（由子代理侧调用）。
 *
 * 单个监听器异常不阻断其他监听器与子代理主流程。
 *
 * @returns 是否有监听器确认**投递成功**（O8③：调用方据此把台账行落 `delivered`）
 */
export async function notifyYieldSettled(
  signal: YieldSettlementSignal
): Promise<boolean> {
  let delivered = false;
  for (const listener of yieldSettlementListeners) {
    try {
      const ack = await listener(signal);
      if (ack === true) delivered = true;
    } catch (err) {
      // @ignore-catch — 监听器隔离：单个结算监听器失败不得影响子代理主流程
      logger.warn('yield 结算监听器执行失败', {
        sessionId: signal.sessionId,
        error: String(err),
      });
    }
  }
  return delivered;
}
