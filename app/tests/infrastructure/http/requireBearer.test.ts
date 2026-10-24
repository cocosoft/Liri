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
 * §6-#11：**对外暴露部署必须带登录态**（`REQUIRE_BEARER`，默认开）。
 *
 * 锁四件事：
 *  ① 暴露面判定：回环（桌面/CLI）⇒ false；`0.0.0.0` / 局域网 IP ⇒ true；
 *  ② 豁免路径：`/v1/health*`（容器探活）、`/v1/a2a*`（自带 A2A_API_KEYS）；
 *  ③ 灰度回退：`FEATURE_REQUIRE_BEARER=false` ⇒ 不拦截（旧行为）；
 *  ④ 会话判据：`authTokens` 命中才算有效登录态。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type http from 'http';

import {
  hasValidBearerSession,
  isBearerExemptPath,
  isExposedDeployment,
  requiresBearerSession,
} from '../../../src/infrastructure/http/requestIdentity';
import { authTokens } from '../../../src/infrastructure/http/handlers/auth-handlers';

const originHost = process.env['LIRI_HTTP_HOST'];
const originFlag = process.env['FEATURE_REQUIRE_BEARER'];

function req(headers: Record<string, string> = {}): http.IncomingMessage {
  return { headers } as unknown as http.IncomingMessage;
}

beforeEach(() => {
  delete process.env['FEATURE_REQUIRE_BEARER'];
});

afterEach(() => {
  if (originHost === undefined) delete process.env['LIRI_HTTP_HOST'];
  else process.env['LIRI_HTTP_HOST'] = originHost;
  if (originFlag === undefined) delete process.env['FEATURE_REQUIRE_BEARER'];
  else process.env['FEATURE_REQUIRE_BEARER'] = originFlag;
  authTokens.clear();
});

describe('暴露面判定', () => {
  it('回环地址 ⇒ 不算暴露（桌面/CLI 零行为变更）', () => {
    for (const host of [
      '127.0.0.1',
      'localhost',
      '::1',
      '[::1]',
      ' 127.0.0.1 ',
    ]) {
      expect(isExposedDeployment({ LIRI_HTTP_HOST: host })).toBe(false);
    }
    expect(isExposedDeployment({})).toBe(false);
  });

  it('非回环绑定 ⇒ 算暴露', () => {
    for (const host of ['0.0.0.0', '192.168.1.10', '10.0.0.2']) {
      expect(isExposedDeployment({ LIRI_HTTP_HOST: host })).toBe(true);
    }
  });
});

describe('豁免路径', () => {
  it('health / a2a 及其子路径豁免；其余不豁免', () => {
    for (const p of [
      '/v1/health',
      '/v1/health/report',
      '/v1/a2a',
      '/v1/a2a/tasks',
    ]) {
      expect(isBearerExemptPath(p)).toBe(true);
    }
    for (const p of ['/v1/sessions', '/v1/chat/stream', '/v1/healthz']) {
      expect(isBearerExemptPath(p)).toBe(false);
    }
  });
});

describe('requiresBearerSession：三条件同时满足才拦截', () => {
  it('暴露 + 默认开 + 非豁免 ⇒ 拦截', () => {
    process.env['LIRI_HTTP_HOST'] = '0.0.0.0';
    expect(requiresBearerSession('/v1/sessions')).toBe(true);
    expect(requiresBearerSession('/v1/health/report')).toBe(false);
  });

  it('回环 ⇒ 不拦截（即使开关开着）', () => {
    process.env['LIRI_HTTP_HOST'] = '127.0.0.1';
    expect(requiresBearerSession('/v1/sessions')).toBe(false);
  });

  it('灰度回退 FEATURE_REQUIRE_BEARER=false ⇒ 不拦截', () => {
    process.env['LIRI_HTTP_HOST'] = '0.0.0.0';
    process.env['FEATURE_REQUIRE_BEARER'] = 'false';
    expect(requiresBearerSession('/v1/sessions')).toBe(false);
  });
});

describe('hasValidBearerSession：与既有鉴权同一判据', () => {
  it('无 / 空 / 非 Bearer ⇒ false；命中 authTokens ⇒ true', async () => {
    expect(await hasValidBearerSession(req())).toBe(false);
    expect(await hasValidBearerSession(req({ authorization: 'Bearer ' }))).toBe(
      false
    );
    expect(
      await hasValidBearerSession(req({ authorization: 'Token abc' }))
    ).toBe(false);

    authTokens.set('tok-1', { username: 'alice', permissions: [] });
    expect(
      await hasValidBearerSession(req({ authorization: 'Bearer tok-1' }))
    ).toBe(true);
    expect(
      await hasValidBearerSession(req({ authorization: 'Bearer nope' }))
    ).toBe(false);
  });
});
