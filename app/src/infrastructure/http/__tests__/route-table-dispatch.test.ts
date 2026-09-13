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
 * route-table 拆分回归测试（FSZ-002 阶段二）
 * 验证 dispatchRoute 领域分发链：每个领域至少一条代表性路由 matched=true。
 */
import { describe, test, expect } from 'bun:test';
import { dispatchRoute } from '../handlers/route-table';

interface MockRes {
  status: number;
  writeHead: (code: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
  body?: string;
}

function mockRes(): MockRes {
  const res = {} as MockRes;
  res.status = 200;
  res.writeHead = (code: number, headers?: Record<string, string>) => {
    res.status = code;
    void headers;
  };
  res.end = (body?: string) => {
    res.body = body;
  };
  return res;
}

async function hit(
  method: string,
  url: string
): Promise<{ matched: boolean; status: number }> {
  const req = { method, url } as unknown as import('http').IncomingMessage;
  const res = mockRes();
  const matched = await dispatchRoute(req, res, url, () => {}, {} as never);
  return { matched, status: res.status };
}

describe('dispatchRoute 领域分发链（13 域）', () => {
  test('chat-session: GET /v1/sessions', async () => {
    const r = await hit('GET', '/v1/sessions');
    expect(r.matched).toBe(true);
  });

  test('plan-flow: GET /v1/plans', async () => {
    const r = await hit('GET', '/v1/plans');
    expect(r.matched).toBe(true);
  });

  test('tool-media: GET /v1/images/list', async () => {
    const r = await hit('GET', '/v1/images/list');
    expect(r.matched).toBe(true);
  });

  test('task-agent: GET /v1/tasks', async () => {
    const r = await hit('GET', '/v1/tasks');
    expect(r.matched).toBe(true);
  });

  test('memory-files: GET /v1/memory', async () => {
    const r = await hit('GET', '/v1/memory');
    expect(r.matched).toBe(true);
  });

  test('workspace: GET /v1/workspaces', async () => {
    const r = await hit('GET', '/v1/workspaces');
    expect(r.matched).toBe(true);
  });

  test('project: GET /v1/workspaces/w1/projects', async () => {
    const r = await hit('GET', '/v1/workspaces/w1/projects');
    expect(r.matched).toBe(true);
  });

  test('knowledge: GET /v1/knowledge/bases', async () => {
    const r = await hit('GET', '/v1/knowledge/bases');
    expect(r.matched).toBe(true);
  });

  test('cost-channel: GET /v1/usage/cost/summary', async () => {
    const r = await hit('GET', '/v1/usage/cost/summary');
    expect(r.matched).toBe(true);
  });

  test('config-skills: GET /v1/skills', async () => {
    const r = await hit('GET', '/v1/skills');
    expect(r.matched).toBe(true);
  });

  test('monitor-command: GET /v1/monitor/summary', async () => {
    const r = await hit('GET', '/v1/monitor/summary');
    expect(r.matched).toBe(true);
  });

  test('marketplace-mcp: GET /v1/mcp/marketplace/registries', async () => {
    const r = await hit('GET', '/v1/mcp/marketplace/registries');
    expect(r.matched).toBe(true);
  });

  test('auth-access: GET /health', async () => {
    const r = await hit('GET', '/health');
    expect(r.matched).toBe(true);
    expect(r.status).toBe(200);
  });

  test('未知路由不匹配', async () => {
    const r = await hit('GET', '/v1/definitely-not-a-route-xyz');
    expect(r.matched).toBe(false);
  });

  test('计划 DAG：GET /v1/plans/plan_x/dag 匹配且非 501', async () => {
    const r = await hit('GET', '/v1/plans/plan_x/dag');
    expect(r.matched).toBe(true);
    expect(r.status).not.toBe(501);
  });
});
