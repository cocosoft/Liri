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

/**
 * `dispatchAuthAccessRoutes` 的**路由接线与顺序**特征化测试（T3 复杂度清理前置，2026-11-17）。
 *
 * 目的：把该分发的既有行为钉住，供后续按领域拆分（圈复杂度 137 → 阈值内）时对照：
 *  ① 精确匹配 / 正则取值（`/v1/apikeys/:id`、`/v1/agent-roles/:id`）各命中对应 handler；
 *  ② 同一前缀下「精确在前、带参在后」（`/v1/agent-roles` vs `/v1/agent-roles/:id`）；
 *  ③ 未匹配 ⇒ 返回 `false` 且不调用任何 handler；
 *  ④ `handlerCtx` 透传到文件类 handler（与 `route-table` 的调用口径一致）。
 *
 * 手法：`spyOn` 各 handler 模块导出（bun 的 ESM live binding 会让分发模块取到桩），
 * 只断言"调用了谁 / 带了哪些参数"，不触真实 handler 实现。
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type http from 'http';

import * as authHandlers from '../../src/infrastructure/http/handlers/auth-handlers';
import * as apikeyHandlers from '../../src/infrastructure/http/handlers/apikey-handlers';
import * as fileAccessHandlers from '../../src/infrastructure/http/handlers/file-access-handlers';
import * as agentRoleHandlers from '../../src/infrastructure/http/handlers/agent-role-handlers';
import * as mediaHandlers from '../../src/infrastructure/http/handlers/media-handlers';
import type { HandlerCtx } from '../../src/infrastructure/http/handlers/handler-utils';
import { dispatchAuthAccessRoutes } from '../../src/infrastructure/http/handlers/routes/auth-access-routes';

const spies: Array<{ mockRestore: () => void }> = [];

function stub<T extends object>(mod: T, key: keyof T) {
  const s = spyOn(mod as never, key as never).mockImplementation(
    (async () => {}) as never
  );
  spies.push(s as unknown as { mockRestore: () => void });
  return s as unknown as {
    mock: { calls: unknown[][] };
  };
}

afterEach(() => {
  for (const s of spies.splice(0, spies.length)) s.mockRestore();
});

function makeReq(url: string, method = 'GET'): http.IncomingMessage {
  return { url, method, headers: {} } as unknown as http.IncomingMessage;
}

const res = {} as http.ServerResponse;
const ctx = { readRequestBody: async () => '' } as unknown as HandlerCtx;
const noopBroadcast = () => {};

async function dispatch(url: string, method = 'GET'): Promise<boolean> {
  return dispatchAuthAccessRoutes(
    makeReq(url, method),
    res,
    url,
    noopBroadcast,
    ctx
  );
}

describe('dispatchAuthAccessRoutes：路由接线与顺序（特征化）', () => {
  it('① 精确匹配：POST /v1/auth/login 命中 handleAuthLogin', async () => {
    const login = stub(authHandlers, 'handleAuthLogin');
    const me = stub(authHandlers, 'handleAuthMe');

    expect(await dispatch('/v1/auth/login', 'POST')).toBe(true);
    expect(login.mock.calls).toHaveLength(1);
    expect(me.mock.calls).toHaveLength(0);
  });

  it('② 正则取值：DELETE /v1/apikeys/:id 把 id 传给 handler', async () => {
    const del = stub(apikeyHandlers, 'handleDeleteApiKey');
    const list = stub(apikeyHandlers, 'handleListApiKeys');

    expect(await dispatch('/v1/apikeys/key-123', 'DELETE')).toBe(true);
    expect(del.mock.calls).toHaveLength(1);
    expect(del.mock.calls[0]![2]).toBe('key-123');
    expect(list.mock.calls).toHaveLength(0);
  });

  it('③ 精确在前、带参在后：/v1/agent-roles 与 /v1/agent-roles/:id 各归其位', async () => {
    const list = stub(agentRoleHandlers, 'handleListAgentRoles');
    const get = stub(agentRoleHandlers, 'handleGetAgentRole');

    expect(await dispatch('/v1/agent-roles')).toBe(true);
    expect(list.mock.calls).toHaveLength(1);
    expect(get.mock.calls).toHaveLength(0);

    expect(await dispatch('/v1/agent-roles/agent-9')).toBe(true);
    expect(get.mock.calls).toHaveLength(1);
    expect(get.mock.calls[0]![3]).toBe('agent-9');
  });

  it('④ handlerCtx 透传到文件类 handler', async () => {
    const paths = stub(fileAccessHandlers, 'handleFilePaths');

    expect(await dispatch('/api/file/paths')).toBe(true);
    expect(paths.mock.calls).toHaveLength(1);
    expect(paths.mock.calls[0]![0]).toBe(ctx);
  });

  it('⑤ 媒体路由：POST /v1/media/subtitle 命中生成入口', async () => {
    const gen = stub(mediaHandlers, 'handleMediaSubtitleGenerate');

    expect(await dispatch('/v1/media/subtitle', 'POST')).toBe(true);
    expect(gen.mock.calls).toHaveLength(1);
  });

  it('⑥ 未匹配 ⇒ false 且不调用任何 handler', async () => {
    const login = stub(authHandlers, 'handleAuthLogin');
    const list = stub(apikeyHandlers, 'handleListApiKeys');

    expect(await dispatch('/v1/does-not-exist')).toBe(false);
    expect(login.mock.calls).toHaveLength(0);
    expect(list.mock.calls).toHaveLength(0);
  });
});
