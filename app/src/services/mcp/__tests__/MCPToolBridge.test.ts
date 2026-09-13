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
 * MCPToolBridge 工具集变更广播测试（§3.1 关联点2）
 *
 * 验证：MCP 服务器工具注册时经 DependencyRegistry provide `mcp:tools:<server>`，
 * 注销时 withdraw；消费者通过 subscribe 感知变更（与 T2.2 模型热切换同模式）。
 */
import { describe, test, expect, jest } from 'bun:test';

jest.mock('../MCPConnectionManager', () => ({
  mcpConnectionManager: {
    getAllTools: () =>
      new Map([
        [
          'srv1',
          {
            serverName: 'srv1',
            tools: [
              { name: 'toolA', description: 'desc A', inputJSONSchema: {} },
              { name: 'toolB', description: 'desc B', inputJSONSchema: {} },
            ],
          },
        ],
      ]),
    getServer: () => ({ type: 'connected', client: {} }),
  },
}));

const { mcpToolBridge } = await import('../MCPToolBridge');
const { mcpToolRegistry } = await import('../MCPToolRegistry');
const { dependencyRegistry } = await import('@modules/context');

describe('MCPToolBridge 工具集变更广播（§3.1 关联点2）', () => {
  test('initialize 注册工具后 provide 工具集变更', async () => {
    const changes: { type: string; next?: unknown }[] = [];
    const unsub = dependencyRegistry.subscribe('mcp:tools:srv1', (c) =>
      changes.push(c as { type: string; next?: unknown })
    );

    await mcpToolBridge.initialize();
    expect(changes.length).toBe(1);
    expect(changes[0].type).toBe('provide');
    expect(changes[0].next).toEqual(['toolA', 'toolB']);

    unsub();
  });

  test('cleanup 注销工具后 withdraw 广播', async () => {
    // 重置 initialized 与 dependencyRegistry 残留值（值不变不通知，需先清空）
    await mcpToolBridge.cleanup();
    const changes: { type: string }[] = [];
    const unsub = dependencyRegistry.subscribe('mcp:tools:srv1', (c) =>
      changes.push(c as { type: string })
    );

    await mcpToolBridge.initialize();
    expect(changes.at(-1)?.type).toBe('provide');

    await mcpToolBridge.cleanup();
    expect(changes.at(-1)?.type).toBe('withdraw');

    unsub();
  });

  test('cleanup 同步清理 mcpToolRegistry（防 refreshAllTools 残留）', async () => {
    await mcpToolBridge.cleanup(); // 重置 initialized 与残留状态

    await mcpToolBridge.initialize();
    expect(mcpToolRegistry.getToolsByServer('srv1').length).toBe(2);

    await mcpToolBridge.cleanup();
    expect(mcpToolRegistry.getToolsByServer('srv1').length).toBe(0);
  });
});
