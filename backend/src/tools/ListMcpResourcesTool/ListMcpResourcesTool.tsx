// @ts-nocheck
/**
 * ListMcpResourcesTool - 列出MCP服务器资源
 */

import { z } from 'zod';
import { Text, Box } from '../../components/index.js';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '../../utils/json.js';

const LIST_MCP_RESOURCES_TOOL_NAME = 'ListMcpResources';

const DESCRIPTION = 'List resources from connected MCP servers';

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

const mockClients: MCPClient[] = [];

/**
 * 获取MCP客户端列表
 */
function getMCPClients(): MCPClient[] {
  return mockClients;
}

/**
 * 获取MCP资源
 */
async function fetchResourcesForClient(_client: MCPClient): Promise<MCPResource[]> {
  return [];
}

/**
 * ListMcpResourcesTool
 */
export const ListMcpResourcesTool: Tool<{ server?: string }, MCPResource[]> = buildTool({
  name: LIST_MCP_RESOURCES_TOOL_NAME,
  searchHint: 'list resources from connected MCP servers',
  maxResultSizeChars: 100000,
  shouldDefer: true,

  description() {
    return DESCRIPTION;
  },

  prompt() {
    return PROMPT;
  },

  get inputSchema() {
    return z.object({
      server: z.string().optional().describe('Optional server name to filter resources by'),
    });
  },

  get outputSchema() {
    return z.array(
      z.object({
        uri: z.string().describe('Resource URI'),
        name: z.string().describe('Resource name'),
        mimeType: z.string().optional().describe('MIME type of the resource'),
        description: z.string().optional().describe('Resource description'),
        server: z.string().describe('Server that provides this resource'),
      })
    );
  },

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

  async call({ server: targetServer }, { mcpClients = [] }) {
    const clientsToProcess = targetServer
      ? mcpClients.filter((client: MCPClient) => client.name === targetServer)
      : mcpClients;

    if (targetServer && clientsToProcess.length === 0) {
      throw new Error(
        `Server "${targetServer}" not found. Available servers: ${mcpClients.map((c: MCPClient) => c.name).join(', ')}`
      );
    }

    const results = await Promise.all(
      clientsToProcess.map(async (client: MCPClient) => {
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

  renderToolUseMessage() {
    return null;
  },

  renderToolResultMessage(output, _toolUseId) {
    if (!output || output.length === 0) {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="inactive">No resources found. MCP servers may still provide tools even if they have no resources.</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan">MCP Resources:</Text>
        {output.map((resource, index) => (
          <Box key={index} flexDirection="column" marginTop={1}>
            <Text color="white">
              • {resource.name} ({resource.server})
            </Text>
            <Text color="inactive" dimColor>
              URI: {resource.uri}
            </Text>
            {resource.description && (
              <Text color="inactive" dimColor>
                {resource.description}
              </Text>
            )}
          </Box>
        ))}
      </Box>
    );
  },

  mapToolResultToToolResultBlockParam(content, toolUseId) {
    if (!content || content.length === 0) {
      return {
        tool_use_id: toolUseId,
        type: 'tool_result',
        content: 'No resources found. MCP servers may still provide tools even if they have no resources.',
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
