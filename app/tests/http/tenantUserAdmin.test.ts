/**
 * 多租户 P3：租户用户管理（管理员建号 / 迁移 / 解绑）
 *
 * 覆盖：
 *  ① `POST /v1/tenants/:t/users`：建号并绑定（201）；重名 ⇒ 409；`local` / 含冒号 ⇒ 400；
 *     缺 password / role 非法 ⇒ 400；
 *  ② `PUT /v1/tenants/:t/users/:u`：用户不存在 ⇒ 404；成功 ⇒ 归属改写 + **旧 token 全部撤销**
 *     （否则用户会继续以旧租户读写）；已在该租户 ⇒ 幂等（`unchanged`，不撤销 token）；
 *  ③ `DELETE /v1/tenants/:t/users/:u`：不属于该租户 ⇒ 404 且不改动；成功 ⇒ 解绑 + 撤销 token；
 *  ④ 路由派发：子路径命中 POST/PUT/DELETE（含百分号编码），GET 不命中；
 *  ⑤ 联动：迁移后重新登录 ⇒ `resolveRequestPrincipal` 解析出的租户是新租户。
 *
 * 说明：`AuthUserStore` 与数据根都注入临时目录，不写真实 `~/.pyapp`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { setUserDataDirOverride } from '@openliri/kernel/paths.js';
import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore.js';
import {
  __setAuthUserStoreForTest,
  authTokens,
  handleAuthLogin,
} from '../../src/infrastructure/http/handlers/auth-handlers.js';
import { dispatchTenantRoutes } from '../../src/infrastructure/http/handlers/routes/tenant-routes.js';
import { resolveRequestPrincipal } from '../../src/infrastructure/http/requestIdentity.js';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils.js';

let root: string;
let store: AuthUserStore;
const tokensToClean: string[] = [];

function makeReq(
  method: string,
  payload: unknown = {},
  token?: string
): http.IncomingMessage {
  const buf = Buffer.from(JSON.stringify(payload));
  const headers: Record<string, string> = {
    'content-length': String(buf.length),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return Object.assign(Readable.from([buf]), {
    method,
    headers,
  }) as unknown as http.IncomingMessage;
}

function createRes(): {
  res: http.ServerResponse;
  read: () => { status: number; body: Record<string, unknown> };
} {
  const out = { status: 0, body: '' };
  const res = {
    writeHead: (code: number) => {
      out.status = code;
      return res;
    },
    end: (chunk?: string) => {
      out.body = chunk ?? '';
    },
  } as unknown as http.ServerResponse;
  return {
    res,
    read: () => ({ status: out.status, body: JSON.parse(out.body || '{}') }),
  };
}

async function call(
  method: string,
  url: string,
  payload: unknown = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, read } = createRes();
  const handled = await dispatchTenantRoutes(
    makeReq(method, payload),
    res,
    url,
    () => {},
    {} as HandlerCtx
  );
  if (!handled) return { status: 0, body: { handled: false } };
  return read();
}

/** 直接拿一个"已登录"的 token（走真实登录处理器，避免手搓 session） */
async function loginToken(username: string, password: string): Promise<string> {
  const { res, read } = createRes();
  await handleAuthLogin(makeReq('POST', { username, password }), res);
  const token = String(read().body.token);
  tokensToClean.push(token);
  return token;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-tenant-users-'));
  setUserDataDirOverride(root);
  store = new AuthUserStore(join(root, 'users.json'));
  __setAuthUserStoreForTest(store);
  delete process.env['LIRI_TENANT_SELF_REGISTER'];
});

