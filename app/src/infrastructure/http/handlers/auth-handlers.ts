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
import { sendError, readRequestBody, json } from './handler-utils';
// C1（2026-10-09）：认证令牌属安全凭据 ⇒ 熵源改用 crypto（并提升到 32 位十六进制 ≈128bit）
import { randomIdSuffix } from '../../../utils/common';
import { AuthUserStore } from '../auth/AuthUserStore';
import { PermissionManager, RoleType } from '@modules/permission';
// 多租户 P3：租户是**账号属性**，注册时按开关绑定，登录后随 token 传递
import {
  LOCAL_TENANT_ID,
  parseTenantId,
} from '@modules/core/identity/principal';
import { getRequestPrincipal } from '@modules/core/identity/requestScope.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('http:auth');

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
 * 全部**已绑定租户**的身份（只读）。
 *
 * 用途：启动期按身份扫描待恢复检查点 —— 启动时没有请求作用域，而存储按
 * `tenants/<t>/users/<u>/` 分区，只能由调用方逐个身份重建作用域。
 */
export function listTenantUserIdentities(): Array<{
  tenantId: string;
  userId: string;
}> {
  return authUserStore.listTenantUsers();
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

// ========== 租户用户管理（admin 写操作，多租户 P3 收尾） ==========

/** URL 片段解码（非法百分号编码 ⇒ 原样返回，交给后续校验拒绝） */
function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 可**绑定**的租户标识校验：格式非法 / `local` ⇒ 拒绝。
 *
 * `local` 不是"可绑定租户"——它就是本地身份，解绑走 `DELETE`（`setUserTenant` 不传
 * tenantId），避免"把用户迁到 local 租户"与"解绑"变成两条不同语义的等价路径。
 */
function validateBindingTenantId(
  raw: string
): { ok: true; tenantId: string } | { ok: false; message: string } {
  const parsed = parseTenantId(decodeSegment(raw));
  if (!parsed) {
    return {
      ok: false,
      message:
        '无效的租户标识：1-64 字符，仅 [A-Za-z0-9._-]，首字符为字母或数字，不含冒号',
    };
  }
  if (parsed === LOCAL_TENANT_ID) {
    return {
      ok: false,
      message: 'local 不是可绑定租户；解绑请用 DELETE',
    };
  }
  return { ok: true, tenantId: parsed };
}

/**
 * 撤销某用户的**全部活动 token**（`@returns` 撤销数）
 *
 * 为什么必须撤销：token 里带着登录时刻的租户。迁移/解绑后若不失效，该用户会继续
 * 以**旧租户**身份读写（数据落到旧分区）——这是"改了归属但没生效"的经典坑。
 * 代价：该用户需重新登录（管理员自身若改自己也会被登出，属预期）。
 */
function revokeUserTokens(username: string): number {
  let revoked = 0;
  for (const [token, session] of [...authTokens]) {
    if (session.username !== username) continue;
    authTokens.delete(token);
    revoked += 1;
  }
  return revoked;
}

/** 账号/归属变更审计（失败只告警，不推翻已完成的操作） */
async function recordTenantUserAudit(input: {
  action: string;
  tenantId: string;
  username: string;
  success: boolean;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { EnterpriseAuditService, AuditEventType } =
      await import('../../../config/enterprise/audit/EnterpriseAuditService.js');
    await EnterpriseAuditService.getInstance().record({
      type: AuditEventType.USER_MANAGEMENT,
      severity: 'warning',
      actor: getRequestPrincipal().userId,
      action: input.action,
      resource: `${input.tenantId}/${input.username}`,
      details: input.details ?? {},
      success: input.success,
    });
  } catch (error) {
    logger.warning('租户用户管理审计落盘失败', {
      action: input.action,
      tenantId: input.tenantId,
      error: String(error),
    });
  }
}

/**
 * 删除租户后清理**悬空账号绑定**（供 `tenant-handlers` 的删除入口调用）
 *
 * 为什么需要：`DELETE /v1/tenants/:tenantId` 只清数据分区，账号仍钉在该租户上 ⇒
 * 这些用户下次登录会拿到一个"租户已被删除却仍然生效"的身份，并**重新创建**空分区。
 * 这里只**改归属**（回到本地租户）并撤销其活动 token，**不删账号、不改密码**。
 *
 * @returns `unboundUsers` 被解绑的用户名；`revokedTokens` 失效的会话数
 */
export function unbindTenantAccounts(tenantId: string): {
  unboundUsers: string[];
  revokedTokens: number;
} {
  const unboundUsers = authUserStore.unbindAllFromTenant(tenantId);
  let revokedTokens = 0;
  for (const username of unboundUsers) {
    revokedTokens += revokeUserTokens(username);
  }
  if (unboundUsers.length > 0) {
    logger.info('删除租户后解绑其账号', {
      tenantId,
      unboundUsers,
      revokedTokens,
    });
  }
  return { unboundUsers, revokedTokens };
}

/**
 * 建号并绑定租户 `POST /v1/tenants/:tenantId/users`
 *
 * body: `{ username, password, role?: 'user' | 'admin' }`
 * - 租户非法 / `local` ⇒ **400**；缺 username/password 或 role 非法 ⇒ **400**；
 * - 用户名已存在 ⇒ **409**（不偷偷改密码，避免"建号"变成"重置口令"）；
 * - 成功 ⇒ **201**。
 *
 * 鉴权：`/v1/tenants` 前缀的 POST 由 `route-table.ts` 统一按 admin 写操作拦截。
 */
export async function handleCreateTenantUser(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rawTenantId: string
): Promise<void> {
  const tenant = validateBindingTenantId(rawTenantId);
  if (!tenant.ok) {
    json(res, 400, { error: { message: tenant.message } });
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(req)) as {
      username?: unknown;
      password?: unknown;
      role?: unknown;
    };
    const username =
      typeof payload.username === 'string' ? payload.username.trim() : '';
    const password =
      typeof payload.password === 'string' ? payload.password : '';
    if (!username || !password) {
      json(res, 400, {
        error: { message: 'username and password are required' },
      });
      return;
    }
    const role = payload.role ?? 'user';
    if (role !== 'user' && role !== 'admin') {
      json(res, 400, { error: { message: "role must be 'user' or 'admin'" } });
      return;
    }

    if (authUserStore.hasUser(username)) {
      json(res, 409, {
        error: { message: 'Username already exists' },
      });
      return;
    }

    authUserStore.addUser(username, password, role, tenant.tenantId);
    await recordTenantUserAudit({
      action: 'tenant.user.create',
      tenantId: tenant.tenantId,
      username,
      success: true,
      details: { role },
    });
    json(res, 201, { username, tenantId: tenant.tenantId, role });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 把**已有用户**迁到该租户 `PUT /v1/tenants/:tenantId/users/:username`
 *
 * - 租户非法 / `local` ⇒ **400**；用户不存在 ⇒ **404**；
 * - 已在该租户 ⇒ **200** 且 `unchanged: true`（幂等，不撤销 token）；
 * - 成功 ⇒ **200** + `revokedTokens`（该用户的活动 token 已全部失效，需重新登录）。
 */
export async function handleBindTenantUser(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  rawTenantId: string,
  rawUsername: string
): Promise<void> {
  const tenant = validateBindingTenantId(rawTenantId);
  if (!tenant.ok) {
    json(res, 400, { error: { message: tenant.message } });
    return;
  }
  const username = decodeSegment(rawUsername);

  try {
    const user = authUserStore.getUser(username);
    if (!user) {
      json(res, 404, { error: { message: `用户不存在: ${username}` } });
      return;
    }
    if (user.tenantId === tenant.tenantId) {
      json(res, 200, {
        username,
        tenantId: tenant.tenantId,
        revokedTokens: 0,
        unchanged: true,
      });
      return;
    }

    authUserStore.setUserTenant(username, tenant.tenantId);
    const revokedTokens = revokeUserTokens(username);
    await recordTenantUserAudit({
      action: 'tenant.user.bind',
      tenantId: tenant.tenantId,
      username,
      success: true,
      details: { previousTenantId: user.tenantId ?? null, revokedTokens },
    });
    json(res, 200, { username, tenantId: tenant.tenantId, revokedTokens });
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 解绑用户（回到本地租户）`DELETE /v1/tenants/:tenantId/users/:username`
 *
 * - 用户不存在 **或不属于该租户** ⇒ **404**（fail-closed：避免误清别的租户的绑定）；
 * - 成功 ⇒ **200** + `revokedTokens`。
 */
export async function handleUnbindTenantUser(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  rawTenantId: string,
  rawUsername: string
): Promise<void> {
  const tenant = validateBindingTenantId(rawTenantId);
  if (!tenant.ok) {
    json(res, 400, { error: { message: tenant.message } });
    return;
  }
  const username = decodeSegment(rawUsername);

  try {
    const user = authUserStore.getUser(username);
    if (!user || user.tenantId !== tenant.tenantId) {
      json(res, 404, {
        error: { message: `用户 ${username} 不属于租户 ${tenant.tenantId}` },
      });
      return;
    }

    authUserStore.setUserTenant(username);
    const revokedTokens = revokeUserTokens(username);
    await recordTenantUserAudit({
      action: 'tenant.user.unbind',
      tenantId: tenant.tenantId,
      username,
      success: true,
      details: { revokedTokens },
    });
    json(res, 200, { username, tenantId: LOCAL_TENANT_ID, revokedTokens });
  } catch (err) {
    sendError(res, err);
  }
}
