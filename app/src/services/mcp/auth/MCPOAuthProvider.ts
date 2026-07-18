/**
 * MCP OAuth提供者
 * 实现统一的OAuthProvider接口
 */

import {
  OAuthProvider,
  OAuthProviderConfig,
  AuthorizeOptions,
  OAuthToken,
  UserInfo,
} from '@modules/oauth';
import { OAuthClient } from '@modules/oauth';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'mcp:auth:oauthProvider', level: LogLevel.INFO });

export class MCPOAuthProvider implements OAuthProvider {
  id: string;
  name: string;
  config: OAuthProviderConfig;
  private client: OAuthClient;

  /**
   * 创建MCP OAuth提供者
   * @param serverId MCP服务器ID
   * @param config OAuth配置
   */
  constructor(serverId: string, config: OAuthProviderConfig) {
    this.id = `mcp:${serverId}`;
    this.name = `MCP Server ${serverId}`;
    this.config = config;
    this.client = new OAuthClient({
      authorizeUrl: config.authorizeUrl,
      tokenUrl: config.tokenUrl,
      profileUrl: config.profileUrl || '',
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      scopes: config.scopes,
      redirectUri: config.redirectUri,
    });
  }

  /**
   * 执行授权流程
   */
  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    const result = await this.client.exchangeCodeForToken({
      code: options.code,
      codeVerifier: options.codeVerifier,
      redirectUri: options.redirectUri || this.config.redirectUri,
    });

    return {
      accessToken: result.access_token as string,
      refreshToken: result.refresh_token as string,
      expiresAt: Date.now() + ((result.expires_in as number) || 3600) * 1000,
      tokenType: (result.token_type as string) || 'Bearer',
      scopes: (result.scope as string)?.split(' ') || this.config.scopes,
    };
  }

  /**
   * 刷新Token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    const result = await this.client.refreshToken({ refreshToken });

    return {
      accessToken: result.access_token as string,
      refreshToken: result.refresh_token as string,
      expiresAt: Date.now() + ((result.expires_in as number) || 3600) * 1000,
      tokenType: (result.token_type as string) || 'Bearer',
      scopes: (result.scope as string)?.split(' ') || this.config.scopes,
    };
  }

  /**
   * 撤销Token
   */
  async revokeToken(): Promise<void> {
    try {
      await this.client.revokeToken({ token: '' });
    } catch (err) {
      logger.warn('MCP OAuth token revocation failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    if (!this.config.profileUrl) {
      return {
        id: '',
        name: '',
        email: '',
      };
    }
    const result = await this.client.getUserInfo(accessToken);
    return {
      id: (result.sub as string) || '',
      name: (result.name as string) || '',
      email: (result.email as string) || '',
      ...result,
    };
  }
}

/**
 * 创建MCP OAuth提供者工厂函数
 */
export function createMCPOAuthProvider(
  serverId: string,
  config: OAuthProviderConfig
): MCPOAuthProvider {
  return new MCPOAuthProvider(serverId, config);
}
