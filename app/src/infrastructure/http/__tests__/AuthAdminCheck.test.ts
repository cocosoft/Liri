/**
 * M0 管理 API 鉴权单测（§4.2d / §六b 验收①）
 *
 * 覆盖 checkAdminRequest 四路径：
 * 无 token（基线放行）/ 无效 token（401）/ 非 admin 登录（403）/ admin（放行）
 */

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import { checkAdminRequest, authTokens } from '../handlers/auth-handlers';

function makeReq(authHeader?: string): http.IncomingMessage {
  const req = new http.IncomingMessage(new net.Socket());
  req.headers = {};
  if (authHeader) req.headers['authorization'] = authHeader;
  return req;
}

beforeAll(() => {
  authTokens.set('admin-token', {
    username: 'admin',
    permissions: ['admin', 'read', 'write'],
  });
  authTokens.set('user-token', {
    username: 'alice',
    permissions: ['read', 'write'],
  });
});

afterAll(() => {
  authTokens.clear();
});

describe('checkAdminRequest（管理写 API 鉴权）', () => {
  it('无 Authorization 头 → 基线放行（本地回环信任）', () => {
    expect(checkAdminRequest(makeReq())).toBe('ok');
  });

  it('空 Bearer token → unauthorized（401）', () => {
    expect(checkAdminRequest(makeReq('Bearer '))).toBe('unauthorized');
  });

  it('无效 token → unauthorized（401）', () => {
    expect(checkAdminRequest(makeReq('Bearer bogus-token'))).toBe(
      'unauthorized'
    );
  });

  it('有效 token 但非 admin → forbidden（403）', () => {
    expect(checkAdminRequest(makeReq('Bearer user-token'))).toBe('forbidden');
  });

  it('admin token → 放行', () => {
    expect(checkAdminRequest(makeReq('Bearer admin-token'))).toBe('ok');
  });

  it('非 Bearer 前缀视为无 token（基线放行）', () => {
    expect(checkAdminRequest(makeReq('Token abc'))).toBe('ok');
  });
});
