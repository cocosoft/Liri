/**
 * ListMcpResourcesTool - 列出MCP资源
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { z } from 'zod';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '@modules/utils/json.js';
import { ListMcpResourcesOutputSchema } from './schemas';

const LIST_MCP_RESOURCES_TOOL_NAME = 'list_mcp_resources';

const DESCRIPTION = '列出已连接 MCP 服务器的资源';

const PROMPT = `
Use this tool to list available resources from connected MCP servers.

Usage:
- List all resources: {}
- Filter by server: { "server": "server-name" }

Resources provide read-only access to data from MCP servers.
`;

interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
  server: string;
}

interface MCPClient {
  name: string;
  type: 'connected' | 'disconnected';
}

/** 占位函数：后续接入真实 MCP 连接时替换为实际资源获取逻辑 */
async function fetchResourcesForClient(
  _client: MCPClient
): Promise<MCPResource[]> {
  return [];
}

/**
 * ListMcpResourcesTool
 */
export const ListMcpResourcesTool: Tool<{ server?: string }, MCPResource[]> =
  buildTool({
    name: LIST_MCP_RESOURCES_TOOL_NAME,
    searchHint: 'list resources from connected MCP servers',
    maxResultSizeChars: 100000,
    shouldDefer: true,

    description: DESCRIPTION,

    prompt() {
      return PROMPT;
    },

    get inputSchema() {
      return z.object({
        server: z
          .string()
          .optional()
          .describe('可选参数，按服务器名称过滤资源'),
      }) as any;
    },

    // 出参契约（P1-3 A 档；2026-09-29 **T6 批次 4a 归一化接线**）：
    // 原为**内联 getter**（与 `./schemas.ts` 的 `ListMcpResourcesOutputSchema` **逐字重复**）⇒ 改引该常量，
    // 消除"双份事实源"（CS01）。出口 `data` 是资源数组（`{ data: results.flat() }`）⇒ 与 schema 相符。
    outputSchema: ListMcpResourcesOutputSchema,

    userFacingName() {
      return 'listMcpResources';
    },

    isConcurrencySafe() {
      return true;
    },

    isReadOnly() {
      return true;
    },

    toAutoClassifierInput(input) {
      return input.server ?? '';
    },

    async call({ server: targetServer }, { options: { mcpClients = [] } }) {
      const typedClients = mcpClients as MCPClient[];
      const clientsToProcess = targetServer
        ? typedClients.filter((client) => client.name === targetServer)
        : typedClients;

      if (targetServer && clientsToProcess.length === 0) {
        throw new AppError(
          ErrorCodes.ENTITY_NOT_FOUND.message,
          ErrorCategory.VALIDATION,
          ErrorSeverity.MEDIUM,
          'MCP_SERVER_NOT_FOUND',
          {
            targetServer,
            availableServers: typedClients.map((c) => c.name),
          }
        );
      }

      const results = await Promise.all(
        clientsToProcess.map(async (client) => {
          if (client.type !== 'connected') {
            return [];
          }
          try {
            return await fetchResourcesForClient(client);
          } catch (error) {
            return [];
          }
        })
      );

      return {
        data: results.flat(),
      };
    },

    // 2026-10-01 子批 A（`app -> ui` 收口）：原此处内联 `renderToolUseMessage` /
    // `renderToolResultMessage`（用 `@modules/ink` 的 `Box`/`Text`）⇒ 构成
    // `tools`(app) -> `ink`(ui) 倒挂。**取证后删除**（CS01/CS05，零运行时行为变化）：
    // 渲染**唯一查找路径** = `components/ui/ChatMessage.tsx` 的 `getToolUI(toolName)`
    // （**仅查注册表**），而 `list_mcp_resources` **已在** `ToolUIRegistry` 注册
    // （来自 `toolUIs/MCPResourceTool/UI.tsx`）⇒ 本内联实现**恒被遮蔽、从不执行**；
    // 且工具实例自带 render 的回退路径（`getToolUIWithFallback`）**全仓零消费者**。

    mapToolResultToToolResultBlockParam(content, toolUseId) {
      if (!content || content.length === 0) {
        return {
          tool_use_id: toolUseId,
          type: 'tool_result',
          content:
            'No resources found. MCP servers may still provide tools even if they have no resources.',
        };
      }
      return {
        tool_use_id: toolUseId,
        type: 'tool_result',
        content: jsonStringify(content),
      };
    },
  });

export { LIST_MCP_RESOURCES_TOOL_NAME };
export type { MCPResource, MCPClient };
