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
 * MCPTool 副作用 scope 测试（§3.1 关联点1/4）
 *
 * 验证：MCPTool connect 成功后在会话级 scope 登记 disconnect 逆操作，
 * 会话销毁（disposeSession）时连接被断开；无 sessionId 时跳过登记不报错。
 */
import { describe, test, expect, jest, beforeEach } from 'bun:test';

const disconnectMock = jest.fn();

jest.mock('../../services/mcp/MCPServerManager.js', () => ({
  getMCPServerManager: () => ({
    addServer: () => {},
    getServer: () => ({
      connect: async () => true,
      disconnect: disconnectMock,
    }),
  }),
}));

// 动态导入（jest.mock 已 hoisted，MCPTool 内 getMCPServerManager 取到 mock 实现）
const { MCPTool } = await import('../MCPTool');
const { toolScopeManager } = await import('../../tool/ToolScopeManager');

describe('MCPTool 连接副作用登记（§3.1 关联点1/4）', () => {
  beforeEach(() => {
    disconnectMock.mockClear();
  });

  test('connect 成功后，会话 scope dispose 时断开连接', async () => {
    const result = await MCPTool.execute(
      {
        action: 'connect',
        server_config: {
          name: 'srv-a',
          url: 'http://localhost:9999',
        } as any,
      },
      { sessionId: 'session-1' } as any
    );

    expect(result.success).toBe(true);
    expect(disconnectMock).not.toHaveBeenCalled();

    await toolScopeManager.disposeSession('session-1');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  test('无 sessionId 时跳过登记，不报错', async () => {
    const result = await MCPTool.execute(
      {
        action: 'connect',
        server_config: {
          name: 'srv-b',
          url: 'http://localhost:9998',
        } as any,
      },
      {} as any
    );

    expect(result.success).toBe(true);
    expect(disconnectMock).not.toHaveBeenCalled();
  });
});
