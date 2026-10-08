/**
 * MCPTool
 * MCP系统的核心工具类，负责与MCP服务器通信并提供工具调用功能
 */

import type {
  Tool,
  ToolUseContext,
  ToolResult,
} from '@modules/utils/toolContract';
import { createToolResult } from '@modules/utils/toolContract';
import { MCPServerConfig } from './types';
import { getMCPServerManager } from '../services/mcp/MCPServerManager.js';
// 2026-10-08（MCP 双轨收敛 C-1）：`list_tools` / `call` 两个**IO 动作**改走**已连接的 SDK `Client`**
// —— 与 `mcp__*` 主路径同一条链；`list_servers` / `connect` 两个**状态动作**仍用 `MCPServerManager`
// （它们操作的是自研链的连接对象，属 C-3 范围，本轮不动）。
import { mcpConnectionManager } from '../services/mcp/MCPConnectionManager.js';
// 2026-10-01 B18-c：**删除** `import { toolScopeManager } from '../tool/ToolScopeManager'` ——
// 它构成 `mcp(service) -> tool(app)` 倒挂。改在唯一使用点（async `execute()` 内）**动态导入**。
import { configManager } from '@modules/config';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('mcp:MCPTool');

/** 自动审批白名单缓存 */
let _autoApproveCache: Map<string, string[]> | null = null;

/**
 * 获取自动审批白名单
 * 从配置 mcp_auto_approve 中读取，格式: { "server_name": ["tool1", "tool2"] }
 */
function getAutoApproveList(serverName: string): string[] {
  if (!_autoApproveCache) {
    try {
      const raw = configManager.env('MCP_AUTO_APPROVE');
      _autoApproveCache = new Map();
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string[]>;
        for (const [key, tools] of Object.entries(parsed)) {
          _autoApproveCache.set(
            key,
            tools.map((t) => t.toLowerCase())
          );
        }
      }
    } catch {
      _autoApproveCache = new Map();
    }
  }
  return _autoApproveCache.get(serverName) || [];
}

/**
 * MCPTool参数
 */
export interface MCPToolParams {
  /** 操作类型 */
  action: 'list_servers' | 'connect' | 'list_tools' | 'call';
  /** 服务器名称 */
  server_name?: string;
  /** 工具名称 */
  tool_name?: string;
  /** 工具参数 */
  tool_args?: Record<string, unknown>;
  /** 服务器配置 */
  server_config?: MCPServerConfig & { name: string };
}

/**
 * MCPTool
 */
