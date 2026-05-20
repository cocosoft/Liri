/**
 * OAuth统一服务
 * 作为OAuth模块的统一入口，协调所有OAuth操作
 *
 * 设计原则：
 * - 单一职责：仅负责OAuth操作的协调和路由
 * - 依赖注入：通过构造函数注入依赖
 * - 线程安全：支持多线程访问
 */
import { logger } from '@modules/infrastructure';
import { OAuthTokenManager } from './OAuthTokenManager';
import { OAuthDiscovery } from './OAuthDiscovery';
import type {
  OAuthProvider,
  OAuthToken,
  OAuthTokenData,
  AuthorizeOptions,
} from '../types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export class OAuthService {
  private tokenManager: OAuthTokenManager;
  private discovery: OAuthDiscovery;
  private providers: Map<string, OAuthProvider>;

  constructor() {
    this.tokenManager = new OAuthTokenManager();
    this.discovery = new OAuthDiscovery();
    this.providers = new Map();
    logger.info('OAuthService initialized');
  }

  /**
   * 注册OAuth提供者
   * 自动设置刷新和撤销回调
   */
  registerProvider(providerId: string, provider: OAuthProvider): void {
    this.providers.set(providerId, provider);

    this.tokenManager.setProviderRefreshCallback(
      providerId,
      async (refreshToken: string) => {
        const newToken = await provider.refreshToken(refreshToken);
        return {
          accessToken: newToken.accessToken,
          refreshToken: newToken.refreshToken,
          expiresAt: newToken.expiresAt,
          tokenType: newToken.tokenType,
          scopes: newToken.scopes || [],
        };
      }
    );

    this.tokenManager.setRevokeCallback(providerId, async () => {
      await provider.revokeToken();
    });

    logger.debug(`OAuth provider registered: ${providerId}`);
  }

  /**
   * 获取Token（自动刷新）
   * @param providerId 提供者标识
   * @param scopes 所需权限范围
   * @returns Token对象或null
   */
  async getToken(
    providerId: string,
    scopes?: string[]
  ): Promise<OAuthTokenData | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new AppError(
        `OAuth provider ${providerId} not registered`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    return this.tokenManager.getToken(providerId);
  }

  /**
   * 执行OAuth授权流程
   * @param providerId 提供者标识
   * @param options 授权选项
   * @returns Token对象
   */
  async authorize(
    providerId: string,
    options: AuthorizeOptions
  ): Promise<OAuthToken> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new AppError(
        `OAuth provider ${providerId} not registered`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const token = await provider.authorize(options);
    await this.tokenManager.saveToken(providerId, token);
    return token;
  }

  /**
   * 刷新Token
   * @param providerId 提供者标识
   * @returns 新的Token对象
   */
  async refreshToken(providerId: string): Promise<OAuthToken> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new AppError(
        `OAuth provider ${providerId} not registered`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const existingToken = await this.tokenManager.getToken(providerId);
    if (!existingToken) {
      throw new AppError(
        'No token found to refresh',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 刷新回调由 TokenManager 管理，直接调用 provider
    const newToken = await provider.refreshToken(existingToken.refreshToken);
    await this.tokenManager.saveToken(providerId, newToken);
    return newToken;
  }

  /**
   * 撤销Token
   * @param providerId 提供者标识
   */
  async revokeToken(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new AppError(
        `OAuth provider ${providerId} not registered`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 使用 TokenManager 的 revokeToken（自动处理远程撤销 + 本地删除）
    await this.tokenManager.revokeToken(providerId);
    logger.info(`Token revoked for provider: ${providerId}`);
  }

  /**
   * 撤销所有已授权 Token
   */
  async revokeAll(): Promise<void> {
    const activeKeys = this.tokenManager.listServerKeys();
    if (activeKeys.length === 0) {
      logger.info('No active tokens to revoke');
      return;
    }
    await this.tokenManager.revokeAll();
    logger.info(`Revoked all ${activeKeys.length} tokens`);
  }

  /**
   * 列出所有已注册的提供者
   * @returns 提供者ID列表
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 获取已授权（有 Token）的提供者列表
   */
  listAuthorizedProviders(): string[] {
    const providerIds = Array.from(this.providers.keys());
    return providerIds.filter((id) => {
      const status = this.tokenManager.getTokenStatus(id);
      return status.exists && !status.expired;
    });
  }

  /**
   * 获取 Token 状态
   */
  getTokenStatus(providerId: string): {
    exists: boolean;
    expired: boolean;
    expiresIn?: number;
    expiresAt?: number;
    refreshInProgress: boolean;
  } {
    return this.tokenManager.getTokenStatus(providerId);
  }

  /**
   * 获取Discovery服务实例
   * @returns OAuthDiscovery实例
   */
  getDiscovery(): OAuthDiscovery {
    return this.discovery;
  }
}

// 全局单例实例
export const oauthService = new OAuthService();
