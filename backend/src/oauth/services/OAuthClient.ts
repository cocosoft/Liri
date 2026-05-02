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
  redirectUri: string;
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
      params.redirectUri
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
   * 刷新Token（新API - 对象参数方式）
   */
  async refreshToken(params: RefreshTokenParams): Promise<Record<string, unknown>>;
  
  /**
   * 刷新Token（旧API - 兼容模式）
   */
  async refreshToken(
    config: OAuthConfig,
    refreshToken: string,
    scopes?: string[]
  ): Promise<Record<string, unknown>>;
  
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
      return this.refreshToken(
        this.config,
        configOrParams.refreshToken,
        configOrParams.scopes
      );
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
   * 获取用户信息（新API - 简化方式）
   */
  async getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
    if (!this.config?.profileUrl) {
      throw new OAuthError('Profile URL not configured', 'NO_PROFILE_URL');
    }
    return this.getUserInfo(this.config.profileUrl, accessToken);
  }

  /**
   * 获取用户信息（旧API - 兼容模式）
   */
  async getUserInfo(
    userinfoUrl: string,
    accessToken: string
  ): Promise<Record<string, unknown>> {
    logger.debug(`Fetching user info from ${userinfoUrl}`);
    return await this.httpGetJson(userinfoUrl, {
      'Authorization': `Bearer ${accessToken}`,
    });
  }

  /**
   * 撤销Token（新API - 对象参数方式）
   */
  async revokeToken(params: RevokeTokenParams): Promise<void>;
  
  /**
   * 撤销Token（旧API - 兼容模式）
   */
  async revokeToken(
    revocationUrl: string,
    token: string,
    tokenTypeHint?: string
  ): Promise<void>;
  
  async revokeToken(
    revocationUrlOrParams: string | RevokeTokenParams,
    token?: string,
    tokenTypeHint?: string
  ): Promise<void> {
    // 新API方式
    if ('token' in revocationUrlOrParams) {
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
