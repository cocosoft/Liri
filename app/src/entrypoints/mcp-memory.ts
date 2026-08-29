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
 * 记忆 MCP Server 入口 —— 通过 stdio 运行。
 *
 * 将 Liri 记忆系统暴露为标准 MCP 工具（对标报告 L2 短板补齐：开放接口）。
 * 任意支持 MCP 的客户端（如 dsh、Claude Code、Cline）均可接入：
 *
 *   {
 *     "mcpServers": {
 *       "liri-memory": {
 *         "command": "bun",
 *         "args": ["run", "app/src/entrypoints/mcp-memory.ts"]
 *       }
 *     }
 *   }
 *
 * 工具：
 *   - memory_write  写入一条长期记忆（持久化到记忆库）
 *   - memory_read   按 ID 读取记忆
 *   - memory_search 语义检索记忆（按相关性返回 top-N）
 */

import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryManagerImpl, MemoryType } from '@modules/memory';
import type { MemoryMetadata } from '@modules/memory/types/MemoryMetadata';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('mcp:memory');

/** 记忆 MCP 工具清单 */
const MEMORY_TOOLS: Tool[] = [
  {
    name: 'memory_write',
    description:
      '写入一条长期记忆（持久化到记忆库，供后续跨会话语义检索）。当用户要求你记住某事、或出现值得长期保留的事实/偏好时调用。',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '记忆内容' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '标签（可选）',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_read',
    description: '按 ID 读取一条记忆的完整内容。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '记忆 ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_search',
    description:
      '语义检索记忆，按相关性返回 top-N 结果。当历史信息可能相关时调用，用相关结果回答。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索查询' },
        limit: { type: 'number', description: '返回条数上限（默认 5）' },
      },
      required: ['query'],
    },
  },
];

/**
 * 启动记忆 MCP Server（stdio）。
 */
export async function startMemoryMCPServer(): Promise<void> {
  const memoryManager = new MemoryManagerImpl();

  const server = new McpServer(
    {
      name: 'Liri/memory',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: MEMORY_TOOLS,
    })
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      try {
        switch (name) {
          case 'memory_write': {
            const { content, tags } = (args ?? {}) as {
              content?: string;
              tags?: string[];
            };
            if (!content || typeof content !== 'string') {
              throw new Error('memory_write 需要字符串参数 content');
            }
            const now = new Date();
            const metadata: MemoryMetadata = {
              name: content.length > 40 ? `${content.slice(0, 40)}…` : content,
              description: 'MCP 写入的长期记忆',
              type: MemoryType.USER_FACT,
              createdAt: now,
              updatedAt: now,
              tags,
              source: 'mcp',
            };
            const memory = await memoryManager.createMemory({
              content,
              metadata,
            });
            return {
              content: [
                {
                  type: 'text',
                  text: `记忆写入成功: ${memory.id}`,
                },
              ],
            };
          }

          case 'memory_read': {
            const { id } = (args ?? {}) as { id?: string };
            if (!id) throw new Error('memory_read 需要参数 id');
            const memory = await memoryManager.getMemory(id);
            return {
              content: [
                {
                  type: 'text',
                  text: memory
                    ? JSON.stringify(memory, null, 2)
                    : `未找到记忆: ${id}`,
                },
              ],
            };
          }

          case 'memory_search': {
            const { query, limit } = (args ?? {}) as {
              query?: string;
              limit?: number;
            };
            if (!query || typeof query !== 'string') {
              throw new Error('memory_search 需要字符串参数 query');
            }
            const results = await memoryManager.getRelevantMemories(
              query,
              limit
            );
            return {
              content: [
                {
                  type: 'text',
                  text:
                    results.length === 0
                      ? '未找到相关记忆'
                      : JSON.stringify(results, null, 2),
                },
              ],
            };
          }

          default:
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `未知工具: ${name}`,
                },
              ],
            };
        }
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        logger.error('记忆 MCP 工具执行失败', { tool: name, error: e });
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: e.message,
            },
          ],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('Liri/memory MCP server 已启动（stdio）');
}

// 直接以脚本运行时启动（bun run app/src/entrypoints/mcp-memory.ts）
if (import.meta.main) {
  startMemoryMCPServer().catch((error: unknown) => {
    // eslint-disable-next-line no-console -- MCP server entrypoint，Logger 可能未初始化
    console.error('Liri/memory MCP Server 启动失败:', error);
    process.exit(1);
  });
}
