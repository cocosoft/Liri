/**
 * 多租户 P3：请求身份解析带上**账号绑定的租户**
 *
 * 背景：`resolveRequestPrincipal` 此前把 `tenantId` 恒置 `'local'`（注释明写"阶段 2 不臆造租户"），
 * 于是前十几批的身份隔离在 HTTP 面上只跑到"用户级"。现口径：
 * - `tenantId` 是**账号属性**（`users.json` 的 `tenantId`），注册时绑定、登录时写进 token；
 * - 老用户 / 老 token 无该字段 ⇒ 回落 `'local'`（桌面端逐字不变）；
 * - 空白 / 非法 ⇒ 同样回落，**不编造租户**。
 *
 * 本文件只锁"token → principal"这一段，不碰文件 IO（`authTokens` 是导出的可变 Map）。
 */
import { describe, it, expect, afterEach } from 'bun:test';
import type http from 'http';

import { resolveRequestPrincipal } from '../../src/infrastructure/http/requestIdentity.js';
import { authTokens } from '../../src/infrastructure/http/handlers/auth-handlers.js';

const TOKENS = ['tok-tenant-acme', 'tok-tenant-legacy', 'tok-tenant-blank'];

function req(authorization?: string): http.IncomingMessage {
  return {
    headers: authorization ? { authorization } : {},
  } as unknown as http.IncomingMessage;
}

afterEach(() => {
  for (const token of TOKENS) authTokens.delete(token);
});

describe('resolveRequestPrincipal：租户取自账号绑定', () => {
  it('token 带 tenantId ⇒ principal 用它（不再是 local）', async () => {
    authTokens.set('tok-tenant-acme', {
      username: 'alice',
      permissions: ['read', 'write'],
      tenantId: 'acme',
    });

    const principal = await resolveRequestPrincipal(
      req('Bearer tok-tenant-acme')
    );

    expect(principal.tenantId).toBe('acme');
    expect(principal.userId).toBe('alice');
  });

  it('老 token 无 tenantId ⇒ 回落 local（向后兼容）', async () => {
    authTokens.set('tok-tenant-legacy', {
      username: 'bob',
      permissions: [],
    });

    const principal = await resolveRequestPrincipal(
      req('Bearer tok-tenant-legacy')
    );

    expect(principal.tenantId).toBe('local');
    expect(principal.userId).toBe('bob');
  });

  it('空白 tenantId ⇒ 回落 local（不编造租户）', async () => {
    authTokens.set('tok-tenant-blank', {
      username: 'carol',
      permissions: [],
      tenantId: '   ',
    });

    expect(
      (await resolveRequestPrincipal(req('Bearer tok-tenant-blank'))).tenantId
    ).toBe('local');
  });

  it('无 Bearer / 未知 token ⇒ 本地身份（回环信任基线不变）', async () => {
    const noHeader = await resolveRequestPrincipal(req());
    expect(noHeader.tenantId).toBe('local');
    expect(noHeader.userId).toBe('local');

    const unknown = await resolveRequestPrincipal(req('Bearer tok-not-exist'));
    expect(unknown.tenantId).toBe('local');
  });
});
