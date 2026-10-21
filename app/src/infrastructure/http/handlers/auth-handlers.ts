// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
// C1（2026-10-09）：认证令牌属安全凭据 ⇒ 熵源改用 crypto（并提升到 32 位十六进制 ≈128bit）
import { randomIdSuffix } from '../../../utils/common';
import { AuthUserStore } from '../auth/AuthUserStore';
import { PermissionManager, RoleType } from '@modules/permission';
// 多租户 P3：租户是**账号属性**，注册时按开关绑定，登录后随 token 传递
import {
  LOCAL_TENANT_ID,
  parseTenantId,
} from '@modules/core/identity/principal';

// 演进项（真实用户体系基础）：用户持久化到 {data}/auth/users.json（密码哈希），
// tokens 保持内存（重启后需重新登录）
let authUserStore = new AuthUserStore();
/**
 * 会话令牌（内存态，重启失效）。导出供测试注入与诊断。
 *
 * `tenantId` 来自**账号属性**（`users.json`），不是请求自报；缺省 ⇒ `'local'`。
 */
export const authTokens = new Map<
  string,
  { username: string; permissions: string[]; tenantId?: string }
>();

/** 测试注入：替换用户存储（避免写真实 `{data}/auth/users.json`）；生产路径不调用 */
export function __setAuthUserStoreForTest(store: AuthUserStore): void {
  authUserStore = store;
}

/**
 * 是否允许**注册时自报租户**（默认关）。
 *
 * 默认关 = 注册一律落 `'local'`（桌面 / 单租户部署零变更）；服务端多租户部署若要
 * 支持"自助入租户"，由部署方显式开 `LIRI_TENANT_SELF_REGISTER=1`。
 * **登录 / 请求头都不允许切换租户** —— 租户是账号属性，授权面在注册或未来的管理员接口。
 */
export function isTenantSelfRegistrationEnabled(): boolean {
  return process.env['LIRI_TENANT_SELF_REGISTER'] === '1';
}

/**
 * 权限 → 角色映射（**唯一实现**）。登录写进程级角色与请求级身份解析共用，
 * 避免"进程级用一套映射、请求级用另一套"的口径漂移。
 */
export function resolveRoleFromPermissions(
  permissions: readonly string[]
): RoleType {
  return permissions.includes('admin')
    ? RoleType.ADMIN
    : permissions.includes('write')
      ? RoleType.USER
      : RoleType.GUEST;
}

/** E↔A 打通：将认证权限映射为角色并注入工具权限决策（登录时调用） */
function applyAuthRoleToPermissionManager(permissions: string[]): void {
  PermissionManager.getInstance().setCurrentUserRole(
    resolveRoleFromPermissions(permissions)
  );
}

/** 清除认证角色（登出时调用） */
function clearAuthRoleFromPermissionManager(): void {
  PermissionManager.getInstance().setCurrentUserRole(null);
}

// ========== Auth Handlers ==========

/**
 * 管理写 API 鉴权（M0d）
 * - 无 Authorization 头 → 'ok'（本地回环信任基线，维持现状行为）
 * - 携带无效 token → 'unauthorized'（401）
 * - 有效 token 但非 admin 角色 → 'forbidden'（403）
 * - admin 角色 → 'ok'
 */
export type AdminCheckResult = 'ok' | 'unauthorized' | 'forbidden';
export function checkAdminRequest(req: http.IncomingMessage): AdminCheckResult {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return 'ok';
  const token = authHeader.slice(7);
  const session = authTokens.get(token);
  if (!session) return 'unauthorized';
  return session.permissions.includes('admin') ? 'ok' : 'forbidden';
}

/**
 * 用户登录 POST /v1/auth/login
 */
