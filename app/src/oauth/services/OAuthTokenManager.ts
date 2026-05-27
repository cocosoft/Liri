/**
 * OAuth Token管理服务
 * 提供Token的获取、刷新、验证、撤销等功能
 */

import { logger } from '@modules/infrastructure';
import type { OAuthTokenData } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';

export interface RefreshConfig {
  /** Token 过期前提前刷新的时间（毫秒），默认5分钟 */
  expirationBufferMs: number;
  /** Token 即将过期阈值（毫秒），默认10分钟 */
  expiringSoonThresholdMs: number;
  /** 是否启用自动刷新 */
  autoRefreshEnabled: boolean;
}

const DEFAULT_REFRESH_CONFIG: RefreshConfig = {
  expirationBufferMs: 5 * 60 * 1000,
  expiringSoonThresholdMs: 10 * 60 * 1000,
  autoRefreshEnabled: true,
};

/**
 * OAuth Token管理器
 */
export class OAuthTokenManager {
  private tokens: Map<string, OAuthTokenData> = new Map();
  private refreshCallbacks: Map<
    string,
    (refreshToken: string) => Promise<OAuthTokenData>
  > = new Map();
  private revokeCallbacks: Map<string, () => Promise<void>> = new Map();
  private refreshInProgress: Set<string> = new Set();
  private refreshConfig: RefreshConfig;

  constructor(config?: Partial<RefreshConfig>) {
    this.refreshConfig = { ...DEFAULT_REFRESH_CONFIG, ...config };
  }

  /**
   * 设置Token刷新回调
   */
  setRefreshCallback(
    callback: (
      serverKey: string,
      refreshToken: string
    ) => Promise<OAuthTokenData>
  ): void {
    this.refreshCallbacks.clear();
    this.refreshCallbacks.set('*', (refreshToken) =>
      callback('*', refreshToken)
    );
  }

  /**
   * 为指定 provider 设置刷新回调
   */
  setProviderRefreshCallback(
    serverKey: string,
    callback: (refreshToken: string) => Promise<OAuthTokenData>
  ): void {
    this.refreshCallbacks.set(serverKey, callback);
  }

  /**
   * 设置 Token 撤销回调
   */
  setRevokeCallback(serverKey: string, callback: () => Promise<void>): void {
    this.revokeCallbacks.set(serverKey, callback);
  }

  /**
   * 获取Token（自动刷新）
   */
  async getToken(serverKey: string): Promise<OAuthTokenData | null> {
    const token = this.tokens.get(serverKey);
    if (!token) {
      return null;
    }

    if (this.isTokenExpired(token)) {
      logger.info(`Token expired for ${serverKey}, attempting refresh`);
      return await this.refreshToken(serverKey, token);
    }

    if (this.isTokenExpiringSoon(token)) {
      logger.debug(
        `Token expiring soon for ${serverKey}, refreshing in background`
      );
      this.refreshTokenInBackground(serverKey, token);
    }

    return token;
  }

  /**
   * 保存Token
   */
  saveToken(serverKey: string, tokenData: OAuthTokenData): void {
    this.tokens.set(serverKey, tokenData);
    logger.debug(`Token saved for ${serverKey}`);
  }

  /**
   * 删除Token
   */
  deleteToken(serverKey: string): void {
    this.tokens.delete(serverKey);
    this.refreshInProgress.delete(serverKey);
    logger.debug(`Token deleted for ${serverKey}`);
  }

  /**
   * 撤销 Token
   * 先调用撤销回调，再删除本地 Token
   */
  async revokeToken(serverKey: string): Promise<void> {
    const token = this.tokens.get(serverKey);

    const revokeCb = this.revokeCallbacks.get(serverKey);
    if (revokeCb) {
      try {
        await revokeCb();
        logger.info(`Token revoked remotely for ${serverKey}`);
      } catch (error) {
        logger.warn(
          `Remote token revocation failed for ${serverKey}: ${error instanceof Error ? error.message : 'Unknown'}`
        );
      }
    } else {
      // 尝试调用通配撤销回调
      const wildcardCb = this.revokeCallbacks.get('*');
      if (wildcardCb) {
        try {
          await wildcardCb();
        } catch {
          // 通配撤销失败不阻塞
        }
      }
    }

    this.deleteToken(serverKey);
    logger.info(`Token revoked locally for ${serverKey}`);
  }

