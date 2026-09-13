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
 * /v1/mcp/* handler 集成测试（P5-2）
 * 覆盖 mcp-marketplace-handlers.ts（route-table 现调用的唯一实现）的
 * search / registries / installed / listTools 契约，防 handler 再次双份漂移。
 * 无适配器/无服务器时行为：返回 200 + 空结构（本地数据源，无网络请求）。
 */
import { describe, it, expect } from 'bun:test';
import http from 'node:http';
import net from 'node:net';
import {
  handleMCPMarketplaceSearch,
  handleMCPMarketplaceRegistries,
  handleMCPInstalledServers,
  handleMCPListTools,
} from '../mcp-marketplace-handlers';

interface MockResponse {
  res: http.ServerResponse;
  status: number;
  body: string;
  json: unknown;
}

function makeReq(method: string, url: string): http.IncomingMessage {
  const req = new http.IncomingMessage(new net.Socket());
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  return req;
}

function makeRes(): MockResponse {
  const state: { status: number; body: string } = { status: 200, body: '' };
  const res = {
    writeHead: (code: number) => {
      state.status = code;
    },
    end: (chunk?: unknown) => {
      if (chunk) state.body = String(chunk);
    },
    setHeader: () => {},
    getHeader: () => undefined,
  } as unknown as http.ServerResponse;
  return {
    res,
    get status() {
      return state.status;
    },
    get body() {
      return state.body;
    },
    get json(): unknown {
      return JSON.parse(state.body || 'null');
    },
  };
}

describe('/v1/mcp/* handler 契约（P5-2）', () => {
  it('GET /v1/mcp/marketplace/search → 200 数组结构（无适配器路径返回空，无网络依赖）', async () => {
    const mock = makeRes();
    await handleMCPMarketplaceSearch(
      // sourceRegistry=manual 无对应适配器 → targetAdapters 空 → 返回 []（不触发网络搜索）
      makeReq(
        'GET',
        '/v1/mcp/marketplace/search?query=test&sourceRegistry=manual'
      ),
      mock.res
    );
    expect(mock.status).toBe(200);
    expect(Array.isArray(mock.json)).toBe(true);
  });

  it('GET /v1/mcp/marketplace/registries → 200 含已注册第三方注册表数组', async () => {
    const mock = makeRes();
    await handleMCPMarketplaceRegistries(
      makeReq('GET', '/v1/mcp/marketplace/registries'),
      mock.res
    );
    expect(mock.status).toBe(200);
    const json = mock.json as { registries: unknown[] };
    expect(Array.isArray(json.registries)).toBe(true);
    // GitHub/Smithery/NPM + 5 个预设主流市场（MCP.so/MCPMarket.cn/魔搭/mcp-marketplace.io/mcpservers.org）= 8 个第三方适配器
    expect(json.registries.length).toBe(8);
  });

  it('GET /v1/mcp/marketplace/installed → 200 数组结构（无已安装返回空）', async () => {
    const mock = makeRes();
    await handleMCPInstalledServers(
      makeReq('GET', '/v1/mcp/marketplace/installed'),
      mock.res
    );
    expect(mock.status).toBe(200);
    expect(Array.isArray(mock.json)).toBe(true);
  });

  it('GET /v1/mcp/tools → 200 { tools: 数组, total: number }（结构契约）', async () => {
    const mock = makeRes();
    await handleMCPListTools(makeReq('GET', '/v1/mcp/tools'), mock.res);
    expect(mock.status).toBe(200);
    // 契约：tools 为数组、total 为数字。不依赖"无服务器"环境假设——
    // 全量 bun test 下共享磁盘状态可能残留 server（见预存错误第五十八次登记）
    expect(Array.isArray(mock.json.tools)).toBe(true);
    expect(typeof mock.json.total).toBe('number');
  });
});