afterEach(() => {
  for (const token of tokensToClean.splice(0)) authTokens.delete(token);
  setUserDataDirOverride(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('POST /v1/tenants/:tenantId/users（建号并绑定）', () => {
  it('成功 ⇒ 201 且账号记录带该租户', async () => {
    const result = await call('POST', '/v1/tenants/acme/users', {
      username: 'alice',
      password: 'pw',
      role: 'admin',
    });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({
      username: 'alice',
      tenantId: 'acme',
      role: 'admin',
    });
    expect(store.getUser('alice')?.tenantId).toBe('acme');
    expect(store.getUser('alice')?.role).toBe('admin');
  });

  it('重名 ⇒ 409（不偷偷改密码）', async () => {
    store.addUser('bob', 'original');

    const result = await call('POST', '/v1/tenants/acme/users', {
      username: 'bob',
      password: 'new-pw',
    });

    expect(result.status).toBe(409);
    // 原密码仍有效 ⇒ 说明没被覆盖
    expect(store.verify('bob', 'original')).toBe(true);
  });

  it('租户非法（local / 含冒号）⇒ 400 且不建号', async () => {
    for (const tenantId of ['local', 'acme:corp', '-bad']) {
      const result = await call('POST', `/v1/tenants/${tenantId}/users`, {
        username: 'carol',
        password: 'pw',
      });
      expect(result.status).toBe(400);
    }
    expect(store.hasUser('carol')).toBe(false);
  });

  it('缺 password / role 非法 ⇒ 400', async () => {
    expect(
      (await call('POST', '/v1/tenants/acme/users', { username: 'dave' }))
        .status
    ).toBe(400);
    expect(
      (
        await call('POST', '/v1/tenants/acme/users', {
          username: 'dave',
          password: 'pw',
          role: 'root',
        })
      ).status
    ).toBe(400);
    expect(store.hasUser('dave')).toBe(false);
  });
});

describe('PUT /v1/tenants/:tenantId/users/:username（迁移已有用户）', () => {
  it('成功 ⇒ 归属改写 + 该用户旧 token 全部撤销', async () => {
    store.addUser('erin', 'pw');
    const oldToken = await loginToken('erin', 'pw');
    expect(authTokens.has(oldToken)).toBe(true);

    const result = await call('PUT', '/v1/tenants/acme/users/erin');

    expect(result.status).toBe(200);
    expect(result.body.tenantId).toBe('acme');
    expect(result.body.revokedTokens).toBe(1);
    expect(store.getUser('erin')?.tenantId).toBe('acme');
    // 关键：旧 token 失效 ⇒ 不会继续以旧租户读写
    expect(authTokens.has(oldToken)).toBe(false);
  });

  it('迁移后重新登录 ⇒ 身份解析出的是新租户', async () => {
    store.addUser('frank', 'pw');
    await call('PUT', '/v1/tenants/acme/users/frank');

    const token = await loginToken('frank', 'pw');
    const principal = await resolveRequestPrincipal(makeReq('GET', {}, token));

    expect(principal.tenantId).toBe('acme');
    expect(principal.userId).toBe('frank');
  });

  it('已在该租户 ⇒ 幂等（unchanged=true，不撤销 token）', async () => {
    store.addUser('gina', 'pw', 'user', 'acme');
    const token = await loginToken('gina', 'pw');

    const result = await call('PUT', '/v1/tenants/acme/users/gina');

    expect(result.status).toBe(200);
    expect(result.body.unchanged).toBe(true);
    expect(result.body.revokedTokens).toBe(0);
    expect(authTokens.has(token)).toBe(true);
  });

  it('用户不存在 ⇒ 404', async () => {
    const result = await call('PUT', '/v1/tenants/acme/users/nobody');
    expect(result.status).toBe(404);
  });
});

describe('DELETE /v1/tenants/:tenantId/users/:username（解绑）', () => {
  it('不属于该租户 ⇒ 404 且绑定不变（fail-closed）', async () => {
    store.addUser('helen', 'pw', 'user', 'other');

    const result = await call('DELETE', '/v1/tenants/acme/users/helen');

    expect(result.status).toBe(404);
    expect(store.getUser('helen')?.tenantId).toBe('other');
  });

  it('成功 ⇒ 解绑回本地租户 + 撤销 token', async () => {
    store.addUser('ivan', 'pw', 'user', 'acme');
    const token = await loginToken('ivan', 'pw');

    const result = await call('DELETE', '/v1/tenants/acme/users/ivan');

    expect(result.status).toBe(200);
    expect(result.body.tenantId).toBe('local');
    expect(result.body.revokedTokens).toBe(1);
    expect(store.getUser('ivan')?.tenantId).toBeUndefined();
    expect(authTokens.has(token)).toBe(false);
  });
});

describe('路由派发', () => {
  it('非写方法 / 未匹配路径 ⇒ 不接管', async () => {
    expect((await call('GET', '/v1/tenants/acme/users', {})).body.handled).toBe(
      false
    );
    expect((await call('GET', '/v1/tenants/acme/users/x')).body.handled).toBe(
      false
    );
    expect((await call('PUT', '/v1/tenants/acme/users')).body.handled).toBe(
      false
    );
  });

  it('URL 百分号编码的用户名被解码', async () => {
    store.addUser('a b', 'pw');

    const result = await call('PUT', '/v1/tenants/acme/users/a%20b');

    expect(result.status).toBe(200);
    expect(store.getUser('a b')?.tenantId).toBe('acme');
  });
});
