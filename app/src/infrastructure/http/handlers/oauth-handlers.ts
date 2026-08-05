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
 * OAuth 管理 API（M3，方向① 运维入口）
 * GET  /v1/oauth/providers        — 只读列出 provider 配置（clientSecret 脱敏）
 * PUT  /v1/oauth/providers/:id    — 运维更新 provider（clientSecret AES-256-GCM 加密落盘）
 */

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';
import { createOAuthProviderStore } from '@modules/oauth';

const providerStore = createOAuthProviderStore();

/**
 * 列出 OAuth Provider 配置 GET /v1/oauth/providers
 * clientSecret 不返回明文（hasClientSecret 标记是否存在）
 */
export async function handleListOAuthProviders(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const providers = providerStore.listProviders();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(providers));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 更新 OAuth Provider 配置 PUT /v1/oauth/providers/{providerId}
 * body: { clientId?, clientSecret?, redirectUri?, scopes?, enabled? }
 * 仅支持 configured 来源；env provider 由环境变量只读管理
 */
export async function handleUpdateOAuthProvider(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  providerId: string
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { clientId, clientSecret, redirectUri, scopes, enabled } =
      JSON.parse(body);

    const updated = providerStore.updateProvider(providerId, {
      clientId,
      clientSecret,
      redirectUri,
      scopes,
      enabled,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updated));
  } catch (err) {
    sendError(res, err);
  }
}
