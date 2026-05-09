//
/**
 * OAuth HTTP客户端
 * 提供OAuth协议通信功能
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { logger } from '@modules/infrastructure';
import type { OAuthConfig } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';

/**
 * 授权码交换参数
 */
export interface ExchangeCodeParams {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
  redirectUrl?: string;
}

/**
 * 刷新Token参数
 */
export interface RefreshTokenParams {
  refreshToken: string;
  scopes?: string[];
}

/**
 * 撤销Token参数
 */
export interface RevokeTokenParams {
  token: string;
  tokenTypeHint?: string;
}

/**
 * OAuth HTTP客户端
 */
export class OAuthClient {
  private defaultTimeout: number;
  private config?: OAuthConfig;

  /**
   * 创建OAuth客户端
   * @param config 可选的默认配置
   * @param timeout 超时时间（毫秒）
   */
  constructor(config?: OAuthConfig, timeout: number = 15000) {
    this.config = config;
    this.defaultTimeout = timeout;
  }

  /**
   * 生成授权URL
   * @param params 授权请求参数
   * @returns 完整的授权URL
   */
  getAuthorizationUrl(params: {
    state: string;
    codeChallenge: string;
    redirectUrl?: string;
    scopes?: string[];
  }): string {
    const config = this.config;
    if (!config) {
      throw new OAuthError('OAuthClient not configured', 'NO_CONFIG');
    }
    const url = new URL(config.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (params.redirectUrl) {
      url.searchParams.set('redirect_uri', params.redirectUrl);
    } else if (config.redirectUri) {
      url.searchParams.set('redirect_uri', config.redirectUri);
    }
    const scopes = params.scopes || config.scopes;
    if (scopes && scopes.length > 0) {
      url.searchParams.set('scope', scopes.join(' '));
    }
    return url.toString();
  }

  /**
   * 交换授权码获取Token（新API - 对象参数方式）
   */
  async exchangeCodeForToken(params: ExchangeCodeParams): Promise<Record<string, unknown>> {
    if (!this.config) {
      throw new OAuthError('OAuthClient not configured', 'NO_CONFIG');
    }
    
    return this.exchangeCodeForTokens(
      this.config,
      params.code,
      params.codeVerifier,
      params.redirectUri || params.redirectUrl || ''
    );
  }

  /**
   * 交换授权码获取Token（旧API - 兼容模式）
   */
  async exchangeCodeForTokens(
    config: OAuthConfig,
    authorizationCode: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<Record<string, unknown>> {
    const requestBody = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      code_verifier: codeVerifier,
    };

    if (config.clientSecret) {
      (requestBody as Record<string, unknown>).client_secret = config.clientSecret;
    }

    logger.debug(`Exchanging authorization code for tokens at ${config.tokenUrl}`);
    return await this.httpPostJson(config.tokenUrl, requestBody);
  }

  /**
   * 刷新Token
   */
  async refreshToken(
    configOrParams: OAuthConfig | RefreshTokenParams,
    refreshToken?: string,
    scopes?: string[]
  ): Promise<Record<string, unknown>> {
    // 新API方式
    if ('refreshToken' in configOrParams) {
      if (!this.config) {
        throw new OAuthError('OAuthClient not configured', 'NO_CONFIG');
      }
      const config = this.config;
      const params = configOrParams;
      const requestBody: Record<string, unknown> = {
        grant_type: 'refresh_token',
        refresh_token: params.refreshToken,
        client_id: config.clientId,
      };

      if (params.scopes && params.scopes.length > 0) {
        requestBody.scope = params.scopes.join(' ');
      }

      if (config.clientSecret) {
        requestBody.client_secret = config.clientSecret;
      }

      logger.debug(`Refreshing token at ${config.tokenUrl}`);
      return await this.httpPostJson(config.tokenUrl, requestBody);
    }
    
    // 旧API方式
    const config = configOrParams;
    const requestBody: Record<string, unknown> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken!,
      client_id: config.clientId,
    };

    if (scopes && scopes.length > 0) {
      requestBody.scope = scopes.join(' ');
    }

    if (config.clientSecret) {
      requestBody.client_secret = config.clientSecret;
    }

    logger.debug(`Refreshing token at ${config.tokenUrl}`);
    return await this.httpPostJson(config.tokenUrl, requestBody);
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(
    userinfoUrlOrAccessToken: string,
    accessToken?: string
  ): Promise<Record<string, unknown>> {
    if (accessToken) {
      logger.debug(`Fetching user info from ${userinfoUrlOrAccessToken}`);
      return await this.httpGetJson(userinfoUrlOrAccessToken, {
        'Authorization': `Bearer ${accessToken}`,
      });
    }
    if (!this.config?.profileUrl) {
      throw new OAuthError('Profile URL not configured', 'NO_PROFILE_URL');
    }
    logger.debug(`Fetching user info from ${this.config.profileUrl}`);
    return await this.httpGetJson(this.config.profileUrl, {
      'Authorization': `Bearer ${userinfoUrlOrAccessToken}`,
    });
  }

  /**
   * 撤销Token
   */
  async revokeToken(
    revocationUrlOrParams: string | RevokeTokenParams,
    token?: string,
    tokenTypeHint?: string
  ): Promise<void> {
    // 新API方式
    if (typeof revocationUrlOrParams !== 'string') {
      if (!this.config?.tokenUrl) {
        throw new OAuthError('Token URL not configured', 'NO_TOKEN_URL');
      }
      return this.revokeToken(
        this.config.tokenUrl.replace('/token', '/revoke'),
        revocationUrlOrParams.token,
        revocationUrlOrParams.tokenTypeHint
      );
    }
    
    // 旧API方式
    const revocationUrl = revocationUrlOrParams;
    const requestBody: Record<string, unknown> = {
      token: token!,
    };

    if (tokenTypeHint) {
      requestBody.token_type_hint = tokenTypeHint;
    }

    logger.debug(`Revoking token at ${revocationUrl}`);
    await this.httpPostJson(revocationUrl, requestBody);
  }

  /**
   * HTTP POST请求
   */
  private async httpPostJson(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const requester = isHttps ? httpsRequest : httpRequest;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.defaultTimeout,
      };

      const req = requester(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new OAuthError(`Invalid JSON response from ${url}`, 'INVALID_RESPONSE'));
            }
          } else {
            reject(new OAuthError(
              `HTTP ${res.statusCode}: ${data}`,
              'HTTP_ERROR',
              res.statusCode
            ));
          }
        });
      });

      req.on('error', (error) => {
        reject(new OAuthError(`Request failed: ${error.message}`, 'REQUEST_FAILED'));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new OAuthError(`Request timeout (${this.defaultTimeout}ms)`, 'TIMEOUT'));
      });

      req.write(JSON.stringify(body));
      req.end();
    });
  }

  /**
   * HTTP GET请求
   */
  private async httpGetJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const requester = isHttps ? httpsRequest : httpRequest;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: this.defaultTimeout,
      };

      const req = requester(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new OAuthError(`Invalid JSON response from ${url}`, 'INVALID_RESPONSE'));
            }
          } else {
            reject(new OAuthError(
              `HTTP ${res.statusCode}: ${data}`,
              'HTTP_ERROR',
              res.statusCode
            ));
          }
        });
      });

      req.on('error', (error) => {
        reject(new OAuthError(`Request failed: ${error.message}`, 'REQUEST_FAILED'));
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new OAuthError(`Request timeout (${this.defaultTimeout}ms)`, 'TIMEOUT'));
      });

      req.end();
    });
  }
}
