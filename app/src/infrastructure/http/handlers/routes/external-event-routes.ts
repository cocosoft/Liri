/**
 * external-event-routes —— 外部事件入站路由（D1，2026-11-14）
 *
 * `POST /v1/events/external`（精确匹配；不做前缀通配，避免与 SSE `/v1/events` 混淆）
 */
import type { RouteDispatchArgs } from './route-dispatch-types';
import {
  EXTERNAL_EVENT_PATH,
  handleExternalEventInbound,
} from '../external-event-handlers';

export async function dispatchExternalEventRoutes(
  args: RouteDispatchArgs
): Promise<boolean> {
  const { req, res, method, url } = args;
  if (method === 'POST' && url === EXTERNAL_EVENT_PATH) {
    await handleExternalEventInbound(req, res);
    return true;
  }
  return false;
}
