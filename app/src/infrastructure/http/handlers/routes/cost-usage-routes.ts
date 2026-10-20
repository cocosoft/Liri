/**
 * cost-usage-routes.ts — 成本 / 用量子派发（自 `cost-channel-routes.ts` 拆出，2026-10-20）
 *
 * 拆分动因：组合根 `dispatchCostChannelRoutes` 圈复杂度达 **99**（`lint:complexity` 预警线
 * 之上、阈值 100 之下），再并入任何分支都会触顶 ⇒ 按领域拆成子派发，组合根退化为顺序表。
 *
 * 覆盖范围（**保持拆分前的匹配顺序**）：
 *   ① 工作空间成本（report / budget）
 *   ② 统一用量成本 `/v1/usage/cost/*`
 *   ③ 遗留路径 `/api/cost/*` → 301
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import { getLogger } from '@modules/monitoring';
import {
  handleCostReconcile,
  handleCostReport,
  handleGlobalCostRange,
  handleGlobalCostRecords,
  handleGlobalCostSummary,
  handleWorkspaceBudgetStatus,
  handleWorkspaceCostReport,
} from '../cost-handlers';

const logger = getLogger('http:cost-usage-routes');

/** ① + ②：工作空间成本与统一用量成本 */
export async function dispatchCostUsageRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url, handlerCtx } = args;

  const workspaceCost = matchWorkspaceCost(url);
  if (method === 'GET' && workspaceCost) {
    if (workspaceCost.kind === 'report') {
      await handleWorkspaceCostReport(handlerCtx, req, res, workspaceCost.id);
    } else {
      await handleWorkspaceBudgetStatus(handlerCtx, req, res, workspaceCost.id);
    }
    return true;
  }

  if (method === 'GET' && url === '/v1/usage/cost/summary') {
    await handleGlobalCostSummary(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/records') {
    await handleGlobalCostRecords(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/range') {
    await handleGlobalCostRange(handlerCtx, req, res);
    return true;
  }
  if (method === 'GET' && url === '/v1/usage/cost/report') {
    await handleCostReport(handlerCtx, req, res);
    return true;
  }
  // [v1.2] 对账 API
  if (method === 'GET' && url === '/v1/usage/cost/reconcile') {
    await handleCostReconcile(handlerCtx, req, res);
    return true;
  }
  return false;
}

/**
 * ③ 遗留路径 → 301（保持既有告警日志与 Location 目标逐字不变）
 *
 * 只在 `GET` 下生效；未命中返回 false（不吞后续路由）。
 */
export async function dispatchLegacyCostRedirects(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { res, method, url } = args;
  if (method !== 'GET') return false;

  const target = LEGACY_COST_REDIRECTS[url];
  if (!target) return false;

  logger.warning(`已废弃路径访问 ${url} → 301 ${target}`);
  res.writeHead(301, { Location: target });
  res.end();
  return true;
}

/** 遗留路径表（值 = 301 目标） */
const LEGACY_COST_REDIRECTS: Readonly<Record<string, string>> = {
  '/api/cost/summary': '/v1/usage/cost/summary',
  '/api/cost/records': '/v1/usage/cost/records',
  '/api/cost/range': '/v1/usage/cost/range',
  '/api/cost/report': '/v1/usage/cost/report',
};

/** 工作空间成本路径识别（report / budget 两条正则各有捕获组） */
function matchWorkspaceCost(
  url: string
): { kind: 'report' | 'budget'; id: string } | null {
  const report = url.match(/^\/v1\/workspaces\/(.+)\/cost\/report$/);
  if (report) return { kind: 'report', id: report[1] };
  const budget = url.match(/^\/v1\/workspaces\/(.+)\/cost\/budget$/);
  if (budget) return { kind: 'budget', id: budget[1] };
  return null;
}
