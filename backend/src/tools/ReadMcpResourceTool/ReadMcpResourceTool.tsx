/**
 * ReadMcpResourceTool - 读取MCP服务器资源
 */

import { z } from 'zod';
import { Text, Box } from 'ink';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '@modules/utils/json.js';

const READ_MCP_RESOURCE_TOOL_NAME = 'ReadMcpResource';

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

const mockClients: MCPClient[] = [];

/**
 * 获取MCP客户端
 */
function findMCPClient(name: string): MCPClient | undefined {
  return mockClients.find((client) => client.name === name);
}

/**
 * ReadMcpResourceTool
 */
export const ReadMcpResourceTool: Tool<{ server: string; uri: string }, Output> = buildTool({
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

  get outputSchema() {
    return z.object({
      contents: z.array(
        z.object({
          uri: z.string().describe('Resource URI'),
          mimeType: z.string().optional().describe('MIME type of the content'),
          text: z.string().optional().describe('Text content of the resource'),
          blobSavedTo: z.string().optional().describe('Path where binary blob content was saved'),
        })
      ),
    });
  },

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
    const client = (mcpClients as MCPClient[]).find((c) => c.name === serverName);

    if (!client) {
      throw new Error(
        `Server "${serverName}" not found. Available servers: ${(mcpClients as MCPClient[]).map((c) => c.name).join(', ')}`
      );
    }

    if (client.type !== 'connected') {
      throw new Error(`Server "${serverName}" is not connected`);
    }

    if (!client.capabilities?.resources) {
      throw new Error(`Server "${serverName}" does not support resources`);
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

  renderToolResultMessage({ contents }: { contents: ResourceContent[] }, _toolUseId: string) {
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
