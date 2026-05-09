//
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
import type { OAuthProvider, OAuthToken, OAuthTokenData, AuthorizeOptions } from '../types';

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
   * @param providerId 提供者唯一标识
   * @param provider OAuth提供者实例
   */
  registerProvider(providerId: string, provider: OAuthProvider): void {
    this.providers.set(providerId, provider);
    logger.debug(`OAuth provider registered: ${providerId}`);
  }

  /**
   * 获取Token（自动刷新）
   * @param providerId 提供者标识
   * @param scopes 所需权限范围
   * @returns Token对象或null
   */
  async getToken(providerId: string, scopes?: string[]): Promise<OAuthTokenData | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    return this.tokenManager.getToken(providerId);
  }

  /**
   * 执行OAuth授权流程
   * @param providerId 提供者标识
   * @param options 授权选项
   * @returns Token对象
   */
  async authorize(providerId: string, options: AuthorizeOptions): Promise<OAuthToken> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
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
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    const existingToken = await this.tokenManager.getToken(providerId);
    if (!existingToken) {
      throw new Error('No token found to refresh');
    }

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
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    await this.tokenManager.deleteToken(providerId);
    await provider.revokeToken();
    logger.info(`Token revoked for provider: ${providerId}`);
  }

  /**
   * 列出所有已注册的提供者
   * @returns 提供者ID列表
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
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
