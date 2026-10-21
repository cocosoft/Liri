/**
 * tenant-routes.ts — 租户管理路由子域（多租户 P5 收尾 / P3 账号归属）
 *
 * 目前是两类管理操作：
 *   - `DELETE /v1/tenants/:tenantId` ⇒ 全量清除该租户的可定位数据
 *   - 租户用户管理（管理员建号 / 迁移 / 解绑）：
 *       `POST   /v1/tenants/:tenantId/users`             建号并绑定
 *       `PUT    /v1/tenants/:tenantId/users/:username`   把已有用户迁到该租户
 *       `DELETE /v1/tenants/:tenantId/users/:username`   解绑（回到本地租户）
 *
 * 鉴权在组合根统一拦截（`route-table.ts` 的 admin 写操作清单，`/v1/tenants` 前缀的
 * POST/PUT/DELETE 与 `/v1/skills` 同口径），本文件只做 URL 匹配与派发。
 */

import type http from 'http';
import type { HandlerCtx } from '../handler-utils';
import { sendError } from '../handler-utils';
import { handleDeleteTenant } from '../tenant-handlers';
import {
  handleBindTenantUser,
  handleCreateTenantUser,
  handleUnbindTenantUser,
} from '../auth-handlers';

/** `/v1/tenants/:tenantId/users` */
const TENANT_USER_LIST = /^\/v1\/tenants\/([^/]+)\/users$/;
/** `/v1/tenants/:tenantId/users/:username` */
const TENANT_SINGLE_USER = /^\/v1\/tenants\/([^/]+)\/users\/([^/]+)$/;

export async function dispatchTenantRoutes(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  _broadcastEvent: (event: string, data: unknown) => void,
  _handlerCtx: HandlerCtx
): Promise<boolean> {
  const method = req.method || 'GET';
  const [path] = url.split('?');

  // 子路径先匹配（否则 `/v1/tenants/x` 的正则会漏掉 `.../users`）
  const listMatch = TENANT_USER_LIST.exec(path);
  if (listMatch) {
    if (method !== 'POST') return false;
    try {
      await handleCreateTenantUser(req, res, listMatch[1]);
    } catch (err) {
      sendError(res, err);
    }
    return true;
  }

  const userMatch = TENANT_SINGLE_USER.exec(path);
  if (userMatch) {
    const [, tenantId, username] = userMatch;
    try {
      if (method === 'PUT') {
        await handleBindTenantUser(req, res, tenantId, username);
      } else if (method === 'DELETE') {
        await handleUnbindTenantUser(req, res, tenantId, username);
      } else {
        return false;
      }
    } catch (err) {
      sendError(res, err);
    }
    return true;
  }

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
