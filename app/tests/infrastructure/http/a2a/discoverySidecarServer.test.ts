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
 * ① P3 —— sidecar **委派端点**（`POST /v1/a2a/tasks`）单测（2026-10-10）。
 *
 * 用 `startDiscoveryServer` 注入**假 delegate**（模拟"经 IPC 回主进程内核"），
 * 走真实 loopback HTTP，锁定：200（有委派）/ 503（未接入）/ 401（无鉴权）。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Server } from 'node:http';
import { startDiscoveryServer } from '../../../../src/infrastructure/http/a2a/discoverySidecar';

const KEY = 'p3-test-key';
let prevKey: string | undefined;

beforeAll(() => {
  prevKey = process.env.A2A_API_KEYS;
  process.env.A2A_API_KEYS = KEY;
});
afterAll(() => {
  if (prevKey === undefined) delete process.env.A2A_API_KEYS;
  else process.env.A2A_API_KEYS = prevKey;
});

async function listen(
  deps: Parameters<typeof startDiscoveryServer>[1]
): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = await startDiscoveryServer(
    { host: '127.0.0.1', port: 0 },
    deps
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe('① P3 sidecar 委派端点', () => {
  it('POST /v1/a2a/tasks 且已接入委派 ⇒ 200（注入的 delegate 被调用）', async () => {
    const { base, close } = await listen({
      getSnapshot: () => null,
      delegate: async (message) => ({
        status: 200,
        body: { id: 't', message },
      }),
    });
    const r = await fetch(`${base}/v1/a2a/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 't', message: 'hi' });
    await close();
  });

  it('未接入委派 ⇒ 503 + Retry-After（如实未就绪）', async () => {
    const { base, close } = await listen({ getSnapshot: () => null });
    const r = await fetch(`${base}/v1/a2a/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('5');
    await close();
  });

  it('无鉴权 ⇒ 401（fail-closed）', async () => {
    const { base, close } = await listen({
      getSnapshot: () => null,
      delegate: async () => ({ status: 200, body: {} }),
    });
    const r = await fetch(`${base}/v1/a2a/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    expect(r.status).toBe(401);
    await close();
  });

  it('message 为空 ⇒ 400', async () => {
    const { base, close } = await listen({
      getSnapshot: () => null,
      delegate: async () => ({ status: 200, body: {} }),
    });
    const r = await fetch(`${base}/v1/a2a/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY },
      body: JSON.stringify({ message: '   ' }),
    });
    expect(r.status).toBe(400);
    await close();
  });
});
