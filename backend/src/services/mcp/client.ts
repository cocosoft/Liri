//
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
  SerializedTool
} from './types';
import type { Command } from '@modules/commands';

// 重连常量
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * 从MCP服务器获取工具
 */
export async function fetchToolsForClient(client: Client): Promise<SerializedTool[]> {
  try {
    const tools = await client.tools.list();
    return tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputJSONSchema: tool.inputSchema,
      isMcp: true,
      originalToolName: tool.name
    }));
  } catch (error) {
    logger.error('Failed to fetch tools:', error);
    return [];
  }
}

/**
 * 从MCP服务器获取命令
 */
export async function fetchCommandsForClient(client: Client): Promise<Command[]> {
  try {
    const prompts = await client.prompts.list();
    return prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description,
      inputSchema: prompt.inputSchema,
      execute: async (args: any) => {
        // 命令执行逻辑
        return { success: true, data: 'Command executed' };
      }
    }));
  } catch (error) {
    logger.error('Failed to fetch commands:', error);
    return [];
  }
}

/**
 * 从MCP服务器获取资源
 */
export async function fetchResourcesForClient(client: Client): Promise<ServerResource[]> {
  try {
    const resources = await client.resources.list();
    return resources;
  } catch (error) {
    logger.error('Failed to fetch resources:', error);
    return [];
  }
}

/**
 * 清理服务器缓存
 */
export async function clearServerCache(serverName: string, config: ScopedMcpServerConfig): Promise<void> {
  try {
    logger.info(`Clearing cache for server: ${serverName}`);
    // 实现缓存清理逻辑
  } catch (error) {
    logger.error('Failed to clear server cache:', error);
  }
}

/**
 * 重连MCP服务器
 */
export async function reconnectMcpServerImpl(
  serverName: string,
  config: ScopedMcpServerConfig
): Promise<{
  client: MCPServerConnection;
  tools: SerializedTool[];
  commands: Command[];
  resources?: ServerResource[];
}> {
  try {
    logger.info(`Reconnecting to MCP server: ${serverName}`);

    // 构建客户端选项
    const options: any = {
      url: config.url,
      headers: config.headers || {},
    };

    // 根据配置类型设置传输层
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
        throw new Error(`Unsupported transport type: ${config.type}`);
    }

    // 创建客户端
    const client = new Client(options);

    // 连接到服务器
    await client.connect();

    // 获取服务器能力
    const capabilities = await client.capabilities.get();

    // 获取工具、命令和资源
    const [tools, commands, resources] = await Promise.all([
      fetchToolsForClient(client),
      fetchCommandsForClient(client),
      fetchResourcesForClient(client)
    ]);

    // 构建连接对象
    const connectedClient: MCPServerConnection = {
      client,
      name: serverName,
      type: 'connected',
      capabilities,
      config,
      cleanup: async () => {
        try {
          await client.disconnect();
        } catch (error) {
          logger.error('Error during cleanup:', error);
        }
      }
    };

    return {
      client: connectedClient,
      tools,
      commands,
      resources
    };
  } catch (error) {
    logger.error(`Failed to reconnect to MCP server ${serverName}:`, error);
    
    return {
      client: {
        name: serverName,
        type: 'failed',
        config,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      tools: [],
      commands: []
    };
  }
}

/**
 * 获取MCP工具、命令和资源
 */
export async function getMcpToolsCommandsAndResources(
  onConnectionAttempt: (result: {
    client: MCPServerConnection;
    tools: SerializedTool[];
    commands: Command[];
    resources?: ServerResource[];
  }) => void,
  configs: Record<string, ScopedMcpServerConfig>
): Promise<void> {
  try {
    // 并行连接所有服务器
    const connectionPromises = Object.entries(configs).map(async ([name, config]) => {
      try {
        const result = await reconnectMcpServerImpl(name, config);
        onConnectionAttempt(result);
      } catch (error) {
        logger.error(`Failed to connect to MCP server ${name}:`, error);
        onConnectionAttempt({
          client: {
            name,
            type: 'failed',
            config,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          tools: [],
          commands: []
        });
      }
    });

    await Promise.all(connectionPromises);
  } catch (error) {
    logger.error('Error in getMcpToolsCommandsAndResources:', error);
  }
}