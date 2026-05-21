/**
 * GitHub OAuth Provider
 * 实现 GitHub OAuth 2.0 授权流程
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
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

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_REVOKE_URL = 'https://api.github.com/applications';

export class GitHubOAuthProvider implements OAuthProvider {
  id: string = 'github';
  name: string = 'GitHub';
  config: OAuthProviderConfig;
  private flow: AuthorizationCodeFlow;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes?: string[]
  ) {
    this.config = {
      authorizeUrl: GITHUB_AUTHORIZE_URL,
      tokenUrl: GITHUB_TOKEN_URL,
      profileUrl: `${GITHUB_API_URL}/user`,
      clientId,
      clientSecret,
      redirectUri,
      scopes: scopes || ['read:user', 'user:email'],
    };

    const oauthConfig: OAuthConfig = {
      authorizeUrl: GITHUB_AUTHORIZE_URL,
      tokenUrl: GITHUB_TOKEN_URL,
      profileUrl: `${GITHUB_API_URL}/user`,
      clientId,
      clientSecret,
      scopes: this.config.scopes,
      redirectUri,
    };

    this.flow = new AuthorizationCodeFlow(oauthConfig);
  }

  /**
   * 执行 GitHub OAuth 授权
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
  }): string {
    const result = this.flow.getAuthorizationUrl({
      state: options?.state,
      redirectUri: options?.redirectUri,
      scopes: options?.scopes,
    });

    return result.authorizeUrl;
  }

  /**
   * 刷新 GitHub Token
   * GitHub 目前不支持 refresh_token（除非是 GitHub App），
   * 返回的 refresh_token 为空时需重新授权
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    if (!refreshToken) {
      throw new OAuthError(
        'GitHub 不支持 refresh_token，请重新授权',
        'OAUTH_REFRESH_NOT_SUPPORTED'
      );
    }

    const requestBody: Record<string, unknown> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    };

    const raw = await this.httpPost(GITHUB_TOKEN_URL, requestBody);

    const accessToken = raw.access_token as string;
    if (!accessToken) {
      throw new OAuthError('GitHub Token 刷新失败', 'OAUTH_REFRESH_FAILED');
    }

    const expiresIn = (raw.expires_in as number) || 28800;

    return {
      accessToken,
      refreshToken: (raw.refresh_token as string) || '',
      expiresAt: Date.now() + expiresIn * 1000,
      tokenType: (raw.token_type as string) || 'Bearer',
      scopes: ((raw.scope as string) || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  /**
   * 撤销 GitHub Token
   */
  async revokeToken(): Promise<void> {
    const requestBody = {
      access_token: '',
    };

    await this.httpPost(GITHUB_REVOKE_URL, requestBody);
  }

  /**
   * 获取 GitHub 用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    const raw = await this.httpGet(`${GITHUB_API_URL}/user`, {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'PY_APP',
      Accept: 'application/vnd.github.v3+json',
    });

    let email = raw.email as string;
    if (!email) {
      const emails = await this.httpGet(`${GITHUB_API_URL}/user/emails`, {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'PY_APP',
        Accept: 'application/vnd.github.v3+json',
      });

      const primaryEmail = (Array.isArray(emails) ? emails : []).find(
        (e: Record<string, unknown>) => e.primary === true
      );
      email = (primaryEmail?.email as string) || '';
    }

    return {
      id: String(raw.id || ''),
      name: raw.name as string,
      email,
      login: raw.login as string,
      avatar_url: raw.avatar_url as string,
      html_url: raw.html_url as string,
      bio: raw.bio as string,
      public_repos: raw.public_repos as number,
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
      const encodedBody = JSON.stringify(body);
      const isHttps = parsedUrl.protocol === 'https:';

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(encodedBody).toString(),
          Accept: 'application/json',
        },
        timeout: 15000,
      };

      const req = (isHttps ? httpsRequest : httpRequest)(
        options,
        (res: import('http').IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString();

            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
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
                  `GitHub API 错误 HTTP ${res.statusCode}`,
                  'OAUTH_GITHUB_API_ERROR',
                  res.statusCode
                )
              );
            }
          });
        }
      );

      req.on('error', (error: Error) =>
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

      const req = (isHttps ? httpsRequest : httpRequest)(
        options,
        (res: import('http').IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const data = Buffer.concat(chunks).toString();

            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 300
            ) {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve({ raw: data });
              }
            } else {
              reject(
                new OAuthError(
                  `GitHub API 错误 HTTP ${res.statusCode}`,
                  'OAUTH_GITHUB_API_ERROR',
                  res.statusCode
                )
              );
            }
          });
        }
      );

      req.on('error', (error: Error) =>
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

export function createGitHubOAuthProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes?: string[]
): GitHubOAuthProvider {
  return new GitHubOAuthProvider(clientId, clientSecret, redirectUri, scopes);
}
