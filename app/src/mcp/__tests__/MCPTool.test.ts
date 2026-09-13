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
 * MCPTool 单测（P2-2：保留的增强层 MCP 工具，补充行为回归覆盖）
 */
import { describe, it, expect } from 'bun:test';
import { MCPTool } from '../MCPTool';
import type { ToolUseContext } from '../../tools/types';

const context = {} as ToolUseContext;

describe('MCPTool', () => {
  it('list_servers 返回服务器列表（空列表提示无服务器）', async () => {
    const res = await MCPTool.execute({ action: 'list_servers' }, context);
    expect(res.success).toBe(true);
    expect(res.data.servers).toEqual([]);
    expect(res.data.message).toContain('No MCP servers configured');
  });

  it('connect 缺少 server_config 返回错误', async () => {
    const res = await MCPTool.execute({ action: 'connect' }, context);
    expect(res.success).toBe(false);
    expect(res.error).toContain('server_config is required');
  });

  it('userFacingName 各 action 映射', () => {
    expect(MCPTool.userFacingName({ action: 'list_servers' })).toBe(
      'MCP: List Servers'
    );
    expect(
      MCPTool.userFacingName({
        action: 'connect',
        server_config: { name: 'test-srv' } as never,
      })
    ).toContain('test-srv');
    expect(
      MCPTool.userFacingName({ action: 'list_tools', server_name: 'srv' })
    ).toContain('srv');
    expect(
      MCPTool.userFacingName({
        action: 'call',
        server_name: 'srv',
        tool_name: 'tool-a',
      })
    ).toContain('tool-a');
    expect(MCPTool.userFacingName({})).toBe('MCPTool');
  });

  it('getActivityDescription / getToolUseSummary 映射与默认值', () => {
    expect(MCPTool.getActivityDescription({ action: 'list_servers' })).toBe(
      'Listing MCP servers'
    );
    expect(
      MCPTool.getActivityDescription({
        action: 'connect',
        server_config: { name: 's' } as never,
      })
    ).toContain('s');
    expect(
      MCPTool.getActivityDescription({ action: 'unknown' as never })
    ).toBeNull();

    expect(MCPTool.getToolUseSummary({ action: 'list_servers' })).toBe(
      'List MCP servers'
    );
    expect(MCPTool.getToolUseSummary({ action: 'nope' as never })).toBeNull();
  });

  it('工具元数据完整（名称/参数/只读标记）', () => {
    expect(MCPTool.name).toBe('MCPTool');
    expect(MCPTool.params.some((p) => p.name === 'action')).toBe(true);
    expect(MCPTool.isReadOnly()).toBe(false);
    expect(MCPTool.isEnabled()).toBe(true);
  });
});
