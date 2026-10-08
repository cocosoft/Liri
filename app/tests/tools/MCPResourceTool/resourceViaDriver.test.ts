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
 * `mcp_resource` 工具「资源面实现归属翻转」守卫（2026-10-08，MCP 双轨收敛 C-1 续）。
 *
 * 背景：`list_resources` / `read_resource` 由**直连 SDK** 改为**经 VFS 驱动
 * `McpResourcesDriver`**（`mcp://` 面的单一实现）；`list_prompts` / `get_prompt` 仍直连 SDK
 * （本次不改，不在本文件覆盖范围）。
 *
 * 本测试用 `spyOn(mcpConnectionManager, 'getSdkClient')` 注入桩 `Client`（**不连真实 MCP**；
 * 测试内允许构造测试替身，CS04 只约束 `src/`），断言**工具既有出参形状不变**：
 * - `resources` = `{ uri, name, description?, mimeType? }`（驱动以 uri 原文作 name）；
 * - `content`  = `{ contents: [{ uri, mimeType, text }] }`；
 * - 服务器未连接 ⇒ `success:false` 且 `error` 如实（不静默降级）。
 */

import { afterAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { MCPResourceTool } from '../../../src/tools/MCPResourceTool/MCPResourceTool.js';
import { mcpConnectionManager } from '../../../src/services/mcp/MCPConnectionManager';
import type { ToolUseContext } from '../../../src/tools/types/ToolUseContext.js';

/** 桩资源条目（驱动 `list()` 读取 uri/mimeType/description） */
interface StubResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

/** 桩 `readResource` 返回的 contents 条目 */
type StubContent =
  | { uri: string; text: string; mimeType?: string }
  | { uri: string; blob: string; mimeType?: string };

/** 当前桩 `listResources()` 返回的资源 */
let resources: StubResource[] = [];
/** 当前桩 `readResource()` 返回的 contents */
let readContents: StubContent[] = [];
/** 判定为"已连接"的服务器名（`getSdkClient` 命中该名才返回桩） */
let connectedServer = 'srv';

/** 最小 SDK `Client` 桩（只含被测路径用到的两个顶层方法） */
function stubClient(): Client {
  const stub = {
    listResources: async () => ({ resources }),
    readResource: async (_params: { uri: string }) => ({
      contents: readContents,
    }),
  };
  return stub as unknown as Client;
}

const getSdkClientSpy = spyOn(mcpConnectionManager, 'getSdkClient');

getSdkClientSpy.mockImplementation((name: string) =>
  name === connectedServer ? stubClient() : undefined
);

afterAll(() => {
  getSdkClientSpy.mockRestore();
});

beforeEach(() => {
  resources = [];
  readContents = [];
  connectedServer = 'srv';
});

const tool = new MCPResourceTool();
const ctx = {} as ToolUseContext;

describe('mcp_resource（经 McpResourcesDriver）：list_resources', () => {
  it('映射为 {uri,name,description,mimeType}，输出文案不变', async () => {
    resources = [
      {
        uri: 'file:///tmp/a.txt',
        name: 'a.txt',
        mimeType: 'text/plain',
        description: '示例文本',
      },
      { uri: 'db://rows', name: 'rows' },
    ];
    const r = await tool.execute(
      { action: 'list_resources', server_name: 'srv' },
      ctx
    );
    expect(r.success).toBe(true);
    const output = r.data as { resources: unknown[]; message: string };
    expect(output.resources).toEqual([
      {
        uri: 'file:///tmp/a.txt',
        name: 'file:///tmp/a.txt',
        description: '示例文本',
        mimeType: 'text/plain',
      },
      // 源未提供 description/mimeType ⇒ 字段省略（不编造）
      { uri: 'db://rows', name: 'db://rows' },
    ]);
    expect(output.message).toBe('Found 2 resources from srv');
    expect(r.output).toContain('Resources from srv:');
  });

  it('服务器未连接 ⇒ success=false，error 如实（不静默降级）', async () => {
    const r = await tool.execute(
      { action: 'list_resources', server_name: 'ghost' },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('MCP 服务器未连接');
  });
});

describe('mcp_resource（经 McpResourcesDriver）：read_resource', () => {
  it('content 重建为 {contents:[{uri,mimeType,text}]}，输出文案不变', async () => {
    readContents = [
      { uri: 'file:///tmp/a.txt', mimeType: 'text/plain', text: 'hi' },
    ];
    const r = await tool.execute(
      {
        action: 'read_resource',
        server_name: 'srv',
        uri: 'file:///tmp/a.txt',
      },
      ctx
    );
    expect(r.success).toBe(true);
    const output = r.data as { content: unknown; message: string };
    expect(output.content).toEqual({
      contents: [
        { uri: 'file:///tmp/a.txt', mimeType: 'text/plain', text: 'hi' },
      ],
    });
    expect(output.message).toBe('Read resource file:///tmp/a.txt from srv');
    expect(r.output).toContain('Resource content:');
  });

  it('服务器未连接 ⇒ success=false，error 如实', async () => {
    const r = await tool.execute(
      {
        action: 'read_resource',
        server_name: 'ghost',
        uri: 'file:///tmp/a.txt',
      },
      ctx
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('MCP 服务器未连接');
  });
});
