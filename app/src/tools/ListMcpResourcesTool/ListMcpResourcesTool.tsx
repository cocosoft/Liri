/**
 * ListMcpResourcesTool - 列出MCP资源
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { ErrorCodes } from '@modules/error';
import { z } from 'zod';
import { Text, Box } from 'ink';
import type { Tool } from '../types/index.js';
import { buildTool, type ToolDef } from '../BaseTool.js';
import { jsonStringify } from '@modules/utils/json.js';

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
          .describe('Optional server name to filter resources by'),
      }) as any;
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

    renderToolUseMessage() {
      return null;
    },

    renderToolResultMessage(output: MCPResource[], _toolUseId: string) {
      if (!output || output.length === 0) {
        return (
          <Box flexDirection="column" marginTop={1}>
            <Text color="inactive">
              No resources found. MCP servers may still provide tools even if
              they have no resources.
            </Text>
          </Box>
        );
      }

      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">MCP Resources:</Text>
          {output.map((resource: MCPResource, index: number) => (
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
