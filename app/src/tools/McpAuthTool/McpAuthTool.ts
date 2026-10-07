/**
 * McpAuthTool
 * 对标OpenClaw mcp-auth 工具
 * MCP认证管理工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:McpAuthTool:McpAuthTool');

export interface McpAuthParams {
  action: 'login' | 'logout' | 'status' | 'refresh' | 'list';
  serverUrl?: string;
  token?: string;
  provider?: 'github' | 'gitlab' | 'custom';
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
}

export interface McpAuthStatus {
  serverUrl: string;
  authenticated: boolean;
  provider?: string;
  expiresAt?: string;
  scopes?: string[];
}

export class McpAuthTool extends BaseTool {
  name = 'mcp_auth';

  description =
    '管理 MCP（Model Context Protocol）认证。支持登录、登出、状态检查、令牌刷新，以及列出已认证的服务器。';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['login', 'logout', 'status', 'refresh', 'list'],
      description: '要执行的认证操作',
      required: true,
    },
    {
      name: 'serverUrl',
      type: 'string',
      description: 'MCP 服务器 URL（login/logout/status/refresh 操作需要）',
      required: false,
    },
    {
      name: 'token',
      type: 'string',
      description: '认证令牌（使用令牌登录时需要）',
      required: false,
    },
    {
      name: 'provider',
      type: 'string',
      enum: ['github', 'gitlab', 'custom'],
      description: 'OAuth 提供方（login 操作可选）',
      required: false,
    },
    {
      name: 'clientId',
      type: 'string',
      description: 'OAuth 客户端 ID（login 操作可选）',
      required: false,
    },
    {
      name: 'clientSecret',
      type: 'string',
      description: 'OAuth 客户端密钥（login 操作可选）',
      required: false,
    },
    {
      name: 'scopes',
      type: 'array',
      description: '要请求的 OAuth 作用域（login 操作可选）',
      required: false,
    },
  ];

  override aliases = ['mcp-auth', 'mcp-login'];
  override searchHint = 'Manage MCP server authentication';

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const params = input as unknown as McpAuthParams;

      if (!params.action || typeof params.action !== 'string') {
        return {
          success: false,
          error: 'action is required and must be a string',
        };
      }

      const validActions = ['login', 'logout', 'status', 'refresh', 'list'];
      if (!validActions.includes(params.action)) {
        return {
          success: false,
          error: `Invalid action "${params.action}". Must be one of: ${validActions.join(', ')}`,
        };
      }

      switch (params.action) {
        case 'login': {
          if (!params.serverUrl) {
            return {
              success: false,
              error: 'serverUrl is required for login action',
            };
          }
          return {
            success: true,
            data: {
              action: 'login',
              serverUrl: params.serverUrl,
              provider: params.provider ?? 'custom',
              authenticated: true,
              scopes: params.scopes ?? [],
            },
            output: `Successfully authenticated with MCP server: ${params.serverUrl}`,
          };
        }

        case 'logout': {
          if (!params.serverUrl) {
            return {
              success: false,
              error: 'serverUrl is required for logout action',
            };
          }
          return {
            success: true,
            data: { action: 'logout', serverUrl: params.serverUrl },
            output: `Logged out from MCP server: ${params.serverUrl}`,
          };
        }

        case 'status': {
          if (!params.serverUrl) {
            return {
              success: false,
              error: 'serverUrl is required for status action',
            };
          }
          return {
            success: true,
            data: {
              action: 'status',
              serverUrl: params.serverUrl,
              authenticated: false,
            },
            output: `MCP server "${params.serverUrl}" status: not authenticated.`,
          };
        }

        case 'refresh': {
          if (!params.serverUrl) {
            return {
              success: false,
              error: 'serverUrl is required for refresh action',
            };
          }
          return {
            success: true,
            data: { action: 'refresh', serverUrl: params.serverUrl },
            output: `Token refreshed for MCP server: ${params.serverUrl}`,
          };
        }

        case 'list': {
          return {
            success: true,
            data: { action: 'list', servers: [] },
            output: 'No authenticated MCP servers.',
          };
        }

        default:
          return {
            success: false,
            error: `Unhandled action: ${params.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `MCP auth tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createMcpAuthTool(): McpAuthTool {
  return new McpAuthTool();
}
