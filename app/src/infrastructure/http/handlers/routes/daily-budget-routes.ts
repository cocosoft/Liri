/**
 * daily-budget-routes.ts — 日 Token / USD 预算子派发（自 `cost-channel-routes.ts` 迁出，2026-10-20）
 *
 * R16/D3 既有端点 + **D-b 放行**（/A2 挂起清单）。
 * 精确路径，调用点置于工作空间/渠道通配正则之前，避免被更宽的正则吞掉。
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleEstimateTurnCost,
  handleGetDailyBudget,
  handleGetDailyBudgetSuspends,
  handleResetDailyBudget,
  handleClearDailyBudgetRelief,
  handleSetDailyBudgetKillSwitch,
  handleSetDailyBudgetRelief,
  handleUpdateDailyBudget,
} from '../daily-budget-handlers';

/** 日预算：只读查询 / 更新 / 重置 / 熔断 / 放行 / 撤销放行 */
export async function dispatchDailyBudgetRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, broadcastEvent } = args;

  // G-04（2026-10-19）：**只读**成本折算估算器（同源取价链；前端禁止自算）。
  // 查询串（`?model=…&usd=…`）是正常调用形态 ⇒ 必须按前缀匹配，不能用 `===` 精确等值。
  if (
    method === 'GET' &&
    (url === '/v1/cost/estimate-turn' ||
      url.startsWith('/v1/cost/estimate-turn?'))
  ) {
    await handleEstimateTurnCost(req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/cost/daily-budget') {
    await handleGetDailyBudget(res);
    return true;
  }
  // A2（2026-10-12）：**只读**挂起清单（预算挂起续跑可见性）—— 不受开关门控。
  if (method === 'GET' && url === '/v1/cost/daily-budget/suspend') {
    await handleGetDailyBudgetSuspends(res);
    return true;
  }
  if (method === 'PUT' && url === '/v1/cost/daily-budget') {
    await handleUpdateDailyBudget(req, res, broadcastEvent);
    return true;
  }
  if (method === 'POST' && url === '/v1/cost/daily-budget/reset') {
    await handleResetDailyBudget(res, broadcastEvent);
    return true;
  }
  if (method === 'POST' && url === '/v1/cost/daily-budget/kill-switch') {
    await handleSetDailyBudgetKillSwitch(req, res, broadcastEvent);
    return true;
  }
  // D-b（2026-10-11）：放行（临时提额 / 单次豁免 / 当日解除）—— Spec §5-B
  if (method === 'POST' && url === '/v1/cost/daily-budget/relief') {
    await handleSetDailyBudgetRelief(req, res, broadcastEvent);
    return true;
  }
  // D-b 对称回路（2026-10-12）：**撤销放行**（清全部在途放行、恢复配置上限；
  // 保留今日用量 —— 与 `POST /reset` 的"用量归零"互不相同）
  if (method === 'DELETE' && url === '/v1/cost/daily-budget/relief') {
    await handleClearDailyBudgetRelief(res, broadcastEvent);
    return true;
  }
  return false;
}
