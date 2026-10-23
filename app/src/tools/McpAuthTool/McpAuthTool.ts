import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * McpAuthTool — MCP 认证管理（**未接线**；Q-18 处置仍为 `rewrite`）
 *
 * ⚠️ 2026-10-23（Q-18 复核）：修复前 `login` / `logout` / `refresh` 直接返回
 * `success:true` + `authenticated:true`，**没有调用任何认证实现** ⇒ 假成功（CS04）。
 * 真实 OAuth 能力在 `services/mcp/auth/MCPAuth.ts`（`mcpAuthManager`）：`initiateAuth` 需要
 * **已注册服务器**的 `oauth` 配置（authorizationEndpoint / tokenEndpoint / clientId / redirectUri），
 * 授权完成后由 HTTP 回调 `handleCallback` 落 token —— 工具面要承载它，须先定"oauth 配置来源"与
 * "浏览器授权如何与用户交互"。故本轮**只做如实收口**：不再伪造成功；接线（含 `MCP_OAUTH` 门控）
 * 待设计确定后单独变更。该工具当前不在生效面（`lint:shadow-tools` 登记 `rewrite`），不影响用户。
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:McpAuthTool:McpAuthTool');

/** 未接线时的统一失败文案（**不再伪造成功**） */
const NOT_WIRED_ERROR =
  'mcp_auth 尚未接线：真实实现须经 MCPAuthManager（initiateAuth → 浏览器授权 → handleCallback），' +
  '并受 FEATURE_MCP_OAUTH 门控。当前不执行任何认证动作，请改用 MCP 配置面完成授权。';

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
  name = TOOL_NAME_CONSTANTS.mcp_auth;

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

      // 未接线：不再伪造"登录成功/已登出/已刷新"（CS04）。
      logger.warn('mcp_auth 被调用但尚未接线', { action: params.action });
      return { success: false, error: NOT_WIRED_ERROR };
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
