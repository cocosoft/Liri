/**
 * OAuth Authorization Code Flow (授权码流程)
 * 实现 RFC 6749 Section 4.1 + PKCE (RFC 7636)
 */

import { OAuthClient } from '../services/OAuthClient';
import type { TokenResponse } from '../services/OAuthClient';
import {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
} from '../utils/OAuthCrypto';
import type { OAuthConfig, OAuthAuthResult } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'oauth:flows:authCode', level: LogLevel.INFO });

export interface AuthorizationCodeFlowOptions {
  state?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  redirectUri?: string;
  scopes?: string[];
  additionalParams?: Record<string, string>;
}

export interface AuthorizationCodeFlowResult {
  authorizeUrl: string;
  state: string;
  codeVerifier: string;
}

export interface CallbackParseResult {
  code: string;
  state: string;
  error?: string;
  errorDescription?: string;
}

export class AuthorizationCodeFlow {
  private client: OAuthClient;
  private config: OAuthConfig;

  constructor(config: OAuthConfig, client?: OAuthClient) {
    this.config = config;
    this.client = client || new OAuthClient(config);
  }

  /**
   * 构建授权 URL
   * 生成 state 和 code_verifier/code_challenge (PKCE)
   */
  getAuthorizationUrl(
    options?: AuthorizationCodeFlowOptions
  ): AuthorizationCodeFlowResult {
    const state = options?.state || generateState();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const codeChallengeMethod = options?.codeChallengeMethod || 'S256';
    const redirectUri = options?.redirectUri || this.config.redirectUri || '';
    const scopes = options?.scopes || this.config.scopes;

    const url = new URL(this.config.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', codeChallengeMethod);
    if (scopes.length > 0) {
      url.searchParams.set('scope', scopes.join(' '));
    }
    if (options?.additionalParams) {
      for (const [key, value] of Object.entries(options.additionalParams)) {
        url.searchParams.set(key, value);
      }
    }

    return { authorizeUrl: url.toString(), state, codeVerifier };
  }

  /**
   * 解析回调 URL，提取授权码
   */
  parseCallback(callbackUrl: string): CallbackParseResult {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code') || '';
    const state = url.searchParams.get('state') || '';
    const error = url.searchParams.get('error') || undefined;
    const errorDescription =
      url.searchParams.get('error_description') || undefined;

    if (error) {
      logger.warn('OAuth callback returned error', { error, errorDescription });
      throw new OAuthError(
        `OAuth 授权错误: ${errorDescription || error}`,
        `OAUTH_${error.toUpperCase().replace(/\s+/g, '_')}`
      );
    }

    if (!code) {
      logger.warn('OAuth callback missing authorization code');
      throw new OAuthError('回调 URL 缺少授权码', 'OAUTH_NO_CODE');
    }

    return { code, state, error, errorDescription };
  }

  /**
   * 验证 state 参数，防止 CSRF
   */
  verifyState(expectedState: string, actualState: string): void {
    if (expectedState !== actualState) {
      logger.warn('OAuth state mismatch — possible CSRF', {
        expectedState: expectedState.slice(0, 8) + '...',
        actualState: actualState.slice(0, 8) + '...',
      });
      throw new OAuthError(
        'State 参数不匹配，可能存在 CSRF 攻击',
        'OAUTH_STATE_MISMATCH'
      );
    }
  }

  /**
   * 用授权码交换 Token
   */
  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri?: string
  ): Promise<OAuthAuthResult> {
    const raw = await this.client.exchangeCodeForTokens(
      this.config,
      code,
      codeVerifier,
      redirectUri || this.config.redirectUri || ''
    );

    return this.parseTokenResponse(raw);
  }

  /**
   * 解析 Token 响应
   */
  private parseTokenResponse(raw: TokenResponse): OAuthAuthResult {
    const accessToken = raw.access_token;
    if (!accessToken) {
      logger.error('Token response missing access_token');
      throw new OAuthError(
        'Token 响应缺少 access_token',
        'OAUTH_NO_ACCESS_TOKEN'
      );
    }

    const expiresIn = raw.expires_in || 3600;
    const refreshToken = raw.refresh_token || '';

    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: raw.token_type || 'Bearer',
      scopes: (raw.scope || '').split(' ').filter(Boolean),
    };
  }
}

export function createAuthorizationCodeFlow(
  config: OAuthConfig,
  client?: OAuthClient
): AuthorizationCodeFlow {
  return new AuthorizationCodeFlow(config, client);
}
