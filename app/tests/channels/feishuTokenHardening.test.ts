/**
 * 飞书 token 加固（2026-10-19）
 *
 * 1. 单飞刷新：并发 refresh 只发起一次 token 请求；
 * 2. 401 / token 失效错误码：强制刷新后重试一次；其它业务错误不重试。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { createFeishuChannel } from '../../src/channels/feishu/FeishuChannel';

interface TokenTestSurface {
  appId: string;
  appSecret: string;
  tenantAccessToken: string | null;
  tokenExpiresAt: number;
  refreshAccessToken(force?: boolean): Promise<void>;
  authFetch(url: string, init?: RequestInit): Promise<Response>;
}

const TOKEN_URL = '/auth/v3/tenant_access_token/internal';
const API_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

const originalFetch = globalThis.fetch;

function makePlugin(): TokenTestSurface {
  const plugin = createFeishuChannel() as unknown as TokenTestSurface;
  plugin.appId = 'app-id';
  plugin.appSecret = 'app-secret';
  plugin.tenantAccessToken = 'old-token';
  plugin.tokenExpiresAt = Date.now() + 60 * 60_000;
  return plugin;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('飞书 token 单飞刷新', () => {
  it('并发 refresh 只发起一次 token 请求', async () => {
    const plugin = makePlugin();
    plugin.tenantAccessToken = null;
    let tokenCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes(TOKEN_URL)) {
        tokenCalls++;
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponse({
          code: 0,
          tenant_access_token: 'new-token',
          expire: 7200,
        });
      }
      return jsonResponse({ code: 0 });
    }) as typeof fetch;

    await Promise.all([
      plugin.refreshAccessToken(),
      plugin.refreshAccessToken(),
    ]);

    expect(tokenCalls).toBe(1);
    expect(plugin.tenantAccessToken).toBe('new-token');
  });
});

describe('飞书 token 失效重试', () => {
  it('HTTP 401 ⇒ 强制刷新并重试一次', async () => {
    const plugin = makePlugin();
    let apiCalls = 0;
    let tokenCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes(TOKEN_URL)) {
        tokenCalls++;
        return jsonResponse({
          code: 0,
          tenant_access_token: 'refreshed',
          expire: 7200,
        });
      }
      apiCalls++;
      return apiCalls === 1
        ? jsonResponse({ code: 99991663, msg: 'invalid token' }, 401)
        : jsonResponse({ code: 0, data: { message_id: 'om_1' } });
    }) as typeof fetch;

    const resp = await plugin.authFetch(API_URL, { method: 'POST' });

    expect(resp.status).toBe(200);
    expect(apiCalls).toBe(2);
    expect(tokenCalls).toBe(1);
  });

  it('JSON 体内 token 失效码 ⇒ 刷新并重试一次', async () => {
    const plugin = makePlugin();
    let apiCalls = 0;
    let tokenCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes(TOKEN_URL)) {
        tokenCalls++;
        return jsonResponse({
          code: 0,
          tenant_access_token: 'refreshed',
          expire: 7200,
        });
      }
      apiCalls++;
      return apiCalls === 1
        ? jsonResponse({ code: 99991663, msg: 'invalid token' })
        : jsonResponse({ code: 0 });
    }) as typeof fetch;

    const resp = await plugin.authFetch(API_URL, { method: 'POST' });
    const body = (await resp.json()) as { code: number };

    expect(body.code).toBe(0);
    expect(apiCalls).toBe(2);
    expect(tokenCalls).toBe(1);
  });

  it('普通业务错误（如撤回目标）⇒ 不刷新、不重试', async () => {
    const plugin = makePlugin();
    let apiCalls = 0;
    let tokenCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes(TOKEN_URL)) {
        tokenCalls++;
        return jsonResponse({
          code: 0,
          tenant_access_token: 'x',
          expire: 7200,
        });
      }
      apiCalls++;
      return jsonResponse({ code: 230011, msg: 'message withdrawn' });
    }) as typeof fetch;

    const resp = await plugin.authFetch(API_URL, { method: 'POST' });
    const body = (await resp.json()) as { code: number };

    expect(body.code).toBe(230011);
    expect(apiCalls).toBe(1);
    expect(tokenCalls).toBe(0);
  });
});
