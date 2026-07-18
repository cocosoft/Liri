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
// IMPLIED, BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import type http from 'http';
import { sendError, readRequestBody } from './handler-utils';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'infrastructure:http:handlers:apikey-handlers', level: LogLevel.INFO });

const apiKeys = new Map<
  string,
  { name: string; key: string; createdAt: number }
>();

// ========== APIKey Handlers ==========

/**
 * 列出所有 API Key
 */
export async function handleListApiKeys(
  _req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const apiKeyList = Array.from(apiKeys.entries()).map(([id, data]) => ({
      id,
      name: data.name,
      key_prefix: data.key.substring(0, 8),
      created_at: data.createdAt,
      permissions: ['read'],
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(apiKeyList));
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 创建 API Key
 */
export async function handleCreateApiKey(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  try {
    const body = await readRequestBody(req);
    const { name } = JSON.parse(body);

    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'name is required' } }));
      return;
    }

    const id = `key_${Date.now()}`;
    const key = `sk-${Math.random().toString(36).substr(2, 32)}`;

    apiKeys.set(id, { name, key, createdAt: Date.now() });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id,
        name,
        key,
        key_prefix: key.substring(0, 8),
        created_at: Date.now(),
        permissions: ['read'],
      })
    );
  } catch (err) {
    sendError(res, err);
  }
}

/**
 * 删除 API Key
 */
export async function handleDeleteApiKey(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  keyId: string
): Promise<void> {
  try {
    if (!apiKeys.has(keyId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'API key not found' } }));
      return;
    }

    apiKeys.delete(keyId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({}));
  } catch (err) {
    sendError(res, err);
  }
}
