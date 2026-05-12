/**
 * 增强版OAuth客户端
 * 集成OAuthDiscovery实现自动元数据发现
 * 参考CC源码的多环境配置模式
 */

import { logger } from '@modules/utils/log.js';
import {
  OAuthDiscovery,
  type OAuthMetadata,
} from '../services/OAuthDiscovery.js';
import { TokenManager, type CachedToken } from '../services/TokenManager.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * 增强版OAuth客户端配置
 */
export interface EnhancedOAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes?: string[];
  metadata?: OAuthMetadata;
}

/**
 * 增强版OAuth客户端
 * 支持OAuth Discovery和Token管理
 */
export class EnhancedOAuthClient {
  private config: EnhancedOAuthConfig;
  private discovery: OAuthDiscovery;
  private tokenManager: TokenManager;
  private metadata: OAuthMetadata | null = null;

  constructor(config: EnhancedOAuthConfig) {
    this.config = config;
    this.discovery = new OAuthDiscovery();
    this.tokenManager = TokenManager.getInstance();
  }

  /**
   * 初始化OAuth客户端
   * 自动发现OAuth元数据
   */
  async initialize(): Promise<void> {
    if (this.config.metadata) {
      // 使用提供的元数据
      this.metadata = this.config.metadata;
      logger.info('Using provided OAuth metadata');
    } else {
      // 自动发现元数据
      this.metadata = await this.discovery.discoverMetadata(this.config.issuer);
      logger.info('OAuth metadata discovered automatically');
    }
  }

  /**
   * 获取授权URL
   * 使用Discovery的元数据构建授权URL
   */
  getAuthorizationUrl(params: {
    state: string;
    codeChallenge: string;
    scopes?: string[];
  }): string {
    if (!this.metadata) {
      throw new AppError('OAuth client not initialized. Call initialize() first.', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const url = new URL(this.metadata.authorization_endpoint);
    url.searchParams.append('response_type', 'code');
    url.searchParams.append('client_id', this.config.clientId);
    url.searchParams.append('redirect_uri', this.config.redirectUri);
    url.searchParams.append('state', params.state);
    url.searchParams.append('code_challenge', params.codeChallenge);
    url.searchParams.append('code_challenge_method', 'S256');

    const scopes = params.scopes || this.config.scopes || [];
    if (scopes.length > 0) {
      url.searchParams.append('scope', scopes.join(' '));
    }

    return url.toString();
  }

  /**
   * 交换授权码获取Token
   * 使用Discovery的元数据获取Token端点
   */
  async exchangeCodeForToken(params: {
    code: string;
    codeVerifier: string;
  }): Promise<CachedToken> {
    if (!this.metadata) {
      throw new AppError('OAuth client not initialized. Call initialize() first.', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const requestBody: Record<string, string> = {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: params.codeVerifier,
    };

    if (this.config.clientSecret) {
      requestBody['client_secret'] = this.config.clientSecret;
    }

    logger.info(
      `Exchanging authorization code for token at ${this.metadata.token_endpoint}`
    );

    try {
      const response = await fetch(this.metadata.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new AppError(
          `Token exchange failed: ${response.status} ${response.statusText}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }

      const data = await response.json();

      const token: CachedToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        scopes: data.scope?.split(' ') || [],
      };

      logger.info('Token exchange successful');
      return token;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Token exchange failed:', e);
      throw error;
    }
  }

  /**
   * 刷新Token
   * 使用TokenManager的刷新机制
   */
  async refreshToken(refreshToken: string): Promise<CachedToken> {
    if (!this.metadata) {
      throw new AppError('OAuth client not initialized. Call initialize() first.', ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
    }

    const requestBody: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    };

    if (this.config.clientSecret) {
      requestBody['client_secret'] = this.config.clientSecret;
    }

    logger.info(`Refreshing token at ${this.metadata.token_endpoint}`);

    try {
      const response = await fetch(this.metadata.token_endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new AppError(
          `Token refresh failed: ${response.status} ${response.statusText}`
        , ErrorCategory.EXECUTION, ErrorSeverity.HIGH, '1000');
      }

      const data = await response.json();

      const token: CachedToken = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || refreshToken,
        expiresAt: Date.now() + data.expires_in * 1000,
        scopes: data.scope?.split(' ') || [],
      };

      logger.info('Token refresh successful');
      return token;
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Token refresh failed:', e);
      throw error;
    }
  }

  /**
   * 获取Token（自动处理缓存和刷新）
   */
  async getToken(): Promise<string> {
    return this.tokenManager.getToken('default', async (refreshToken) => {
      return this.refreshToken(refreshToken);
    });
  }

  /**
   * 缓存Token
   */
  async cacheToken(token: CachedToken): Promise<void> {
    await this.tokenManager.cacheToken('default', token);
  }

  /**
   * 获取OAuth元数据
   */
  getMetadata(): OAuthMetadata | null {
    return this.metadata;
  }

  /**
   * 获取Token管理器状态
   */
  getTokenManagerStatus() {
    return this.tokenManager.getStatus();
  }

  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    this.tokenManager.clearAllTokens();
    await this.discovery.clearAllCache();
    logger.info('OAuth client cache cleared');
  }
}

/**
 * 创建增强版OAuth客户端实例
 */
export function createEnhancedOAuthClient(
  config: EnhancedOAuthConfig
): EnhancedOAuthClient {
  return new EnhancedOAuthClient(config);
}