  /**
   * 撤销所有 Token
   */
  async revokeAll(): Promise<void> {
    const keys = Array.from(this.tokens.keys());
    const results = await Promise.allSettled(
      keys.map((key) => this.revokeToken(key))
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn(`${failed}/${keys.length} tokens failed to revoke`);
    } else {
      logger.info(`All ${keys.length} tokens revoked successfully`);
    }
  }

  /**
   * 检查Token是否过期
   */
  isTokenExpired(token: OAuthTokenData): boolean {
    return (
      Date.now() + this.refreshConfig.expirationBufferMs >= token.expiresAt
    );
  }

  /**
   * 获取 Token 过期时间（毫秒时间戳）
   */
  getTokenExpiry(serverKey: string): number | null {
    const token = this.tokens.get(serverKey);
    return token ? token.expiresAt : null;
  }

  /**
   * 检查Token是否即将过期（默认10分钟内）
   */
  private isTokenExpiringSoon(token: OAuthTokenData): boolean {
    const expiresIn = token.expiresAt - Date.now();
    return (
      expiresIn > 0 && expiresIn < this.refreshConfig.expiringSoonThresholdMs
    );
  }

  /**
   * 刷新Token
   */
  private async refreshToken(
    serverKey: string,
    token: OAuthTokenData
  ): Promise<OAuthTokenData | null> {
    if (this.refreshInProgress.has(serverKey)) {
      logger.debug(`Refresh already in progress for ${serverKey}, waiting`);
      while (this.refreshInProgress.has(serverKey)) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.tokens.get(serverKey) || null;
    }

    this.refreshInProgress.add(serverKey);

    try {
      let refreshCb:
        | ((refreshToken: string) => Promise<OAuthTokenData>)
        | undefined;
      refreshCb = this.refreshCallbacks.get(serverKey);

      if (!refreshCb) {
        const wildcardCb = this.refreshCallbacks.get('*');
        if (wildcardCb) {
          refreshCb = wildcardCb;
        }
      }

      if (!refreshCb) {
        logger.error(`No refresh callback for ${serverKey}`);
        this.deleteToken(serverKey);
        return null;
      }

      const newToken = await refreshCb(token.refreshToken);
      this.tokens.set(serverKey, newToken);
      logger.info(`Token refreshed successfully for ${serverKey}`);
      return newToken;
    } catch (error) {
      logger.error(`Token refresh failed for ${serverKey}:`, error);
      this.deleteToken(serverKey);
      throw new OAuthError(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TOKEN_REFRESH_FAILED'
      );
    } finally {
      this.refreshInProgress.delete(serverKey);
    }
  }

  /**
   * 后台刷新Token
   */
  private async refreshTokenInBackground(
    serverKey: string,
    token: OAuthTokenData
  ): Promise<void> {
    if (!this.refreshConfig.autoRefreshEnabled) {
      return;
    }

    try {
      await this.refreshToken(serverKey, token);
    } catch (error) {
      logger.error(`Background token refresh failed for ${serverKey}:`, error);
    }
  }

  /**
   * 获取所有Token的serverKey列表
   */
  listServerKeys(): string[] {
    return Array.from(this.tokens.keys());
  }

  /**
   * 清除所有Token
   */
  clearAll(): void {
    this.tokens.clear();
    this.refreshInProgress.clear();
    logger.info('All tokens cleared');
  }

  /**
   * 获取Token状态信息
   */
  getTokenStatus(serverKey: string): {
    exists: boolean;
    expired: boolean;
    expiresIn?: number;
    expiresAt?: number;
    refreshInProgress: boolean;
  } {
    const token = this.tokens.get(serverKey);
    if (!token) {
      return { exists: false, expired: false, refreshInProgress: false };
    }

    const now = Date.now();
    const expiresIn = token.expiresAt - now;

    return {
      exists: true,
      expired: expiresIn <= 0,
      expiresIn: expiresIn > 0 ? expiresIn : 0,
      expiresAt: token.expiresAt,
      refreshInProgress: this.refreshInProgress.has(serverKey),
    };
  }
}
