/**
 * McpAuthTool — `mcp_auth`（Q-18 `rewrite` 接线，2026-10-23）
 *
 * **语义（与 CLI / HTTP 回调同一套认证实现）**
 * - `list`：列出已注册 MCP 服务器各自的 OAuth 配置状态与 token 状态；
 * - `status`：单个服务器的 OAuth 配置 / token 状态；
 * - `login`：经 `mcpAuthManager.initiateAuth()` 生成**授权 URL**（返回给用户自行在浏览器打开；
 *   授权完成后由本地服务 `/callback` 走 `handleCallback` 落 token）；
 * - `logout`：`revokeToken()`（远端撤销 + 删除内存与持久化 token）；
 * - `refresh`：`getAccessToken()`（有效则复用、过期则刷新）——**只回报是否有效，绝不回传 token**。
 *
 * **门控**：整体受 `MCP_OAUTH`（默认关）约束；关 ⇒ 明确失败，不做任何认证动作。
 *
 * **修复前的病根**（P4a §2.3 `needs-rewrite`）：`login` / `logout` / `refresh` 直接返回
 * `success:true`（`login` 还带 `authenticated:true`），没有调用任何认证实现 ⇒ 假能力（CS04）。
 */
import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { feature } from '@openliri/kernel';
import { getMCPServerManager } from '@modules/services/mcp/MCPServerManager.js';
import { mcpAuthManager } from '@modules/services/mcp/auth/MCPAuth.js';
import { deriveOAuthConfig } from '@modules/services/mcp/auth/deriveOAuthConfig.js';
import type { MCPServerConfig } from '@modules/services/mcp/types';
import type { MCPOAuthConfig } from '@modules/services/mcp/auth/types.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:McpAuthTool:McpAuthTool');

/** 服务器管理器的最小依赖面（测试可注入替身） */
export interface McpServerManagerLike {
  listServers(): string[];
  getServer(name: string): { getConfig(): MCPServerConfig } | undefined;
}

/** 认证管理器的最小依赖面（测试可注入替身） */
export interface McpAuthManagerLike {
  hasToken(serverKey: string): boolean;
  initiateAuth(
    config: MCPOAuthConfig
  ): Promise<{ authUrl: string; state: string }>;
  getAccessToken(serverKey: string, config: MCPOAuthConfig): Promise<string>;
  revokeToken(serverKey: string, config: MCPOAuthConfig): Promise<void>;
}

export interface McpAuthParams {
  action: 'status' | 'list' | 'login' | 'logout' | 'refresh';
  /** MCP 服务器名（`list` 之外均必填） */
  serverName?: string;
}

/** 单服务器 OAuth 状态投影（**不含** token / clientSecret） */
export interface McpAuthServerStatus {
  serverName: string;
  /** 是否具备可用的 OAuth 配置（缺 clientId / 无 URL ⇒ false） */
  oauthConfigured: boolean;
  /** 是否已持有 token（内存 + 启动时加载的持久化） */
  hasToken: boolean;
}

