/**
 * tenant-routes.ts — 租户管理路由子域（多租户 P5 收尾）
 *
 * 目前只有一项破坏性管理操作：
 *   - `DELETE /v1/tenants/:tenantId` ⇒ 全量清除该租户的可定位数据
 *
 * 鉴权在组合根统一拦截（`route-table.ts` 的 admin 写操作清单，与 `/v1/skills` 同口径），
 * 本文件只做 URL 匹配与派发。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { sendError } from '../handler-utils';
import { handleDeleteTenant } from '../tenant-handlers';

export async function dispatchTenantRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  const [path] = url.split('?');

  const match = /^\/v1\/tenants\/([^/]+)$/.exec(path);
  if (!match) return false;

  if (method !== 'DELETE') return false;

  try {
    await handleDeleteTenant(req, res, match[1]);
  } catch (err) {
    sendError(res, err);
  }
  return true;
}
