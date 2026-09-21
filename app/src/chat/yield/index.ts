// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * yield 恢复通路子模块（阶段 A：A1-d-settle + A1-e）
 *
 * - `YieldSettlementBridge` 子代理结算 → 收敛判定的桥（模块级监听器数组）
 * - `YieldResumer`           恢复器：判定通过后经注入的 handler 开启父会话新 turn
 */

export {
  yieldSettlementListeners,
  notifyYieldSettled,
} from './YieldSettlementBridge';
export type {
  YieldSettlementSignal,
  YieldSettlementListener,
} from './YieldSettlementBridge';

export {
  setYieldResumeHandler,
  hasYieldResumeHandler,
  handleYieldSettlement,
  installYieldResumer,
} from './YieldResumer';
export type { YieldResumeHandler, YieldResumerDeps } from './YieldResumer';
