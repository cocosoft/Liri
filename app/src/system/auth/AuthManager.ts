//
/**
 * 认证管理器
 * 负责管理各种认证方式（API Key、OAuth、AWS、GCP等）
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { configManager } from '@modules/config';
import { oauthService } from '@modules/oauth';
import type {
  OAuthTokens as OAuthTokensType,
  OAuthServiceOptions,
} from './oauth-types.js';
import { logger } from '@modules/infrastructure';
import {
  TokenManager,
  type CachedToken,
} from '@modules/oauth/services/TokenManager.js';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
}

export interface CloudCredentials {
  accessKey: string;
  secretKey: string;
  sessionToken?: string;
  expiration?: number;
}

export type CloudProvider = 'aws' | 'gcp' | 'azure';

export interface AuthConfig {
  type: 'api_key' | 'oauth' | 'aws' | 'gcp' | 'azure';
  apiKey?: string | null;
  oauth?: OAuthTokens | null;
  cloudCredentials?: Map<CloudProvider, CloudCredentials>;
}

export interface AuthManager {
  getApiKey(): Promise<string>;
  refreshIfNeeded(): Promise<void>;
  setOAuthTokens(tokens: OAuthTokens): void;
  getOAuthTokens(): Promise<OAuthTokens | null>;
  getCloudCredentials(
    provider: CloudProvider
  ): Promise<CloudCredentials | null>;
  isAuthenticated(): boolean;
  clearAuth(): void;
}

export class DefaultAuthManager implements AuthManager {
  private apiKey: string | null = null;
  private oauthTokens: OAuthTokens | null = null;
  private cloudCredentials: Map<CloudProvider, CloudCredentials> = new Map();
  private authConfig: AuthConfig;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isRefreshing: boolean = false;
  private refreshRetryCount: number = 0;
  private readonly MAX_REFRESH_RETRIES = 3;
  private tokenManager: TokenManager;

  constructor(config?: Partial<AuthConfig>) {
    this.authConfig = {
      type: config?.type || 'api_key',
      apiKey: config?.apiKey || null,
      oauth: config?.oauth || null,
    };

    this.tokenManager = TokenManager.getInstance();

    if (config?.oauth) {
      this.oauthTokens = config.oauth;
      this.scheduleTokenRefresh();
    }

    if (config?.cloudCredentials) {
      this.cloudCredentials = config.cloudCredentials;
    }
  }

  async startOAuthFlow(
    authURLHandler: (urls: {
      automaticUrl: string;
      manualUrl: string;
    }) => Promise<void>,
    _options: OAuthServiceOptions = {}
  ): Promise<OAuthTokensType> {
    // 使用统一的OAuth服务
    const tokens = await oauthService.authorize('core', {
      code: '', // 实际使用时需要提供授权码
      codeVerifier: '',
    });

    this.oauthTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenType: 'Bearer',
    };
    this.authConfig.type = 'oauth';
    this.authConfig.oauth = this.oauthTokens;

    this.scheduleTokenRefresh();

    return tokens;
  }

  async getApiKey(): Promise<string> {
    if (this.apiKey) {
      return this.apiKey;
    }

    this.apiKey = this.loadApiKeyFromEnv();
    return this.apiKey;
  }

  private loadApiKeyFromEnv(): string {
    return (
      configManager.env('Liri_API_KEY') ||
      configManager.env('ANTHROPIC_API_KEY') ||
      configManager.env('DEEPSEEK_API_KEY') ||
      configManager.env('OPENAI_API_KEY') ||
      ''
    );
  }

  async refreshIfNeeded(): Promise<void> {
    if (!this.oauthTokens) {
      return;
    }

    const now = Date.now();
    const bufferMs = 5 * 60 * 1000;

    if (this.oauthTokens.expiresAt - now < bufferMs) {
      await this.refreshOAuthTokens();
    }
  }

  private async refreshOAuthTokens(): Promise<void> {
    if (this.isRefreshing) {
      logger.debug('Token refresh already in progress, skipping');
      return;
    }

    if (!this.oauthTokens?.refreshToken) {
      throw new AppError(
        'No refresh token available',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH
      );
    }

    this.isRefreshing = true;
    this.refreshRetryCount++;

    try {
      // 使用统一的OAuth服务刷新token
      const newTokens = await oauthService.refreshToken('core');

      this.oauthTokens = {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        tokenType: 'Bearer',
      };

      this.authConfig.oauth = this.oauthTokens;
      this.refreshRetryCount = 0;

      logger.info('OAuth tokens refreshed successfully');

      this.scheduleTokenRefresh();
    } catch (error) {
      logger.error(
        `OAuth token refresh failed (attempt ${this.refreshRetryCount}/${this.MAX_REFRESH_RETRIES}):`,
        error
      );

      if (this.refreshRetryCount >= this.MAX_REFRESH_RETRIES) {
        logger.error('Max refresh retries reached, clearing tokens');
        this.oauthTokens = null;
        this.authConfig.oauth = null;
        this.clearRefreshTimer();
        throw new AppError(
          'Token refresh failed after maximum retries',
          ErrorCategory.PERMISSION,
          ErrorSeverity.CRITICAL
        );
      }

      const delay = Math.min(1000 * Math.pow(2, this.refreshRetryCount), 30000);
      logger.info(`Retrying token refresh in ${delay}ms`);

      setTimeout(() => {
        this.refreshOAuthTokens().catch((err) => {
          logger.error('Retry token refresh failed:', err);
        });
      }, delay);
    } finally {
      this.isRefreshing = false;
    }
  }

  private scheduleTokenRefresh(): void {
    this.clearRefreshTimer();

    if (!this.oauthTokens) {
      return;
    }

    const now = Date.now();
    const expiresIn = this.oauthTokens.expiresAt - now;
    const refreshBefore = 5 * 60 * 1000;

    if (expiresIn > refreshBefore) {
      const refreshIn = expiresIn - refreshBefore;
      logger.debug(`Scheduling token refresh in ${refreshIn}ms`);

      this.refreshTimer = setTimeout(() => {
        this.refreshOAuthTokens().catch((err) => {
          logger.error('Scheduled token refresh failed:', err);
        });
      }, refreshIn);

      this.refreshTimer.unref();
    }
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async getOAuthTokens(): Promise<OAuthTokens | null> {
    return this.oauthTokens;
  }

  async getCloudCredentials(
    provider: CloudProvider
  ): Promise<CloudCredentials | null> {
    if (this.cloudCredentials.has(provider)) {
      return this.cloudCredentials.get(provider)!;
    }

    const credentials = await this.loadCloudCredentialsFromEnv(provider);
    if (credentials) {
      this.cloudCredentials.set(provider, credentials);
    }

    return credentials;
  }

  private async loadCloudCredentialsFromEnv(
    provider: CloudProvider
  ): Promise<CloudCredentials | null> {
    switch (provider) {
      case 'aws':
        return {
          accessKey: configManager.env('AWS_ACCESS_KEY_ID') || '',
          secretKey: configManager.env('AWS_SECRET_ACCESS_KEY') || '',
          sessionToken: configManager.env('AWS_SESSION_TOKEN'),
        };
      case 'gcp':
        return {
          accessKey: configManager.env('GCP_ACCESS_KEY') || '',
          secretKey: configManager.env('GCP_SECRET_KEY') || '',
        };
      case 'azure':
        return {
          accessKey: configManager.env('AZURE_ACCESS_KEY') || '',
          secretKey: configManager.env('AZURE_SECRET_KEY') || '',
        };
      default:
        return null;
    }
  }

  isAuthenticated(): boolean {
    if (this.apiKey) {
      return true;
    }

    if (this.oauthTokens && this.oauthTokens.expiresAt > Date.now()) {
      return true;
    }

    return false;
  }

  clearAuth(): void {
    this.clearRefreshTimer();
    this.apiKey = null;
    this.oauthTokens = null;
    this.cloudCredentials.clear();
    this.refreshRetryCount = 0;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.authConfig.type = 'api_key';
    this.authConfig.apiKey = apiKey;
  }

  setOAuthTokens(tokens: OAuthTokens): void {
    this.oauthTokens = tokens;
    this.authConfig.type = 'oauth';
    this.authConfig.oauth = tokens;

    // 使用TokenManager缓存Token
    const cachedToken: CachedToken = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes: tokens.scopes || [],
    };
    this.tokenManager.cacheToken('default', cachedToken).catch((err) => {
      logger.error('Failed to cache OAuth tokens:', err);
    });

    this.scheduleTokenRefresh();
  }

  setCloudCredentials(
    provider: CloudProvider,
    credentials: CloudCredentials
  ): void {
    this.cloudCredentials.set(provider, credentials);
    this.authConfig.cloudCredentials = this.cloudCredentials;
  }

  getAuthConfig(): AuthConfig {
    return { ...this.authConfig };
  }

  getRefreshStatus(): {
    isRefreshing: boolean;
    retryCount: number;
    maxRetries: number;
    hasTimer: boolean;
  } {
    return {
      isRefreshing: this.isRefreshing,
      retryCount: this.refreshRetryCount,
      maxRetries: this.MAX_REFRESH_RETRIES,
      hasTimer: this.refreshTimer !== null,
    };
  }
}

let globalAuthManager: AuthManager | null = null;

export function getAuthManager(): AuthManager {
  if (!globalAuthManager) {
    globalAuthManager = new DefaultAuthManager();
  }
  return globalAuthManager;
}

export function setAuthManager(manager: AuthManager): void {
  globalAuthManager = manager;
}

export function createAuthManager(config?: Partial<AuthConfig>): AuthManager {
  return new DefaultAuthManager(config);
}
