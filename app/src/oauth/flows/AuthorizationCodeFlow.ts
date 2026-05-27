/**
 * OAuth Authorization Code Flow (授权码流程)
 * 实现 RFC 6749 Section 4.1 + PKCE (RFC 7636)
 */

import { OAuthClient } from '../services/OAuthClient';
import {
  generateState,
  generateCodeVerifier,
  generateCodeChallenge,
} from '../utils/OAuthCrypto';
import type { OAuthConfig, OAuthAuthResult } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';

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
      throw new OAuthError(
        `OAuth 授权错误: ${errorDescription || error}`,
        `OAUTH_${error.toUpperCase().replace(/\s+/g, '_')}`
      );
    }

    if (!code) {
      throw new OAuthError('回调 URL 缺少授权码', 'OAUTH_NO_CODE');
    }

    return { code, state, error, errorDescription };
  }

  /**
   * 验证 state 参数，防止 CSRF
   */
  verifyState(expectedState: string, actualState: string): void {
    if (expectedState !== actualState) {
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
   * 完整的一次性授权流程
   */
  async authorize(
    options?: AuthorizationCodeFlowOptions
  ): Promise<OAuthAuthResult> {
    const { authorizeUrl, state, codeVerifier } =
      this.getAuthorizationUrl(options);

    console.log(`请访问以下 URL 进行授权:\n${authorizeUrl}\n`);
    console.log('授权完成后，将回调 URL 粘贴到此处:');

    const callbackUrl = await this.readCallbackFromStdin();

    const parsed = this.parseCallback(callbackUrl);
    this.verifyState(state, parsed.state);

    return await this.exchangeCode(
      parsed.code,
      codeVerifier,
      options?.redirectUri
    );
  }

  /**
   * 从标准输入读取回调 URL
   */
  private async readCallbackFromStdin(): Promise<string> {
    return new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', (data: Buffer) => {
        process.stdin.pause();
        resolve(data.toString().trim());
      });
    });
  }

  /**
   * 解析 Token 响应
   */
  private parseTokenResponse(raw: Record<string, unknown>): OAuthAuthResult {
    const accessToken = raw.access_token as string;
    if (!accessToken) {
      throw new OAuthError(
        'Token 响应缺少 access_token',
        'OAUTH_NO_ACCESS_TOKEN'
      );
    }

    const expiresIn = (raw.expires_in as number) || 3600;
    const refreshToken = (raw.refresh_token as string) || '';

    return {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: (raw.token_type as string) || 'Bearer',
      scopes: ((raw.scope as string) || '').split(' ').filter(Boolean),
    };
  }
}

export function createAuthorizationCodeFlow(
  config: OAuthConfig,
  client?: OAuthClient
): AuthorizationCodeFlow {
  return new AuthorizationCodeFlow(config, client);
}
