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
import { AuthUserStore } from '../auth/AuthUserStore';
import { PermissionManager } from '@modules/permission/PermissionManager';
import { RoleType } from '@modules/permission/Permission';

// 演进项（真实用户体系基础）：用户持久化到 {data}/auth/users.json（密码哈希），
// tokens 保持内存（重启后需重新登录）
const authUserStore = new AuthUserStore();
/** 会话令牌（内存态，重启失效）。导出供测试注入与诊断。 */
export const authTokens = new Map<
  string,
  { username: string; permissions: string[] }
>();

/** E↔A 打通：将认证权限映射为角色并注入工具权限决策（登录时调用） */
function applyAuthRoleToPermissionManager(permissions: string[]): void {
  const role = permissions.includes('admin')
    ? RoleType.ADMIN
    : permissions.includes('write')
      ? RoleType.USER
      : RoleType.GUEST;
  PermissionManager.getInstance().setCurrentUserRole(role);
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
    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    authTokens.set(token, {
      username,
      permissions,
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
 * 用户注册 POST /v1/auth/register
 */
export async function handleAuthRegister(
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

    if (authUserStore.hasUser(username)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Username already exists' },
        })
      );
      return;
    }

    authUserStore.addUser(username, password);
    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    authTokens.set(token, {
      username,
      permissions: ['read', 'write'],
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
