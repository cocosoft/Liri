/**
 * MCPTool
 * MCP系统的核心工具类，负责与MCP服务器通信并提供工具调用功能
 */

import type { Tool, ToolUseContext, ToolResult } from '../tools/types';
import { createToolResult } from '../tools/types/ToolResult';
import { MCPServerConfig, MCPToolDefinition } from './types';
import { getMCPServerManager } from '../services/mcp/MCPServerManager.js';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'mcp:MCPTool', level: LogLevel.INFO });

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
  name: 'MCPTool',
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
  userFacingName: function (input?: Partial<any>): string {
    const action = (input?.action as string) || '';
    const serverName = (input?.server_name as string) || '';
    const toolName = (input?.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'MCP: List Servers';
      case 'connect':
        return `MCP: Connect to ${input?.server_config?.name || 'Server'}`;
      case 'list_tools':
        return `MCP: List Tools from ${serverName}`;
      case 'call':
        return `MCP: Call ${toolName} on ${serverName}`;
      default:
        return this.name;
    }
  },
  getActivityDescription: function (input?: Partial<any>): string | null {
    const action = (input?.action as string) || '';
    const serverName = (input?.server_name as string) || '';
    const toolName = (input?.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'Listing MCP servers';
      case 'connect':
        return `Connecting to MCP server: ${input?.server_config?.name || 'Server'}`;
      case 'list_tools':
        return `Listing tools from MCP server: ${serverName}`;
      case 'call':
        return `Calling tool ${toolName} on MCP server: ${serverName}`;
      default:
        return null;
    }
  },
  getToolUseSummary: function (input?: Partial<any>): string | null {
    const action = (input?.action as string) || '';
    const serverName = (input?.server_name as string) || '';
    const toolName = (input?.tool_name as string) || '';

    switch (action) {
      case 'list_servers':
        return 'List MCP servers';
      case 'connect':
        return `Connect to MCP server: ${input?.server_config?.name || 'Server'}`;
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
              return createToolResult(null, {
                success: false,
                error: `Failed to connect to MCP server: ${connection.getError()}`,
              });
            }
          }

          return createToolResult(null, {
            success: false,
            error: 'Failed to create MCP server connection',
          });

        case 'list_tools':
          if (!server_name) {
            return createToolResult(null, {
              success: false,
              error: 'server_name is required for list_tools action',
            });
          }

          const server = mcpManager.getServer(server_name);

          if (!server) {
            return createToolResult(null, {
              success: false,
              error: `MCP server not found: ${server_name}`,
            });
          }

          const tools = await server.refreshTools();

          return createToolResult(
            {
              tools: tools.map((t: MCPToolDefinition) => ({
                name: t.name,
                description: t.description,
              })),
            },
            {
              success: true,
              output: `Available tools from ${server_name}:\n${tools.map((t: MCPToolDefinition) => `- ${t.name}: ${t.description}`).join('\n')}`,
            }
          );

        case 'call':
          if (!server_name || !tool_name) {
            return createToolResult(null, {
              success: false,
              error: 'server_name and tool_name are required for call action',
            });
          }

          const targetServer = mcpManager.getServer(server_name);

          if (!targetServer) {
            return createToolResult(null, {
              success: false,
              error: `MCP server not found: ${server_name}`,
            });
          }

          const result = await targetServer.callTool(
            tool_name,
            tool_args || {}
          );

          return createToolResult(result, {
            success: true,
            output: `Tool result:\n${JSON.stringify(result, null, 2)}`,
          });

        default:
          return createToolResult(null, {
            success: false,
            error: `Unknown action: ${action}`,
          });
      }
    } catch (error: any) {
      return createToolResult(null, {
        success: false,
        error: `MCP operation failed: ${error.message}`,
      });
    }
  },
};
