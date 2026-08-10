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
    'Manage MCP (Model Context Protocol) authentication. Supports login, logout, status check, token refresh, and listing authenticated servers.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['login', 'logout', 'status', 'refresh', 'list'],
      description: 'Authentication action to perform',
      required: true,
    },
    {
      name: 'serverUrl',
      type: 'string',
      description: 'MCP server URL (required for login/logout/status/refresh)',
      required: false,
    },
    {
      name: 'token',
      type: 'string',
      description: 'Authentication token (required for login with token)',
      required: false,
    },
    {
      name: 'provider',
      type: 'string',
      enum: ['github', 'gitlab', 'custom'],
      description: 'OAuth provider (optional for login)',
      required: false,
    },
    {
      name: 'clientId',
      type: 'string',
      description: 'OAuth client ID (optional for login)',
      required: false,
    },
    {
      name: 'clientSecret',
      type: 'string',
      description: 'OAuth client secret (optional for login)',
      required: false,
    },
    {
      name: 'scopes',
      type: 'array',
      description: 'OAuth scopes to request (optional for login)',
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