export const MCPTool: Tool = {
  name: 'mcp_tool',
  description:
    'Connect to MCP (Model Context Protocol) servers and use external tools. Supports stdio, SSE, WebSocket, and HTTP transports.',
  params: [
    {
      name: 'action',
      type: 'string',
      description: '操作类型: list_servers, connect, list_tools, call',
      required: true,
      default: 'list_servers',
    },
    {
      name: 'server_name',
      type: 'string',
      description: '服务器名称',
      required: false,
      default: '',
    },
    {
      name: 'tool_name',
      type: 'string',
      description: '工具名称',
      required: false,
      default: '',
    },
    {
      name: 'tool_args',
      type: 'object',
      description: '工具参数',
      required: false,
      default: {},
    },
    {
      name: 'server_config',
      type: 'object',
      description: '服务器配置',
      required: false,
      default: {},
    },
  ],
  isEnabled: () => true,
  isReadOnly: () => false,
  isConcurrencySafe: () => true,
  getInfo: function () {
    return {
      name: this.name,
      description: this.description,
      params: this.params,
      aliases: [],
      searchTips: [],
      enabled: true,
      readOnly: false,
      destructive: false,
      concurrencySafe: true,
      deferred: false,
      alwaysLoad: false,
      interruptBehavior: 'block' as const,
      maxResultSizeChars: 10000,
    };
  },
  userFacingName: function (input?: Partial<Record<string, unknown>>): string {
    const inp = (input as Record<string, unknown>) ?? {};
    const action = (inp.action as string) || '';
    const serverName = (inp.server_name as string) || '';
    const toolName = (inp.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'MCP: List Servers';
      case 'connect':
        return `MCP: Connect to ${(inp.server_config as Record<string, unknown>)?.name || 'Server'}`;
      case 'list_tools':
        return `MCP: List Tools from ${serverName}`;
      case 'call':
        return `MCP: Call ${toolName} on ${serverName}`;
      default:
        return this.name;
    }
  },
  getActivityDescription: function (
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const inp = (input as Record<string, unknown>) ?? {};
    const action = (inp.action as string) || '';
    const serverName = (inp.server_name as string) || '';
    const toolName = (inp.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'Listing MCP servers';
      case 'connect':
        return `Connecting to MCP server: ${(inp.server_config as Record<string, unknown>)?.name || 'Server'}`;
      case 'list_tools':
        return `Listing tools from MCP server: ${serverName}`;
      case 'call':
        return `Calling tool ${toolName} on MCP server: ${serverName}`;
      default:
        return null;
    }
  },
  getToolUseSummary: function (
    input?: Partial<Record<string, unknown>>
  ): string | null {
    const inp = (input as Record<string, unknown>) ?? {};
    const action = (inp.action as string) || '';
    const serverName = (inp.server_name as string) || '';
    const toolName = (inp.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'List MCP servers';
      case 'connect':
        return `Connect to MCP server: ${(inp.server_config as Record<string, unknown>)?.name || 'Server'}`;
      case 'list_tools':
        return `List tools from MCP server: ${serverName}`;
      case 'call':
        return `Call tool ${toolName} on MCP server: ${serverName}`;
      default:
        return null;
    }
  },
  async execute(
    args: MCPToolParams,
    context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const { action, server_name, tool_name, tool_args, server_config } = args;
      const mcpManager = getMCPServerManager();

      switch (action) {
        case 'list_servers':
          const servers = mcpManager.listServers();
          return createToolResult(
            {
              servers,
              message:
                servers.length > 0
                  ? `Available MCP servers: ${servers.join(', ')}`
                  : 'No MCP servers configured',
            },
            {
              output:
                servers.length > 0
                  ? `Available MCP servers:\n${servers.join('\n')}`
                  : 'No MCP servers configured',
              success: true,
            }
          );

        case 'connect':
          if (!server_config) {
            return createToolResult(null, {
              success: false,
              error: 'server_config is required for connect action',
            });
          }

          mcpManager.addServer(server_config.name, server_config);
          const connection = mcpManager.getServer(server_config.name);

          if (connection) {
            const connected = await connection.connect();
            if (connected) {
              // T1.4-MCP（§3.1 关联点1/4）：MCP 连接是长生命周期副作用（跨工具调用复用），
              // 登记到会话级 scope，会话销毁时断开连接（防泄漏）；
              // 进程级兜底由 ChildProcessTracker（stdio 两阶段终止）承担，二者共存。
              if (context.sessionId) {
                // 2026-10-01 B18-c：`toolScopeManager`（`tool` 模块，app 层）原为**静态**导入，
                // 构成 `mcp(service) -> tool(app)` 倒挂。本处位于 **async** `execute()` 内 ⇒
                // 改**方法内动态导入**（同 F 尾批 `runtime -> agent` 手法）：静态边消失，
                // 仅余「动态跨层引用」（R00-003 上报，可见不隐藏），并附懒加载收益。
                const { toolScopeManager } =
                  await import('../tool/ToolScopeManager');
                toolScopeManager
                  .getSessionScope(context.sessionId)
                  .onDispose(() => {
                    try {
                      connection.disconnect();
                    } catch {
                      // @ignore-catch — 断开失败由进程级兜底兜住，不阻断 scope 释放
                    }
                  });
              }
              return createToolResult(
                {
                  server: server_config.name,
                  connected: true,
                },
                {
                  success: true,
                  output: `Connected to MCP server: ${server_config.name}`,
                }
              );
            } else {
              // P2-4: 凭据剥离
              const { stripCredentials } =
                await import('../services/mcp/MCPSecurityFilter');
              const connErr = stripCredentials(
                connection.getError() || 'unknown'
              ).cleaned;
              return createToolResult(null, {
                success: false,
                error: `Failed to connect to MCP server: ${connErr}`,
              });
            }
          }

          return createToolResult(null, {
            success: false,
            error: 'Failed to create MCP server connection',
          });

        case 'list_tools': {
          if (!server_name) {
            return createToolResult(null, {
              success: false,
              error: 'server_name is required for list_tools action',
            });
          }

          // C-1：改走 SDK（原 `mcpManager.getServer(...).refreshTools()` 走自研链）
          const sdk = mcpConnectionManager.getSdkClient(server_name);
          if (!sdk) {
            return createToolResult(null, {
              success: false,
              error: `MCP server not connected: ${server_name}`,
            });
          }

          const { tools } = await sdk.listTools();

          return createToolResult(
            {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
              })),
            },
            {
              success: true,
              output: `Available tools from ${server_name}:\n${tools.map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n')}`,
            }
          );
        }

        case 'call': {
          if (!server_name || !tool_name) {
            return createToolResult(null, {
              success: false,
              error: 'server_name and tool_name are required for call action',
            });
          }

          // C-1：改走 SDK（原 `mcpManager.getServer(...).callTool()` 走自研链）
          const sdk = mcpConnectionManager.getSdkClient(server_name);
          if (!sdk) {
            return createToolResult(null, {
              success: false,
              error: `MCP server not connected: ${server_name}`,
            });
          }

          const result = await sdk.callTool({
            name: tool_name,
            arguments: tool_args || {},
          });

          // SDK 结果自带 `isError` ⇒ 如实承载到 ToolResult（失败信息进 `error` 供前端展示）
          return createToolResult(
            result,
            result.isError
              ? {
                  success: false,
                  error: `MCP tool "${tool_name}" reported an error: ${JSON.stringify(result.content ?? result)}`,
                }
              : {
                  success: true,
                  output: `Tool result:\n${JSON.stringify(result.content ?? result, null, 2)}`,
                }
          );
        }

        default:
          return createToolResult(null, {
            success: false,
            error: `Unknown action: ${action}`,
          });
      }
    } catch (error: unknown) {
      // P2-4: 凭据剥离
      const { stripCredentials } =
        await import('../services/mcp/MCPSecurityFilter');
      const cleaned = stripCredentials(
        (error as Error).message || String(error)
      ).cleaned;
      return createToolResult(null, {
        success: false,
        error: `MCP operation failed: ${cleaned}`,
      });
    }
  },
};
