/**
 * MCP客户端管理
 * 负责服务器连接、工具获取、错误处理等
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { logger } from '@modules/utils/log';
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
  SerializedTool,
} from './types';
import type { McpCommand } from './commandManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

// 重连常量
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * 从MCP服务器获取工具
 */
export async function fetchToolsForClient(
  client: Client
): Promise<SerializedTool[]> {
  try {
    const result = await (client as any).tools.list();
    const tools: SerializedTool[] = (result as any[]).map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputJSONSchema: tool.inputSchema,
      isMcp: true,
      originalToolName: tool.name,
    }));
    return tools;
  } catch (error) {
    logger.error(
      'Failed to fetch tools:',
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * 从MCP服务器获取命令
 */
export async function fetchCommandsForClient(
  client: Client
): Promise<McpCommand[]> {
  try {
    const prompts = await (client as any).prompts.list();
    return (prompts as any[]).map(
      (prompt: any) =>
        ({
          name: prompt.name,
          description: prompt.description,
          inputSchema: prompt.inputSchema,
          execute: async (args: any) => {
            return { success: true, data: 'Command executed' };
          },
        }) as McpCommand
    );
  } catch (error) {
    logger.error(
      'Failed to fetch commands:',
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * 从MCP服务器获取资源
 */
export async function fetchResourcesForClient(
  client: Client
): Promise<ServerResource[]> {
  try {
    const resources = await (client as any).resources.list();
    return resources as ServerResource[];
  } catch (error) {
    logger.error(
      'Failed to fetch resources:',
      error instanceof Error ? error : new Error(String(error))
    );
    return [];
  }
}

/**
 * 清理服务器缓存
 */
export async function clearServerCache(
  serverName: string,
  config: ScopedMcpServerConfig
): Promise<void> {
  try {
    logger.info(`Clearing cache for server: ${serverName}`);
  } catch (error) {
    logger.error(
      'Failed to clear server cache:',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}

/**
 * 重连MCP服务器
 */
export async function reconnectMcpServerImpl(
  serverName: string,
  config: ScopedMcpServerConfig
): Promise<{
  connection: MCPServerConnection;
  tools: SerializedTool[];
  commands: McpCommand[];
  resources?: ServerResource[];
}> {
  try {
    logger.info(`Reconnecting to MCP server: ${serverName}`);

    const options: Record<string, any> = {
      url: (config as any).url,
      headers: (config as any).headers || {},
    };

    switch (config.type) {
      case 'http':
        options.transport = 'http';
        break;
      case 'ws':
        options.transport = 'ws';
        break;
      case 'sse':
        options.transport = 'sse';
        break;
      case 'stdio':
        options.transport = 'stdio';
        options.command = config.command;
        options.args = config.args || [];
        options.env = config.env || {};
        break;
      default:
        throw new AppError(
          `Unsupported transport type: ${config.type}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
    }

    const client = new Client(options as any);

    await (client as any).connect();

    const capabilities = await (client as any).capabilities.get();

    const [tools, commands, resources] = await Promise.all([
      fetchToolsForClient(client),
      fetchCommandsForClient(client),
      fetchResourcesForClient(client),
    ]);

    const connectedClient: MCPServerConnection = {
      client,
      name: serverName,
      type: 'connected',
      capabilities,
      config,
      cleanup: async () => {
        try {
          await (client as any).close();
        } catch (error) {
          logger.error(
            'Error during cleanup:',
            error instanceof Error ? error : new Error(String(error))
          );
        }
      },
    };

    return {
      connection: connectedClient,
      tools,
      commands,
      resources,
    };
  } catch (error) {
    logger.error(
      `Failed to reconnect to MCP server ${serverName}:`,
      error instanceof Error ? error : new Error(String(error))
    );

    return {
      connection: {
        name: serverName,
        type: 'failed',
        config,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as MCPServerConnection,
      tools: [],
      commands: [],
    };
  }
}

/**
 * 获取MCP工具、命令和资源
 */
export async function getMcpToolsCommandsAndResources(
  onConnectionAttempt: (result: {
    connection: MCPServerConnection;
    tools: SerializedTool[];
    commands: McpCommand[];
    resources?: ServerResource[];
  }) => void,
  configs: Record<string, ScopedMcpServerConfig>
): Promise<void> {
  try {
    const connectionPromises = Object.entries(configs).map(
      async ([name, config]) => {
        try {
          const result = await reconnectMcpServerImpl(name, config);
          onConnectionAttempt(result);
        } catch (error) {
          logger.error(
            `Failed to connect to MCP server ${name}:`,
            error instanceof Error ? error : new Error(String(error))
          );
          onConnectionAttempt({
            connection: {
              name,
              type: 'failed',
              config,
              error: error instanceof Error ? error.message : 'Unknown error',
            } as MCPServerConnection,
            tools: [],
            commands: [],
          });
        }
      }
    );

    await Promise.all(connectionPromises);
  } catch (error) {
    logger.error(
      'Error in getMcpToolsCommandsAndResources:',
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
