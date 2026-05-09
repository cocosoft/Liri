/**
 * OAuth Token管理服务
 * 提供Token的获取、刷新、验证等功能
 */

import { logger } from '@modules/infrastructure';
import type { OAuthTokenData, OAuthConfig } from '../types/OAuthTypes';
import { OAuthError } from '../types/OAuthTypes';

/**
 * OAuth Token管理器
 */
export class OAuthTokenManager {
  private tokens: Map<string, OAuthTokenData> = new Map();
  private refreshCallback:
    | ((serverKey: string, refreshToken: string) => Promise<OAuthTokenData>)
    | null = null;

  /**
   * 设置Token刷新回调
   */
  setRefreshCallback(
    callback: (
      serverKey: string,
      refreshToken: string
    ) => Promise<OAuthTokenData>
  ): void {
    this.refreshCallback = callback;
  }

  /**
   * 获取Token
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
    logger.debug(`Token deleted for ${serverKey}`);
  }

  /**
   * 检查Token是否过期
   */
  isTokenExpired(token: OAuthTokenData): boolean {
    const bufferTime = 5 * 60 * 1000;
    return Date.now() + bufferTime >= token.expiresAt;
  }

  /**
   * 检查Token是否即将过期（5分钟内）
   */
  private isTokenExpiringSoon(token: OAuthTokenData): boolean {
    const soonTime = 10 * 60 * 1000;
    const expiresIn = token.expiresAt - Date.now();
    return expiresIn > 0 && expiresIn < soonTime;
  }

  /**
   * 刷新Token
   */
  private async refreshToken(
    serverKey: string,
    token: OAuthTokenData
  ): Promise<OAuthTokenData | null> {
    if (!this.refreshCallback) {
      logger.error(`No refresh callback set for ${serverKey}`);
      this.tokens.delete(serverKey);
      return null;
    }

    try {
      const newToken = await this.refreshCallback(
        serverKey,
        token.refreshToken
      );
      this.tokens.set(serverKey, newToken);
      logger.info(`Token refreshed successfully for ${serverKey}`);
      return newToken;
    } catch (error) {
      logger.error(`Token refresh failed for ${serverKey}:`, error);
      this.tokens.delete(serverKey);
      throw new OAuthError(
        `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TOKEN_REFRESH_FAILED'
      );
    }
  }

  /**
   * 后台刷新Token
   */
  private async refreshTokenInBackground(
    serverKey: string,
    token: OAuthTokenData
  ): Promise<void> {
    try {
      if (this.refreshCallback) {
        const newToken = await this.refreshCallback(
          serverKey,
          token.refreshToken
        );
        this.tokens.set(serverKey, newToken);
        logger.debug(`Token refreshed in background for ${serverKey}`);
      }
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
    logger.info('All tokens cleared');
  }

  /**
   * 获取Token状态信息
   */
  getTokenStatus(serverKey: string): {
    exists: boolean;
    expired: boolean;
    expiresIn?: number;
  } {
    const token = this.tokens.get(serverKey);
    if (!token) {
      return { exists: false, expired: false };
    }

    const now = Date.now();
    const expiresIn = token.expiresAt - now;

    return {
      exists: true,
      expired: expiresIn <= 0,
      expiresIn: expiresIn > 0 ? expiresIn : 0,
    };
  }
}
