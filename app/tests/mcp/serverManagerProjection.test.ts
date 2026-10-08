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
 * `MCPServerManager` 连接投影守卫（2026-10-08，MCP 双轨收敛 C-3 的配套）。
 *
 * 背景：C-3 去掉了 `MCPConnectionManager.initialize` 的 `manager.connectAll()`
 * （消除「同服务器双连接」）。此后 `MCPServerManager` 的自研连接**不再急切建立**，
 * 其对外状态/工具**改由 C1 投影提供**（`setProjection`，数据源 = C1）。
 *
 * 若无「投影优先」，以下 3 处消费者会回归（工具列表恒空 / 连接状态恒 false）：
 *   - `GET /v1/mcp/tools`（`mcp-marketplace-handlers.ts` 遍历 `serverInfos[].tools`）
 *   - `MCPMarketplace.getInstalledServerDetail().connected`
 *   - CLI `mcp tool list`
 *
 * 本测试用**独立实例**（`new MCPServerManager()`），不污染全局单例。
 */
import { describe, expect, it } from 'bun:test';
import { MCPServerManager } from '../../src/services/mcp/MCPServerManager';
import { MCPServerStatus } from '../../src/services/mcp/types';
import type { MCPServerConfig } from '../../src/services/mcp/types';

/** 最小 stdio 配置（connect 从未被调用 ⇒ transport 不会 spawn 子进程） */
const STDIO_CFG: MCPServerConfig = { type: 'stdio', command: 'noop' };

describe('MCPServerManager 连接投影（C-3）', () => {
  it('getServerInfos 反映投影的状态与工具（数据源 = C1）', () => {
    const manager = new MCPServerManager();
    manager.addServer('s1', STDIO_CFG);
    manager.setProjection('s1', {
      status: MCPServerStatus.CONNECTED,
      tools: [{ name: 't1', description: 'd1', inputSchema: {} }],
    });

    const info = manager.getServerInfos().find((i) => i.name === 's1');
    expect(info?.status).toBe(MCPServerStatus.CONNECTED);
    expect(info?.tools.map((t) => t.name)).toEqual(['t1']);
  });

  it('无投影时回退到自研连接状态（未连接 / 无工具）', () => {
    const manager = new MCPServerManager();
    manager.addServer('s2', STDIO_CFG);

    const info = manager.getServerInfos().find((i) => i.name === 's2');
    expect(info?.status).toBe(MCPServerStatus.DISCONNECTED);
    expect(info?.tools).toEqual([]);
  });

  it('getServerTools 优先返回投影工具（不经自研连接 refresh）', async () => {
    const manager = new MCPServerManager();
    manager.addServer('s3', STDIO_CFG);
    manager.setProjection('s3', {
      status: MCPServerStatus.CONNECTED,
      tools: [{ name: 'x', description: 'dx', inputSchema: {} }],
    });

    const info = await manager.getServerTools('s3');
    expect(info.status).toBe(MCPServerStatus.CONNECTED);
    expect(info.tools.map((t) => t.name)).toEqual(['x']);
  });

  it('removeServer 清除投影', () => {
    const manager = new MCPServerManager();
    manager.addServer('s4', STDIO_CFG);
    manager.setProjection('s4', {
      status: MCPServerStatus.CONNECTED,
      tools: [],
    });
    manager.removeServer('s4');

    expect(
      manager.getServerInfos().find((i) => i.name === 's4')
    ).toBeUndefined();
  });

  it('closeAll 清空全部投影（关闭时）', async () => {
    const manager = new MCPServerManager();
    manager.addServer('s5', STDIO_CFG);
    manager.setProjection('s5', {
      status: MCPServerStatus.CONNECTED,
      tools: [{ name: 'z', description: 'dz', inputSchema: {} }],
    });
    await manager.closeAll();

    const info = manager.getServerInfos().find((i) => i.name === 's5');
    expect(info?.status).toBe(MCPServerStatus.DISCONNECTED);
  });
});
