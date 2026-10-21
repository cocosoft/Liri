/**
 * 多租户 P3：注册/登录的**租户绑定**接线
 *
 * 锁三件事：
 *  ① 默认（未开 `LIRI_TENANT_SELF_REGISTER`）：注册一律落 `local`，声明非本地租户 ⇒ **400**
 *     （明确拒绝，不静默降级成 local）；
 *  ② 开启后：注册声明 `acme` ⇒ 用户记录持久化 `tenantId` ⇒ 登录 token 带它 ⇒
 *     `resolveRequestPrincipal` 解析出 `{tenantId:'acme'}`（HTTP → 身份的完整链路）；
 *  ③ 非法租户标识（含冒号 / 空白 / 超长）⇒ 400，且不创建用户。
 *
 * 说明：`AuthUserStore` 走临时文件（注入替换），不写真实 `{data}/auth/users.json`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type http from 'http';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { AuthUserStore } from '../../src/infrastructure/http/auth/AuthUserStore.js';
import {
  __setAuthUserStoreForTest,
  authTokens,
  decideRegistrationTenant,
  handleAuthLogin,
  handleAuthMe,
  handleAuthRegister,
} from '../../src/infrastructure/http/handlers/auth-handlers.js';
import { resolveRequestPrincipal } from '../../src/infrastructure/http/requestIdentity.js';
import { PermissionManager } from '@modules/permission';

let root: string;
let store: AuthUserStore;
const createdTokens: string[] = [];

function makeReq(payload: unknown, token?: string): http.IncomingMessage {
  const buf = Buffer.from(JSON.stringify(payload));
  const stream = Readable.from([buf]);
  const headers: Record<string, string> = {
    'content-length': String(buf.length),
  };
  if (token) headers['authorization'] = `Bearer ${token}`;
  return Object.assign(stream, {
    method: 'POST',
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
    read: () => ({ status: out.status, body: JSON.parse(out.body) }),
  };
}

async function register(payload: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const { res, read } = createRes();
  await handleAuthRegister(makeReq(payload), res);
  return read();
}

async function login(
  username: string,
  password: string,
  extra: Record<string, unknown> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { res, read } = createRes();
  await handleAuthLogin(makeReq({ username, password, ...extra }), res);
  return read();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'liri-auth-tenant-'));
  store = new AuthUserStore(join(root, 'users.json'));
  __setAuthUserStoreForTest(store);
  delete process.env['LIRI_TENANT_SELF_REGISTER'];
});

afterEach(() => {
  for (const token of createdTokens.splice(0)) authTokens.delete(token);
  delete process.env['LIRI_TENANT_SELF_REGISTER'];
  // 注册/登录会写进程级角色（E↔A 打通），用例后复位，避免影响同进程其他文件
  PermissionManager.getInstance().setCurrentUserRole(null);
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // @ignore-catch — Windows 句柄可能延迟释放，清理失败不影响断言
  }
});

describe('decideRegistrationTenant：纯判定', () => {
  it('未声明 ⇒ local；声明 local ⇒ 允许', () => {
    expect(decideRegistrationTenant(undefined)).toEqual({
      ok: true,
      tenantId: 'local',
    });
    expect(decideRegistrationTenant(null)).toEqual({
      ok: true,
      tenantId: 'local',
    });
    expect(decideRegistrationTenant('local')).toEqual({
      ok: true,
      tenantId: 'local',
    });
  });

  it('非法格式 ⇒ 拒绝（含冒号 / 空白 / 超长 / 首字符非字母数字）', () => {
    for (const bad of ['a:b', '   ', 'x'.repeat(65), '-abc', 'acme/x']) {
      expect(decideRegistrationTenant(bad).ok).toBe(false);
    }
  });

  it('非字符串 ⇒ 拒绝', () => {
    expect(decideRegistrationTenant(123).ok).toBe(false);
    expect(decideRegistrationTenant({}).ok).toBe(false);
  });

  it('开关开 ⇒ 允许合法非本地租户；关 ⇒ 拒绝', () => {
    process.env['LIRI_TENANT_SELF_REGISTER'] = '1';
    expect(decideRegistrationTenant('acme')).toEqual({
      ok: true,
      tenantId: 'acme',
    });

    delete process.env['LIRI_TENANT_SELF_REGISTER'];
    expect(decideRegistrationTenant('acme').ok).toBe(false);
  });
});

describe('注册/登录 → 请求身份（完整链路）', () => {
  it('默认（开关关）⇒ 注册声明 acme 被 400 拒绝，且不创建用户', async () => {
    const result = await register({
      username: 'alice',
      password: 'pw',
      tenantId: 'acme',
    });

    expect(result.status).toBe(400);
    expect(store.hasUser('alice')).toBe(false);
  });

  it('默认（开关关）⇒ 不声明租户则落 local（桌面端不变）', async () => {
    const reg = await register({ username: 'bob', password: 'pw' });
    expect(reg.status).toBe(201);
    const token = String(reg.body.token);
    createdTokens.push(token);

    const principal = await resolveRequestPrincipal(makeReq({}, token));
    expect(principal.tenantId).toBe('local');
    expect(principal.userId).toBe('bob');
  });

  it('开关开 ⇒ 注册 acme、登录取 token、身份解析出 acme', async () => {
    process.env['LIRI_TENANT_SELF_REGISTER'] = '1';

    const reg = await register({
      username: 'carol',
      password: 'pw',
      tenantId: 'acme',
    });
    expect(reg.status).toBe(201);
    createdTokens.push(String(reg.body.token));
    // 账号属性已持久化（不是只存在内存 token 里）
    expect(store.getUser('carol')?.tenantId).toBe('acme');

    const logged = await login('carol', 'pw');
    expect(logged.status).toBe(200);
    const token = String(logged.body.token);
    createdTokens.push(token);

    // 登录 body 自报别的租户 ⇒ 被忽略（租户只能来自账号绑定）
    const smuggled = await login('carol', 'pw', { tenantId: 'other' });
    createdTokens.push(String(smuggled.body.token));
    expect(authTokens.get(String(smuggled.body.token))?.tenantId).toBe('acme');

    const principal = await resolveRequestPrincipal(makeReq({}, token));
    expect(principal.tenantId).toBe('acme');
    expect(principal.userId).toBe('carol');

    // /v1/auth/me 也回显生效租户（便于前端/诊断）
    const { res, read } = createRes();
    await handleAuthMe(makeReq({}, token), res);
    expect(read().body.tenantId).toBe('acme');
  });

  it('非法租户标识 ⇒ 400 且不创建用户', async () => {
    process.env['LIRI_TENANT_SELF_REGISTER'] = '1';

    const result = await register({
      username: 'dave',
      password: 'pw',
      tenantId: 'acme:corp',
    });

    expect(result.status).toBe(400);
    expect(store.hasUser('dave')).toBe(false);
  });
});
