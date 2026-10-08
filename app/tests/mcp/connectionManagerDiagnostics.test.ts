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
 * 守卫：`MCPConnectionManager` 的**诊断口径**与**关闭语义**。
 *
 * 来源：2026-10-08 真实 MCP server e2e 抓出的两个缺陷（见台账）——
 * 1. `getServer()` / `getServers()` 对"已注册、尚未落入 `clientCache`"的服务器**合成 `failed`**
 *    并兜底文案 `'No active connection'` ⇒ 把健康的在途服务器误报为失败 + 丢掉真实原因；
 * 2. `closeAll()` 不关闭 SDK `Client` ⇒ stdio 子进程泄漏。
 */

import { afterAll, describe, expect, it } from 'bun:test';
import { mcpConnectionManager } from '../../src/services/mcp/MCPConnectionManager.js';
import { getMCPServerManager } from '../../src/services/mcp/MCPServerManager.js';
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../src/services/mcp/types';

/** 仅注册、**不连接**的探针服务器名 */
const PROBE = 'guard-probe';

const CONFIG: ScopedMcpServerConfig = {
  type: 'stdio',
  command: 'echo',
  args: [],
  scope: 'local',
};

describe('MCP 连接管理器诊断口径与关闭语义（真实 e2e 缺陷守卫）', () => {
  afterAll(async () => {
    await mcpConnectionManager.closeAll();
  });

  it('已注册但未落入 clientCache ⇒ pending（非 failed），且不编造错误文案', () => {
    getMCPServerManager().addServer(PROBE, CONFIG);

    const rec = mcpConnectionManager.getServer(PROBE);
    expect(rec?.type).toBe('pending');
    // 不得出现兜底编造文案（`FailedMCPServer.error` 仅在有真实原因时才带值）
    expect((rec as { error?: string }).error).toBeUndefined();
  });

  it('getServers() 对同一情形同样报 pending', () => {
    const rec = mcpConnectionManager.getServers().find((s) => s.name === PROBE);
    expect(rec?.type).toBe('pending');
  });

  it('closeAll() 会关闭 SDK Client（调用其 cleanup）', async () => {
    let cleanupCalls = 0;
    const fakeConnected = {
      name: 'guard-cached',
      type: 'connected',
      config: CONFIG,
      capabilities: {},
      cleanup: async () => {
        cleanupCalls += 1;
      },
    } as unknown as ConnectedMCPServer;

    // 注入私有缓存（仅测试需要；生产入口是 `initialize` 的批量刷新）
    (
      mcpConnectionManager as unknown as {
        clientCache: Map<string, MCPServerConnection>;
      }
    ).clientCache.set('guard-cached', fakeConnected);

    await mcpConnectionManager.closeAll();

    expect(cleanupCalls).toBe(1);
  });
});
