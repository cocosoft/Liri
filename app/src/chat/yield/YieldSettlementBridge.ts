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
}

export type YieldSettlementListener = (signal: YieldSettlementSignal) => void;

/** 全局结算监听器列表（与 subAgentTokenListeners 同构） */
export const yieldSettlementListeners: YieldSettlementListener[] = [];

/**
 * 通知"某会话的一个子代理 run 已结算"（由子代理侧调用）。
 *
 * 单个监听器异常不阻断其他监听器与子代理主流程。
 */
export function notifyYieldSettled(signal: YieldSettlementSignal): void {
  for (const listener of yieldSettlementListeners) {
    try {
      listener(signal);
    } catch (err) {
      // @ignore-catch — 监听器隔离：单个结算监听器失败不得影响子代理主流程
      logger.warn('yield 结算监听器执行失败', {
        sessionId: signal.sessionId,
        error: String(err),
      });
    }
  }
}
