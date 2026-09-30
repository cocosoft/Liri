/**
 * ReadMcpResourceTool - 读取MCP服务器资源
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { z } from 'zod';
import { Text, Box } from '@modules/ink';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '@modules/utils/json.js';
import { ReadMcpResourceOutputSchema } from './schemas';

const READ_MCP_RESOURCE_TOOL_NAME = 'read_mcp_resource';

const DESCRIPTION = 'Read a specific MCP resource by URI';

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
      server: z.string().describe('The MCP server name'),
      uri: z.string().describe('The resource URI to read'),
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

  renderToolUseMessage() {
    return null;
  },

  renderToolResultMessage(
    { contents }: { contents: ResourceContent[] },
    _toolUseId: string
  ) {
    if (!contents || contents.length === 0) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="inactive">No content returned for this resource.</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">Resource Content:</Text>
        {contents.map((content: ResourceContent, index: number) => (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Text color="white">URI: {content.uri}</Text>
            {content.mimeType && (
              <Text color="inactive" dimColor>
                MIME Type: {content.mimeType}
              </Text>
            )}
            {content.blobSavedTo && (
              <Text color="yellow">
                Binary content saved to: {content.blobSavedTo}
              </Text>
            )}
            {content.text && (
              <Text color="white" wrap="wrap">
                {content.text}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    );
  },

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
