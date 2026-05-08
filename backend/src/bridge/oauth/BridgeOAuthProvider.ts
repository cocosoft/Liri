//
/**
 * Bridge OAuth提供者
 * 实现统一的OAuthProvider接口
 */

import { OAuthProvider, OAuthProviderConfig, AuthorizeOptions, OAuthToken, UserInfo } from '@modules/oauth';
import { OAuthClient } from '@modules/oauth';

export class BridgeOAuthProvider implements OAuthProvider {
  id = 'bridge';
  name = 'Bridge';
  config: OAuthProviderConfig;
  private client: OAuthClient;

  constructor() {
    this.config = {
      authorizeUrl: process.env.BRIDGE_AUTH_URL || 'https://api.anthropic.com/oauth/authorize',
      tokenUrl: process.env.BRIDGE_TOKEN_URL || 'https://api.anthropic.com/oauth/token',
      profileUrl: process.env.BRIDGE_PROFILE_URL || 'https://api.anthropic.com/v1/me',
      clientId: process.env.BRIDGE_CLIENT_ID || '',
      clientSecret: process.env.BRIDGE_CLIENT_SECRET,
      redirectUri: process.env.BRIDGE_REDIRECT_URI || 'pyapp://oauth/callback',
      scopes: ['openid', 'profile', 'email'],
    };
    this.client = new OAuthClient({
      authorizeUrl: this.config.authorizeUrl,
      tokenUrl: this.config.tokenUrl,
      profileUrl: this.config.profileUrl,
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      scopes: this.config.scopes,
      redirectUri: this.config.redirectUri,
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
      tokenType: result.token_type as string || 'Bearer',
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
      tokenType: result.token_type as string || 'Bearer',
      scopes: (result.scope as string)?.split(' ') || this.config.scopes,
    };
  }

  /**
   * 撤销Token
   */
  async revokeToken(): Promise<void> {
    try {
      await this.client.revokeToken({ token: '' });
    } catch {
      // 忽略撤销失败
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const result = await this.client.getUserInfo(accessToken);
    return {
      id: result.sub as string || '',
      name: result.name as string || '',
      email: result.email as string || '',
      ...result,
    };
  }
}

// 全局单例
export const bridgeOAuthProvider = new BridgeOAuthProvider();