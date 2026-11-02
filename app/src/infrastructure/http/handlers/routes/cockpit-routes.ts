/**
 * cockpit-routes.ts — 驾驶舱只读聚合（P39-b-2，2026-11-02）
 *
 * GET  /v1/cockpit
 * GET  /v1/cockpit/:id/history
 * POST /v1/cockpit/:id/takeover
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  handleGetCockpit,
  handleGetCockpitHistory,
  handleTakeoverCockpitItem,
} from '../cockpit-handlers';

export async function dispatchCockpitRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { res, method, url } = args;

  if (method === 'GET' && url === '/v1/cockpit') {
    await handleGetCockpit(res);
    return true;
  }

  const history = url.match(/^\/v1\/cockpit\/([^/]+)\/history$/);
  if (method === 'GET' && history) {
    await handleGetCockpitHistory(res, decodeURIComponent(history[1]));
    return true;
  }

  const takeover = url.match(/^\/v1\/cockpit\/([^/]+)\/takeover$/);
  if (method === 'POST' && takeover) {
    await handleTakeoverCockpitItem(res, decodeURIComponent(takeover[1]));
    return true;
  }

  return false;
}
