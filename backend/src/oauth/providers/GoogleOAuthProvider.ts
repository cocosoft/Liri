/**
 * Google OAuth Provider
 * 实现 Google OAuth 2.0 授权流程
 */

import { request as httpsRequest } from 'https';
import type {
  OAuthProvider,
  AuthorizeOptions,
  OAuthToken,
  UserInfo,
} from '../types/OAuthProvider';
import type { OAuthProviderConfig } from '../types/OAuthProvider';
import type { OAuthConfig } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';
import { AuthorizationCodeFlow } from '../flows/AuthorizationCodeFlow';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export class GoogleOAuthProvider implements OAuthProvider {
  id: string = 'google';
  name: string = 'Google';
  config: OAuthProviderConfig;
  private flow: AuthorizationCodeFlow;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes?: string[]
  ) {
    this.config = {
      authorizeUrl: GOOGLE_AUTHORIZE_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      profileUrl: GOOGLE_USERINFO_URL,
      clientId,
      clientSecret,
      redirectUri,
      scopes: scopes || ['openid', 'email', 'profile'],
    };

    const oauthConfig: OAuthConfig = {
      authorizeUrl: GOOGLE_AUTHORIZE_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      profileUrl: GOOGLE_USERINFO_URL,
      clientId,
      clientSecret,
      scopes: this.config.scopes,
      redirectUri,
    };

    this.flow = new AuthorizationCodeFlow(oauthConfig);
  }

  /**
   * 执行 Google OAuth 授权
   */
  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    const result = await this.flow.exchangeCode(
      options.code,
      options.codeVerifier,
      options.redirectUri || this.config.redirectUri
    );

    return result;
  }

  /**
   * 获取授权 URL
   */
  getAuthorizationUrl(options?: {
    state?: string;
    redirectUri?: string;
    scopes?: string[];
    accessType?: 'online' | 'offline';
    prompt?: 'none' | 'consent' | 'select_account';
  }): string {
    const additionalParams: Record<string, string> = {};

    if (options?.accessType) {
      additionalParams.access_type = options.accessType;
    }
    if (options?.prompt) {
      additionalParams.prompt = options.prompt;
    }

    const result = this.flow.getAuthorizationUrl({
      state: options?.state,
      redirectUri: options?.redirectUri || this.config.redirectUri,
      scopes: options?.scopes || this.config.scopes,
      additionalParams,
    });

    return result.authorizeUrl;
  }

  /**
   * 刷新 Google Token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    if (!refreshToken) {
      throw new OAuthError(
        '缺少 refresh_token，无法刷新',
        'OAUTH_NO_REFRESH_TOKEN'
      );
    }

    const requestBody: Record<string, unknown> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    };

    const raw = await this.httpPost(GOOGLE_TOKEN_URL, requestBody);

    const accessToken = raw.access_token as string;
    if (!accessToken) {
      throw new OAuthError('Google Token 刷新失败', 'OAUTH_REFRESH_FAILED');
    }

    const expiresIn = (raw.expires_in as number) || 3600;

    return {
      accessToken,
      refreshToken: refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: (raw.token_type as string) || 'Bearer',
      scopes: ((raw.scope as string) || '').split(' ').filter(Boolean),
    };
  }

  /**
   * 撤销 Google Token
   */
  async revokeToken(): Promise<void> {
    // Google 的 revoke 在 token 回收后也需要正常返回
    const requestBody = {
      token: '',
    };

    try {
      await this.httpPost(GOOGLE_REVOKE_URL, requestBody);
    } catch {
      // Google Revoke 端点可能返回 400，忽略
    }
  }

  /**
   * 获取 Google 用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const raw = await this.httpGet(GOOGLE_USERINFO_URL, {
      Authorization: `Bearer ${accessToken}`,
    });

    return {
      id: (raw.sub as string) || String(raw.id || ''),
      name: raw.name as string,
      email: raw.email as string,
      email_verified: raw.email_verified as boolean,
      picture: raw.picture as string,
      locale: raw.locale as string,
      family_name: raw.family_name as string,
      given_name: raw.given_name as string,
    };
  }

  /**
   * HTTP POST 请求
   */
  private httpPost(
    url: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const encodedBody = new URLSearchParams(
        Object.entries(body).map(([k, v]) => [k, String(v)])
      ).toString();
      const isHttps = parsedUrl.protocol === 'https:';

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(encodedBody).toString(),
        },
        timeout: 15000,
      };

      const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              const params = new URLSearchParams(data);
              const parsed: Record<string, unknown> = {};
              for (const [key, value] of params) {
                parsed[key] = value;
              }
              resolve(parsed);
            }
          } else {
            reject(
              new OAuthError(
                `Google API 错误 HTTP ${res.statusCode}: ${data.slice(0, 200)}`,
                'OAUTH_GOOGLE_API_ERROR',
                res.statusCode
              )
            );
          }
        });
      });

      req.on('error', (error) =>
        reject(
          new OAuthError(`请求失败: ${error.message}`, 'OAUTH_REQUEST_FAILED')
        )
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new OAuthError('请求超时', 'OAUTH_TIMEOUT'));
      });
      req.write(encodedBody);
      req.end();
    });
  }

  /**
   * HTTP GET 请求
   */
  private httpGet(
    url: string,
    headers: Record<string, string>
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          ...headers,
        },
        timeout: 15000,
      };

      const req = (isHttps ? httpsRequest : httpRequest)(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({ raw: data });
            }
          } else {
            reject(
              new OAuthError(
                `Google API 错误 HTTP ${res.statusCode}`,
                'OAUTH_GOOGLE_API_ERROR',
                res.statusCode
              )
            );
          }
        });
      });

      req.on('error', (error) =>
        reject(
          new OAuthError(`请求失败: ${error.message}`, 'OAUTH_REQUEST_FAILED')
        )
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new OAuthError('请求超时', 'OAUTH_TIMEOUT'));
      });
      req.end();
    });
  }
}

export function createGoogleOAuthProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes?: string[]
): GoogleOAuthProvider {
  return new GoogleOAuthProvider(clientId, clientSecret, redirectUri, scopes);
}
