/**
 * ProviderAuth 提供者认证管理
 * 管理 AI 提供者的认证凭据和验证
 */
import type {
  ProviderAuthMethod,
  ProviderMetadata,
} from './ProviderCatalog.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'plugins:provider:ProviderAuth',
  level: LogLevel.INFO,
});

/**
 * 认证凭据
 */
export interface ProviderCredentials {
  providerId: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  endpoint?: string;
  extraHeaders?: Record<string, string>;
}

/**
 * 认证状态
 */
export interface AuthStatus {
  providerId: string;
  authenticated: boolean;
  method: ProviderAuthMethod;
  expiresAt?: number;
  lastVerified?: number;
  error?: string;
}

/**
 * 提供者认证管理器
 */
export class ProviderAuth {
  private credentials: Map<string, ProviderCredentials> = new Map();
  private statusCache: Map<string, AuthStatus> = new Map();

  /**
   * 设置认证凭据
   */
  setCredentials(creds: ProviderCredentials): void {
    this.credentials.set(creds.providerId, creds);
    this.statusCache.delete(creds.providerId);
  }

  /**
   * 获取认证凭据
   */
  getCredentials(providerId: string): ProviderCredentials | undefined {
    return this.credentials.get(providerId);
  }

  /**
   * 移除认证凭据
   */
  removeCredentials(providerId: string): boolean {
    this.statusCache.delete(providerId);
    return this.credentials.delete(providerId);
  }

  /**
   * 验证认证状态
   */
  async verify(provider: ProviderMetadata): Promise<AuthStatus> {
    const cached = this.statusCache.get(provider.id);
    if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
      return cached;
    }

    const creds = this.credentials.get(provider.id);
    const status: AuthStatus = {
      providerId: provider.id,
      authenticated: false,
      method: provider.authMethods[0] || 'api-key',
    };

    try {
      status.authenticated = await this.performVerification(provider, creds);
      status.lastVerified = Date.now();
      status.expiresAt = Date.now() + 300000;
    } catch (err) {
      status.error = err instanceof Error ? err.message : '验证失败';
    }

    this.statusCache.set(provider.id, status);
    return status;
  }

  /**
   * 检查提供者是否有有效凭据
   */
  hasValidCredentials(providerId: string): boolean {
    const creds = this.credentials.get(providerId);
    if (!creds) return false;
    return !!(creds.apiKey || creds.accessToken);
  }

  /**
   * 获取认证头
   */
  getAuthHeaders(providerId: string): Record<string, string> | undefined {
    const creds = this.credentials.get(providerId);
    if (!creds) return undefined;

    const headers: Record<string, string> = {};

    if (creds.apiKey) {
      headers['Authorization'] = `Bearer ${creds.apiKey}`;
    } else if (creds.accessToken) {
      headers['Authorization'] = `Bearer ${creds.accessToken}`;
    }

    if (creds.extraHeaders) {
      Object.assign(headers, creds.extraHeaders);
    }

    return headers;
  }

  /**
   * 清除认证缓存
   */
  clearCache(): void {
    this.statusCache.clear();
  }

  /**
   * 执行验证
   */
  private async performVerification(
    provider: ProviderMetadata,
    creds?: ProviderCredentials
  ): Promise<boolean> {
    if (!creds) return false;

    switch (provider.authMethods[0]) {
      case 'api-key':
        return !!creds.apiKey;
      case 'bearer':
        return !!creds.accessToken;
      case 'basic':
        return !!(creds.clientId && creds.clientSecret);
      case 'oauth':
        return !!(creds.accessToken || (creds.clientId && creds.clientSecret));
      default:
        return this.verifyWithEndpoint(provider, creds);
    }
  }

  /**
   * 通过端点验证
   */
  private async verifyWithEndpoint(
    provider: ProviderMetadata,
    creds: ProviderCredentials
  ): Promise<boolean> {
    try {
      const response = await fetch(`${provider.baseUrl}/verify`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.apiKey || creds.accessToken}`,
        },
      });
      return response.ok;
    } catch {
      // @ignore-catch — 认证校验失败返回 false（外部服务异常按未认证处理）
      return false;
    }
  }
}

export const providerAuth = new ProviderAuth();
