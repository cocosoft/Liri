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

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'infrastructure:http:handlers:auth-handlers',
  level: LogLevel.INFO,
});

const users = new Map<string, { username: string; password: string }>();
const tokens = new Map<string, { username: string; permissions: string[] }>();

// ========== Auth Handlers ==========

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

    const user = users.get(username);
    if (!user || user.password !== password) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Invalid username or password' },
        })
      );
      return;
    }

    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    tokens.set(token, {
      username,
      permissions: ['read', 'write'],
    });

    const now = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json' });
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

    if (users.has(username)) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Username already exists' },
        })
      );
      return;
    }

    users.set(username, { username, password });
    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    tokens.set(token, {
      username,
      permissions: ['read', 'write'],
    });

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
      tokens.delete(token);
    }

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

    const session = tokens.get(token);
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

    const session = tokens.get(token);
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