export async function handleAuthLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { username, password } = JSON.parse(body);

    if (!username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'username and password are required' },
        })
      );
      return;
    }

    const storedUser = authUserStore.verify(username, password)
      ? authUserStore.getUser(username)
      : undefined;
    if (!storedUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Invalid username or password' },
        })
      );
      return;
    }

    const isAdmin = storedUser.role === 'admin';
    const permissions = isAdmin
      ? ['admin', 'read', 'write']
      : ['read', 'write'];
    const token = `token_${Date.now()}_${randomIdSuffix(32)}`;
    authTokens.set(token, {
      username,
      permissions,
      // 租户取自**账号属性**（老用户无该字段 ⇒ 空 ⇒ 解析时回落 `'local'`）
      tenantId: storedUser.tenantId,
    });
    // E↔A 打通：登录成功注入认证角色到工具权限决策
    applyAuthRoleToPermissionManager(permissions);

    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        token,
        user: {
          id: `user_${now}`,
          username,
          email: '',
          role: isAdmin ? 'admin' : 'user',
          trustLevel: 2,
          created_at: now,
        },
        expires_at: now + 86400000,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 注册时的租户判定（与 `isTenantSelfRegistrationEnabled` 同源）
 *
 * - 未声明 ⇒ `LOCAL_TENANT_ID`（桌面 / 单租户部署零变更）；
 * - 声明但格式非法（空白 / 含冒号 / 超长 / 非法字符）⇒ 拒绝（**不静默降级**，
 *   否则"以为进了 acme、实际落在 local"这种错归属最难排查）；
 * - 声明合法但自助入租户开关未开 ⇒ 拒绝（明确 400，而不是悄悄落 local）；
 * - 声明 `'local'` 恒允许（等价于未声明）。
 */
export function decideRegistrationTenant(
  declared: unknown
): { ok: true; tenantId: string } | { ok: false; reason: string } {
  if (declared === undefined || declared === null) {
    return { ok: true, tenantId: LOCAL_TENANT_ID };
  }
  if (typeof declared !== 'string') {
    return { ok: false, reason: 'tenantId must be a string' };
  }
  const parsed = parseTenantId(declared);
  if (!parsed) {
    return {
      ok: false,
      reason:
        'Invalid tenantId: 1-64 chars of [A-Za-z0-9._-], starting with alphanumeric, no colon',
    };
  }
  if (parsed === LOCAL_TENANT_ID) return { ok: true, tenantId: parsed };
  if (!isTenantSelfRegistrationEnabled()) {
    return {
      ok: false,
      reason:
        'Tenant self-registration is disabled (set LIRI_TENANT_SELF_REGISTER=1 to enable)',
    };
  }
  return { ok: true, tenantId: parsed };
}

/**
 * 用户注册 POST /v1/auth/register
 */
export async function handleAuthRegister(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const payload = JSON.parse(body) as {
      username?: string;
      password?: string;
      tenantId?: unknown;
    };
    const { username, password } = payload;

    if (!username || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'username and password are required' },
        })
      );
      return;
    }

    const tenantDecision = decideRegistrationTenant(payload.tenantId);
    if (!tenantDecision.ok) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: tenantDecision.reason } }));
      return;
    }
    const tenantId = tenantDecision.tenantId;

    if (authUserStore.hasUser(username)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Username already exists' },
        })
      );
      return;
    }

    authUserStore.addUser(username, password, 'user', tenantId);
    const token = `token_${Date.now()}_${randomIdSuffix(32)}`;
    authTokens.set(token, {
      username,
      permissions: ['read', 'write'],
      tenantId,
    });
    // E↔A 打通：注册成功注入认证角色到工具权限决策
    applyAuthRoleToPermissionManager(['read', 'write']);

    const now = Date.now();
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        token,
        user: {
          id: `user_${now}`,
          username,
          email: '',
          role: 'user',
          trustLevel: 2,
          created_at: now,
        },
        expires_at: now + 86400000,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 用户登出 POST /v1/auth/logout
 */
export async function handleAuthLogout(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');

    if (token) {
      authTokens.delete(token);
    }
    // E↔A 打通：登出清除认证角色，恢复默认工具权限行为
    clearAuthRoleFromPermissionManager();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取当前用户信息 GET /v1/auth/me
 */
export async function handleAuthMe(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');

    const session = authTokens.get(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not authenticated' } }));
      return;
    }

    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: `user_${now}`,
        username: session.username,
        email: '',
        role: 'user',
        trustLevel: 2,
        created_at: now,
        permissions: session.permissions,
        // 多租户 P3：当前会话生效的租户（缺省 / 老 token ⇒ local）
        tenantId: session.tenantId ?? LOCAL_TENANT_ID,
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 获取当前用户权限列表 GET /v1/auth/permissions
 */
export async function handleAuthPermissions(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');

    const session = authTokens.get(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not authenticated' } }));
      return;
    }

    const permissionList = session.permissions.map((p: string) => ({
      scope: p === 'read' ? 'read' : p === 'write' ? 'write' : 'admin',
      description:
        p === 'read' ? '读取权限' : p === 'write' ? '写入权限' : '管理权限',
      level: p as 'none' | 'read' | 'write' | 'admin',
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(permissionList));
  } catch (err) {
    sendError(res, err);
  }
}
