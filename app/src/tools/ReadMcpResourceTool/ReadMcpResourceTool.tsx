/**
 * ReadMcpResourceTool - 读取MCP服务器资源
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { z } from 'zod';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '@modules/utils/json.js';
import { ReadMcpResourceOutputSchema } from './schemas';

const READ_MCP_RESOURCE_TOOL_NAME = 'read_mcp_resource';

const DESCRIPTION = '通过 URI 读取指定的 MCP 资源';

const PROMPT = `
Use this tool to read a specific resource from an MCP server.

Usage:
{
  "server": "server-name",
  "uri": "resource://path/to/resource"
}

The server must be a connected MCP server that supports resources.
`;

interface MCPClient {
  name: string;
  type: 'connected' | 'disconnected';
  capabilities?: {
    resources?: boolean;
  };
}

interface ResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blobSavedTo?: string;
}

interface Output {
  contents: ResourceContent[];
}

/**
 * ReadMcpResourceTool
 */
export const ReadMcpResourceTool: Tool<
  { server: string; uri: string },
  Output
> = buildTool({
  name: READ_MCP_RESOURCE_TOOL_NAME,
  searchHint: 'read a specific MCP resource by URI',
  maxResultSizeChars: 100000,
  shouldDefer: true,

  description: DESCRIPTION,

  prompt() {
    return PROMPT;
  },

  get inputSchema() {
    return z.object({
      server: z.string().describe('MCP 服务器名称'),
      uri: z.string().describe('要读取的资源 URI'),
    }) as any;
  },

  // 出参契约（P1-3 A 档；2026-09-29 **T6 批次 4a 归一化接线**）：
  // 原为**内联 getter**（与 `./schemas.ts` 的 `ReadMcpResourceOutputSchema` **逐字重复**）⇒ 改引该常量，
  // 消除"双份事实源"（CS01）。出口 `data` 为 `{ contents: [...] }` ⇒ 与 schema 相符。
  outputSchema: ReadMcpResourceOutputSchema,

  userFacingName() {
    return 'readMcpResource';
  },

  isConcurrencySafe() {
    return true;
  },

  isReadOnly() {
    return true;
  },

  toAutoClassifierInput(input) {
    return `${input.server} ${input.uri}`;
  },

  async call({ server: serverName, uri }, { options: { mcpClients = [] } }) {
    const client = (mcpClients as MCPClient[]).find(
      (c) => c.name === serverName
    );

    if (!client) {
      throw new AppError(
        ErrorCodes.ENTITY_NOT_FOUND.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MCP_SERVER_NOT_FOUND',
        { serverName }
      );
    }

    if (client.type !== 'connected') {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MCP_SERVER_NOT_CONNECTED',
        { serverName }
      );
    }

    if (!client.capabilities?.resources) {
      throw new AppError(
        ErrorCodes.INVALID_STATE.message,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM,
        'MCP_SERVER_NO_RESOURCES',
        { serverName }
      );
    }

    return {
      data: {
        contents: [
          {
            uri,
            text: `Content of ${uri} from ${serverName}`,
          },
        ],
      },
    };
  },

  // 2026-10-01 子批 A（`app -> ui` 收口）：原此处内联 `renderToolUseMessage` /
  // `renderToolResultMessage`（用 `@modules/ink` 的 `Box`/`Text`）⇒ 构成
  // `tools`(app) -> `ink`(ui) 倒挂。**取证后删除**（CS01/CS05，零运行时行为变化）：
  // 渲染**唯一查找路径** = `components/ui/ChatMessage.tsx` 的 `getToolUI(toolName)`
  // （**仅查注册表**），而 `read_mcp_resource` **已在** `ToolUIRegistry` 注册
  // （来自 `toolUIs/MCPResourceTool/UI.tsx`）⇒ 本内联实现**恒被遮蔽、从不执行**；
  // 且工具实例自带 render 的回退路径（`getToolUIWithFallback`）**全仓零消费者**。

  mapToolResultToToolResultBlockParam(content: Output, toolUseId: string) {
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: jsonStringify(content),
    };
  },
});

export { READ_MCP_RESOURCE_TOOL_NAME };
export type { MCPClient, ResourceContent, Output };
