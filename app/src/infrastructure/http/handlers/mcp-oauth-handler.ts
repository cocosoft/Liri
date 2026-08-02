/**
 * MCP OAuth 回调处理器
 *
 * 接收浏览器 OAuth 授权后的 redirect callback，解析 code/state 参数，
 * 通过 OAuth Discovery 获取服务器元数据后，委托 MCPAuthManager.handleCallback()
 * 完成 token 交换和持久化。
 *
 * 对标 hermes: mcp_oauth_manager.py 的 OAuth 回调处理
 */
import type http from 'http';
import { mcpAuthManager } from '@modules/services/mcp/auth/MCPAuth';
import type { MCPOAuthConfig } from '@modules/services/mcp/auth/types';
import type { McpOAuthConfig } from '@modules/services/mcp/types';
import { readMcpConfig } from '@modules/mcp';
import { configManager } from '@modules/config';

/**
 * 通过 OAuth Discovery 将 McpOAuthConfig 解析为 MCPOAuthConfig
 */
async function resolveOAuthConfig(
  oauth: McpOAuthConfig,
  callbackBase: string
): Promise<MCPOAuthConfig> {
  const { OAuthDiscovery } = await import('@modules/oauth');

  // 通过 authServerMetadataUrl 自动发现 OAuth 端点
  const discovery = new OAuthDiscovery();
  const metadata = oauth.authServerMetadataUrl
    ? await discovery.discoverMetadata(oauth.authServerMetadataUrl)
    : null;

  return {
    clientId: oauth.clientId || '',
    authUrl:
      metadata?.authorizationEndpoint || oauth.authServerMetadataUrl || '',
    tokenUrl:
      metadata?.tokenEndpoint ||
      oauth.authServerMetadataUrl?.replace(
        /\/\.well-known\/oauth-authorization-server$/,
        '/token'
      ) ||
      '',
    redirectUri: `${callbackBase}/v1/mcp/oauth/callback`,
  };
}

/**
 * 处理 MCP OAuth 回调请求
 * GET /v1/mcp/oauth/callback?server=<name>&code=<auth_code>&state=<state>
 */
export async function handleMCPOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const sendJson = (status: number, body: Record<string, unknown>) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    const parsedUrl = new URL(
      req.url!,
      `http://${req.headers.host || 'localhost'}`
    );

    const serverKey = parsedUrl.searchParams.get('server');
    const code = parsedUrl.searchParams.get('code');
    const state = parsedUrl.searchParams.get('state');

    if (!serverKey) {
      sendJson(400, { error: { message: 'Missing "server" query parameter' } });
      return;
    }

    if (!code) {
      sendJson(400, { error: { message: 'Missing "code" query parameter' } });
      return;
    }

    // 从 MCP 配置中读取该服务器的 OAuth 配置
    const configPath =
      configManager.env('MCP_CONFIG_PATH') || './mcp.config.json';
    const servers = readMcpConfig(configPath);
    const mcpConfig = servers[serverKey];
    if (!mcpConfig || !mcpConfig.oauth) {
      sendJson(404, {
        error: {
          message: `MCP server '${serverKey}' not found or has no OAuth config`,
        },
      });
      return;
    }

    // 通过 Discovery 解析 OAuth 端点
    const callbackBase = `http://127.0.0.1:${parsedUrl.port || '7890'}`;
    const oauthConfig = await resolveOAuthConfig(mcpConfig.oauth, callbackBase);

    const token = await mcpAuthManager.handleCallback(
      serverKey,
      code,
      state || '',
      oauthConfig
    );

    sendJson(200, {
      success: true,
      server: serverKey,
      expiresAt: token.expiresAt,
      scopes: token.scopes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(500, { error: { message } });
  }
}
