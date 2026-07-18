// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth Provider 公共基类
 *
 * 消除 GitHubOAuthProvider 和 GoogleOAuthProvider 之间 ~95% 的代码重复。
 * HTTP 调用统一委托给 OAuthClient，不再每个 Provider 自己实现 httpPost/httpGet。
 */

import type {
  OAuthProvider,
  AuthorizeOptions,
  OAuthToken,
  UserInfo,
} from '../types/OAuthProvider';
import type { OAuthProviderConfig } from '../types/OAuthProvider';
import { OAuthClient } from '../services/OAuthClient';
import { AuthorizationCodeFlow } from '../flows/AuthorizationCodeFlow';
import { OAuthError } from '../types/OAuthTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'oauth:providers:base', level: LogLevel.INFO });

export abstract class BaseOAuthProvider implements OAuthProvider {
  abstract id: string;
  abstract name: string;

  config: OAuthProviderConfig;
  protected flow: AuthorizationCodeFlow;
  protected client: OAuthClient;

  constructor(
    authorizeUrl: string,
    tokenUrl: string,
    profileUrl: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes: string[]
  ) {
    this.config = {
      authorizeUrl,
      tokenUrl,
      profileUrl,
      clientId,
      clientSecret,
      redirectUri,
      scopes,
    };

    this.client = new OAuthClient({
      authorizeUrl,
      tokenUrl,
      profileUrl,
      clientId,
      clientSecret,
      scopes,
      redirectUri,
    });
    this.flow = new AuthorizationCodeFlow({
      authorizeUrl,
      tokenUrl,
      profileUrl,
      clientId,
      clientSecret,
      scopes,
      redirectUri,
    });
  }

  /** 子类覆写：解析各平台特有的 UserInfo 格式 */
  protected abstract parseUserInfo(raw: Record<string, unknown>): UserInfo;

  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    return this.flow.exchangeCode(
      options.code,
      options.codeVerifier,
      options.redirectUri || this.config.redirectUri
    );
  }

  getAuthorizationUrl(options?: {
    state?: string;
    redirectUri?: string;
    scopes?: string[];
  }): string {
    return this.flow.getAuthorizationUrl(options).authorizeUrl;
  }

  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    if (!refreshToken) {
      logger.error('refreshToken called with empty token');
      throw new OAuthError('缺少 refresh_token', 'OAUTH_NO_REFRESH_TOKEN');
    }

    const raw = await this.client.refreshToken(
      {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret || '',
        authorizeUrl: this.config.authorizeUrl,
        tokenUrl: this.config.tokenUrl,
        profileUrl: this.config.profileUrl || '',
        scopes: this.config.scopes,
      },
      refreshToken
    );

    return {
      accessToken: raw.access_token,
      refreshToken: raw.refresh_token || refreshToken,
      expiresAt: Date.now() + (raw.expires_in || 3600) * 1000,
      tokenType: raw.token_type || 'Bearer',
      scopes: (raw.scope || '').split(/\s+/).filter(Boolean),
    };
  }

  async revokeToken(): Promise<void> {
    try {
      await this.client.revokeToken({
        token: '',
        tokenTypeHint: 'access_token',
      });
    } catch (err) {
      logger.warn('Token revocation failed (non-critical)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const raw = await this.client.getUserInfo(
      this.config.profileUrl || '',
      accessToken
    );
    return this.parseUserInfo(raw as unknown as Record<string, unknown>);
  }
}