export class McpAuthTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.mcp_auth;

  description =
    'Manage OAuth authentication for registered MCP servers. Actions: list (per-server OAuth/token status), status (one server), login (returns an authorization URL for the user to open), logout (revoke tokens), refresh (ensure a valid token). Never returns tokens. Requires FEATURE_MCP_OAUTH.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['status', 'list', 'login', 'logout', 'refresh'],
      description:
        'Action to perform: list / status (serverName required) / login (serverName required) / logout (serverName required) / refresh (serverName required)',
      required: true,
    },
    {
      name: 'serverName',
      type: 'string',
      description:
        'Registered MCP server name (required for status/login/logout/refresh)',
      required: false,
    },
  ];

  /** U-03：模型可见出参结构 */
  override readonly outputJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string' },
      serverName: { type: 'string' },
      servers: { type: 'array', items: { type: 'object' } },
      total: { type: 'number' },
      oauthConfigured: { type: 'boolean' },
      hasToken: { type: 'boolean' },
      authUrl: { type: 'string' },
      state: { type: 'string' },
      tokenValid: { type: 'boolean' },
    },
  };

  constructor(
    private readonly deps: {
      manager?: McpServerManagerLike;
      auth?: McpAuthManagerLike;
    } = {}
  ) {
    super();
  }

  private getManager(): McpServerManagerLike {
    return this.deps.manager ?? getMCPServerManager();
  }

  private getAuth(): McpAuthManagerLike {
    return this.deps.auth ?? mcpAuthManager;
  }

  /** 取某服务器的 OAuth 配置（未注册 / 未配置 ⇒ `ok: false`） */
  private resolveOAuth(
    serverName: string
  ): { ok: true; oauth: MCPOAuthConfig } | { ok: false; message: string } {
    const conn = this.getManager().getServer(serverName);
    if (!conn) {
      return {
        ok: false,
        message: `MCP 服务器 "${serverName}" 未注册（可用 action=list 查看）`,
      };
    }
    const oauth = deriveOAuthConfig(conn.getConfig());
    if (!oauth) {
      return {
        ok: false,
        message: `MCP 服务器 "${serverName}" 未配置 OAuth（需 oauth.clientId 与可解析的服务器 URL / authServerMetadataUrl）`,
      };
    }
    return { ok: true, oauth };
  }

  private statusOf(serverName: string): McpAuthServerStatus {
    const conn = this.getManager().getServer(serverName);
    const oauth = conn ? deriveOAuthConfig(conn.getConfig()) : null;
    return {
      serverName,
      oauthConfigured: oauth !== null,
      hasToken: oauth ? this.getAuth().hasToken(serverName) : false,
    };
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    const params = input as unknown as McpAuthParams;
    if (!params.action || typeof params.action !== 'string') {
      return {
        success: false,
        error: 'action is required and must be a string',
      };
    }

    const validActions = ['status', 'list', 'login', 'logout', 'refresh'];
    if (!validActions.includes(params.action)) {
      return {
        success: false,
        error: `Invalid action "${params.action}". Must be one of: ${validActions.join(', ')}`,
      };
    }

    if (!feature('MCP_OAUTH')) {
      return {
        success: false,
        error:
          'mcp_auth 未启用：MCP OAuth 受 FEATURE_MCP_OAUTH 门控（默认关）。开启后重试。',
      };
    }

    try {
      switch (params.action) {
        case 'list':
          return this.list();
        case 'status':
          return this.status(params);
        case 'login':
          return await this.login(params);
        case 'logout':
          return await this.logout(params);
        case 'refresh':
          return await this.refresh(params);
        default:
          return {
            success: false,
            error: `Unhandled action: ${params.action}`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('mcp_auth 执行失败', {
        action: params.action,
        error: message,
      });
      return { success: false, error: `MCP auth tool failed: ${message}` };
    }
  }

  private list(): ToolResult {
    const names = this.getManager().listServers();
    const servers = names.map((name) => this.statusOf(name));
    const configured = servers.filter((s) => s.oauthConfigured).length;
    return {
      success: true,
      data: {
        action: 'list',
        servers,
        total: servers.length,
        oauthConfigured: configured,
      },
      output:
        servers.length === 0
          ? 'No MCP servers registered.'
          : `MCP servers: ${servers.length} (OAuth configured: ${configured})\n${servers
              .map(
                (s) =>
                  `  - ${s.serverName}: oauth=${s.oauthConfigured ? 'yes' : 'no'}, token=${s.hasToken ? 'yes' : 'no'}`
              )
              .join('\n')}`,
    };
  }

  private status(params: McpAuthParams): ToolResult {
    if (!params.serverName) {
      return { success: false, error: 'serverName is required for status' };
    }
    const view = this.statusOf(params.serverName);
    return {
      success: true,
      data: { action: 'status', ...view },
      output: `Server "${view.serverName}": oauth=${view.oauthConfigured ? 'configured' : 'not configured'}, token=${view.hasToken ? 'present' : 'absent'}.`,
    };
  }

  private async login(params: McpAuthParams): Promise<ToolResult> {
    if (!params.serverName) {
      return { success: false, error: 'serverName is required for login' };
    }
    const resolved = this.resolveOAuth(params.serverName);
    if (!resolved.ok) return { success: false, error: resolved.message };

    const { authUrl, state } = await this.getAuth().initiateAuth(
      resolved.oauth
    );
    logger.info('mcp_auth:login', { serverName: params.serverName });
    return {
      success: true,
      data: {
        action: 'login',
        serverName: params.serverName,
        authUrl,
        state,
        hasToken: false,
      },
      output: `请在浏览器打开以下地址完成授权（完成后 token 由本地回调写入，无需回传 code）：\n${authUrl}`,
    };
  }

  private async logout(params: McpAuthParams): Promise<ToolResult> {
    if (!params.serverName) {
      return { success: false, error: 'serverName is required for logout' };
    }
    const resolved = this.resolveOAuth(params.serverName);
    if (!resolved.ok) return { success: false, error: resolved.message };

    await this.getAuth().revokeToken(params.serverName, resolved.oauth);
    return {
      success: true,
      data: {
        action: 'logout',
        serverName: params.serverName,
        hasToken: this.getAuth().hasToken(params.serverName),
      },
      output: `Tokens revoked for MCP server "${params.serverName}".`,
    };
  }

  private async refresh(params: McpAuthParams): Promise<ToolResult> {
    if (!params.serverName) {
      return { success: false, error: 'serverName is required for refresh' };
    }
    const resolved = this.resolveOAuth(params.serverName);
    if (!resolved.ok) return { success: false, error: resolved.message };

    // 只用来确认"能拿到有效 token"；token 本身**不**回传（避免凭据进入模型上下文）
    await this.getAuth().getAccessToken(params.serverName, resolved.oauth);
    return {
      success: true,
      data: {
        action: 'refresh',
        serverName: params.serverName,
        tokenValid: true,
        hasToken: true,
      },
      output: `Token for MCP server "${params.serverName}" is valid (refreshed if expired).`,
    };
  }
}

export function createMcpAuthTool(): McpAuthTool {
  return new McpAuthTool();
}
