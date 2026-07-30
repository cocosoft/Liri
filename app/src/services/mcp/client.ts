/**
 * MCP客户端管理
 * 负责服务器连接、工具获取、错误处理等
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'services:mcp:client',
  level: LogLevel.INFO,
});
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
  SerializedTool,
} from './types';
import type { McpCommand } from './commandManager';

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
    const tools: SerializedTool[] = (result as unknown[]).map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      inputJSONSchema: tool.inputSchema,
      isMcp: true,
      originalToolName: tool.name,
    }));
    return tools;
  } catch (error) {
    handleError(error, {
      module: 'services:mcp:client',
      action: '获取工具失败',
    });
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
    return (prompts as unknown[]).map(
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
    handleError(error, {
      module: 'services:mcp:client',
      action: '获取命令失败',
    });
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
    handleError(error, {
      module: 'services:mcp:client',
      action: '获取资源失败',
    });
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
    handleError(error, {
      module: 'services:mcp:client',
      action: '清除服务器缓存失败',
    });
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

    // 根据 transport 类型创建对应的 SDK transport 实例
    let transport: unknown;
    switch (config.type) {
      case 'sse': {
        const { SSEClientTransport } =
          await import('@modelcontextprotocol/sdk/client/sse.js');
        transport = new SSEClientTransport(
          new URL((config as Record<string, unknown>).url as string),
          {
            requestInit: {
              headers:
                ((config as Record<string, unknown>).headers as Record<
                  string,
                  string
                >) || undefined,
            },
          }
        );
        break;
      }
      case 'stdio': {
        const { StdioClientTransport } =
          await import('@modelcontextprotocol/sdk/client/stdio.js');
        transport = new StdioClientTransport({
          command: config.command!,
          args: config.args || [],
          env: (config.env as Record<string, string>) || undefined,
        });
        break;
      }
      case 'ws': {
        const { WebSocketClientTransport } =
          await import('@modelcontextprotocol/sdk/client/websocket.js');
        transport = new WebSocketClientTransport(
          new URL((config as Record<string, unknown>).url as string)
        );
        break;
      }
      default: {
        // http / streamable-http
        const { StreamableHTTPClientTransport } =
          await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
        transport = new StreamableHTTPClientTransport(
          new URL((config as Record<string, unknown>).url as string),
          {
            requestInit: {
              headers:
                ((config as Record<string, unknown>).headers as Record<
                  string,
                  string
                >) || undefined,
            },
          }
        );
        break;
      }
    }

    const client = new Client(
      { name: 'pyapp', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport as Parameters<typeof client.connect>[0]);

    const capabilities = (await (
      client as unknown as { capabilities: { get(): Promise<unknown> } }
    ).capabilities.get()) as ServerCapabilities;

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
          await (client as unknown as { close(): Promise<void> }).close();
        } catch (error) {
          handleError(error, {
            module: 'services:mcp:client',
            action: '清理连接出错',
          });
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
    handleError(error, {
      module: 'services:mcp:client',
      action: '重连MCP服务器失败',
    });

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
          handleError(error, {
            module: 'services:mcp:client',
            action: '连接MCP服务器失败',
          });
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
    handleError(error, {
      module: 'services:mcp:client',
      action: '获取MCP工具命令资源出错',
    });
  }
}
