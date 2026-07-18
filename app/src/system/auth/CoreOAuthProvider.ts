//
/**
 * Core OAuth提供者
 * 实现统一的OAuthProvider接口
 */

import {
  OAuthProvider,
  OAuthProviderConfig,
  AuthorizeOptions,
  OAuthToken,
  UserInfo,
} from '@modules/oauth';
import { OAuthClient, OAuthConfig } from '@modules/oauth';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'system:auth:CoreOAuthProvider', level: LogLevel.INFO });

/**
 * Core OAuth提供者
 */
export class CoreOAuthProvider implements OAuthProvider {
  id = 'core';
  name = 'Core Auth';
  config: OAuthProviderConfig;
  private client: OAuthClient;

  constructor() {
    this.config = {
      authorizeUrl:
        configManager.env('OAUTH_AUTH_URL') ||
        'https://auth.openliri.com/oauth/authorize',
      tokenUrl:
        configManager.env('OAUTH_TOKEN_URL') ||
        'https://auth.openliri.com/oauth/token',
      profileUrl:
        configManager.env('OAUTH_PROFILE_URL') ||
        'https://auth.openliri.com/oauth/userinfo',
      clientId: (configManager.env('OAUTH_CLIENT_ID') || '') as string,
      clientSecret: (configManager.env('OAUTH_CLIENT_SECRET') || '') as string,
      redirectUri: (configManager.env('OAUTH_REDIRECT_URI') ||
        'pyapp://oauth/callback') as string,
      scopes: ['openid', 'profile', 'email', 'api'],
    };
    this.client = new OAuthClient({
      authorizeUrl: this.config.authorizeUrl,
      tokenUrl: this.config.tokenUrl,
      profileUrl: this.config.profileUrl!,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      scopes: this.config.scopes,
      redirectUri: this.config.redirectUri,
    } as OAuthConfig);
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

      // 忽略撤销失败

      logger.warn("Operation skipped", { context: "忽略撤销失败", error: err instanceof Error ? err.message : String(err) });

    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const result = await this.client.getUserInfo(accessToken);
    return {
      id: (result.sub as string) || '',
      name: (result.name as string) || '',
      email: (result.email as string) || '',
      ...result,
    };
  }
}

// 全局单例
export const coreOAuthProvider = new CoreOAuthProvider();
