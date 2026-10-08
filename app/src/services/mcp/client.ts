/**
 * MCP客户端管理
 * 负责服务器连接、工具获取、错误处理等
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('services:mcp:client');
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
    // 2026-10-08（MCP 双轨收敛 C-1）：原为 `(client as any).tools.list()` —— 已装 SDK（^1.29.0）
    // 的 `Client` **没有 `.tools` 子对象**（只有顶层 `listTools()`）⇒ 该调用**必然抛
    // TypeError**，又被本函数的 `catch` 吞成 `[]` ⇒ **MCP 工具静默注册不上**。改用 SDK 顶层方法。
    const { tools: rawTools } = await client.listTools();
    const tools: SerializedTool[] = rawTools.map((tool) => ({
      name: tool.name,
      // SDK 的 `description` 可选，而 `SerializedTool.description` 必填 ⇒ 缺省补空串
      description: tool.description ?? '',
      inputJSONSchema: tool.inputSchema as SerializedTool['inputJSONSchema'],
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
    // 2026-10-08（C-1）：同 `fetchToolsForClient` —— 原 `(client as any).prompts.list()` 的
    // `.prompts` 子对象在 SDK ^1.29.0 不存在 ⇒ 恒抛且被吞成 `[]`。改用顶层 `listPrompts()`。
    const { prompts } = await client.listPrompts();
    return prompts.map(
      (prompt) =>
        ({
          name: prompt.name,
          description: prompt.description,
          inputSchema: (prompt as { arguments?: unknown }).arguments,
          execute: async () => {
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
    // 2026-10-08（C-1）：同族订正 —— 原 `(client as any).resources.list()` 的 `.resources`
    // 子对象在 SDK ^1.29.0 不存在 ⇒ 恒抛且被吞成 `[]`。改用顶层 `listResources()`。
    const { resources } = await client.listResources();
    return resources as unknown as ServerResource[];
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

    // 2026-10-08（**真实 MCP server e2e 抓出的 P0 阻断**）：SDK `Client` **没有** `.capabilities`
    // 属性 —— 原写法 `(client as unknown as { capabilities: { get() } }).capabilities.get()`
    // **每次**抛 `TypeError: undefined is not an object (evaluating 'client.capabilities.get')`，
    // 被下方 catch 吞成 `{ type:'failed' }` ⇒ `getSdkClient()` 恒 `undefined`
    // ⇒ `mcp_tool` / `mcp_resource` / `mcp://` VFS 全面失效，且因 `as unknown as` 断言**无编译错误**。
    // SDK 正确 API：`getServerCapabilities()`（`@modelcontextprotocol/sdk@1.29.0`
    // `dist/esm/client/index.d.ts:159` / `index.js:332`）。
    const capabilities = ((await client.getServerCapabilities()) ??
      {}) as ServerCapabilities;

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
