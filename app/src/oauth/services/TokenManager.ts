/**
 * OAuth Token管理器
 * 参考CC源码的Token管理实现，提供完整的Token生命周期管理
 * 包括：Token缓存、自动刷新、过期缓冲、重试机制
 */

import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'TokenManager' });
import { OAuthStorage, createOAuthStorage } from './OAuthStorage.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 缓存的Token接口
 */
export interface CachedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
  subscriptionType?: string | null;
  rateLimitTier?: string | null;
  profile?: Record<string, unknown>;
}

/**
 * Token 状态
 */
export interface TokenStatus {
  exists: boolean;
  expired: boolean;
  expiresIn?: number;
  expiresAt?: number;
  refreshInProgress: boolean;
}

/**
 * Token刷新配置
 */
export interface TokenRefreshConfig {
  /** 过期缓冲时间（毫秒），默认5分钟 */
  refreshBufferMs: number;
  /** 最大重试次数 */
  maxRetries: number;
  /** 重试基础延迟（毫秒） */
  retryBaseDelayMs: number;
  /** 最大重试延迟（毫秒） */
  maxRetryDelayMs: number;
}

/**
 * Token刷新函数类型
 */
export type TokenRefreshFn = (refreshToken: string) => Promise<CachedToken>;

/**
 * OAuth Token管理器
 * 参考CC源码的refreshOAuthToken和isOAuthTokenExpired实现
 */
export class TokenManager {
  private static instance: TokenManager;
  private tokenCache: Map<string, CachedToken>;
  private refreshScheduler: RefreshScheduler;
  private storage: OAuthStorage;
  private config: TokenRefreshConfig;
  private isRefreshing: boolean = false;
  private refreshRetryCount: number = 0;

  /** Provider 级刷新回调（按 serverKey 注册） */
  private refreshCallbacks: Map<string, TokenRefreshFn> = new Map();
  /** Provider 级撤销回调（按 serverKey 注册） */
  private revokeCallbacks: Map<string, () => Promise<void>> = new Map();

  /** 401 去重：防止同一 serverKey 多次 401 触发重复 OAuth 流程 */
  private pending401s = new Map<string, Promise<boolean>>();

  private constructor(config?: Partial<TokenRefreshConfig>) {
    this.tokenCache = new Map();
    this.refreshScheduler = new RefreshScheduler();
    this.storage = createOAuthStorage();
    this.config = {
      refreshBufferMs: 5 * 60 * 1000, // 5分钟缓冲
      maxRetries: 3,
      retryBaseDelayMs: 1000,
      maxRetryDelayMs: 30000,
      ...config,
    };
  }

  /**
   * 获取单例实例
   */
  static getInstance(config?: Partial<TokenRefreshConfig>): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager(config);
    }
    return TokenManager.instance;
  }

  /**
   * 获取Token（自动处理缓存和刷新）
   * @param serverKey 服务器标识
   * @param refreshFn Token刷新函数
   */
  async getToken(
    serverKey: string,
    refreshFn: TokenRefreshFn
  ): Promise<string> {
    const cached = this.tokenCache.get(serverKey);

    // 如果Token未过期且不在刷新缓冲期内，直接返回
    if (cached && !this.isExpiringSoon(cached)) {
      logger.debug(`Using cached token for ${serverKey}`);
      return cached.accessToken;
    }

    // Token即将过期或已过期，需要刷新
    logger.info(`Token for ${serverKey} is expiring soon, refreshing...`);
    return this.refreshTokenWithRetry(
      serverKey,
      cached?.refreshToken || '',
      refreshFn
    );
  }

  /**
   * 检查Token是否即将过期（带缓冲）
   * 参考CC源码的isOAuthTokenExpired实现
   */
  isExpiringSoon(token: CachedToken): boolean {
    const now = Date.now();
    const expiresWithBuffer = now + this.config.refreshBufferMs;
    return expiresWithBuffer >= token.expiresAt;
  }

  /**
   * 检查Token是否已过期
   */
  isTokenExpired(token: CachedToken): boolean {
    return Date.now() >= token.expiresAt;
  }

  /**
   * 缓存Token
   */
  async cacheToken(serverKey: string, token: CachedToken): Promise<void> {
    this.tokenCache.set(serverKey, token);

    // 持久化到安全存储
    try {
      await this.storage.saveToken(serverKey, {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scopes: token.scopes,
      });
      logger.debug(`Token cached and persisted for ${serverKey}`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to persist token for ${serverKey}:`, e);
    }

    // 调度自动刷新
    this.scheduleAutoRefresh(serverKey, token, async (refreshToken) => {
      // 这里需要外部提供刷新逻辑
      throw new AppError(
        'Token refresh function not provided',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    });
  }

  /**
   * 从缓存获取Token
   */
  getCachedToken(serverKey: string): CachedToken | undefined {
    return this.tokenCache.get(serverKey);
  }

  /**
   * 从存储加载所有Token到缓存
   */
  async loadTokensFromStorage(): Promise<void> {
    try {
      const keys = await this.storage.listKeys();
      for (const key of keys) {
        const token = await this.storage.loadToken(key);
        if (token) {
          this.tokenCache.set(key, {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
            scopes: token.scopes || [],
            subscriptionType: token.subscriptionType,
            rateLimitTier: token.rateLimitTier,
          });
        }
      }
      logger.info(`Loaded ${keys.length} tokens from storage`);
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to load tokens from storage:', e);
    }
  }

  /**
   * 清除Token缓存
   */
  clearToken(serverKey: string): void {
    this.tokenCache.delete(serverKey);
    this.refreshScheduler.clear(serverKey);
    logger.info(`Token cache cleared for ${serverKey}`);
  }

  /**
   * 清除所有Token缓存
   */
  clearAllTokens(): void {
    this.tokenCache.clear();
    this.refreshScheduler.clearAll();
    logger.info('All token caches cleared');
  }

  // ─── 补充接口（合并自 OAuthTokenManager） ──────────────────

  /**
   * 设置 Provider 刷新回调（按 serverKey）
   * @deprecated 请优先使用 cacheToken + scheduleAutoRefresh，此接口为 OAuthTokenManager 兼容保留
   */
  setProviderRefreshCallback(
    serverKey: string,
    callback: TokenRefreshFn
  ): void {
    this.refreshCallbacks.set(serverKey, callback);
  }

  /**
   * 设置通配刷新回调（用于未注册 serverKey 的默认刷新）
   */
  setWildcardRefreshCallback(callback: TokenRefreshFn): void {
    this.refreshCallbacks.set('*', callback);
  }

  /**
   * 设置 Token 撤销回调
   */
  setRevokeCallback(serverKey: string, callback: () => Promise<void>): void {
    this.revokeCallbacks.set(serverKey, callback);
  }

  /**
   * 撤销指定服务器的 Token
   */
  async revokeToken(serverKey: string): Promise<void> {
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
    }

    // 从磁盘和缓存中删除
    try {
      await this.storage.deleteToken(serverKey);
    } catch (err) {
      // 磁盘删除失败不阻塞缓存清理
    }
    this.tokenCache.delete(serverKey);
    this.refreshScheduler.clear(serverKey);
  }

  /**
   * 撤销所有 Token
   */
  async revokeAll(): Promise<void> {
    const keys = Array.from(this.tokenCache.keys());
    for (const key of keys) {
      await this.revokeToken(key);
    }
    this.tokenCache.clear();
    this.refreshScheduler.clearAll();
    logger.info('All tokens revoked');
  }

  /**
   * 列出所有缓存的 serverKey
   */
  listServerKeys(): string[] {
    return Array.from(this.tokenCache.keys());
  }

  /**
   * 获取指定 serverKey 的 Token 状态
   */
  getTokenStatus(serverKey: string): TokenStatus {
    const token = this.tokenCache.get(serverKey);
    if (!token) {
      return { exists: false, expired: false, refreshInProgress: false };
    }
    return {
      exists: true,
      expired: this.isTokenExpired(token),
      expiresIn: Math.max(0, token.expiresAt - Date.now()),
      expiresAt: token.expiresAt,
      refreshInProgress: this.isRefreshing,
    };
  }

  /**
   * 401 HTTP 错误去重处理
   * 对标: hermes mcp_oauth_manager.py handle_401
   *
   * 同一 serverKey 的多次 401 只触发一次 OAuth 刷新流程，
   * 后续请求等待第一次处理的结果。
   */
  async handle401(
    serverKey: string,
    failedAccessToken?: string
  ): Promise<boolean> {
    const existing = this.pending401s.get(serverKey);
    if (existing) {
      logger.debug(`401 dedup: sharing pending refresh for ${serverKey}`);
      return existing;
    }

    const promise = this.doHandle401(serverKey, failedAccessToken);
    this.pending401s.set(serverKey, promise);

    try {
      return await promise;
    } finally {
      this.pending401s.delete(serverKey);
    }
  }

  private async doHandle401(
    serverKey: string,
    failedAccessToken?: string
  ): Promise<boolean> {
    const token = this.getCachedToken(serverKey);
    if (!token) return false;

    // 如果失败 token 与当前缓存的不同，说明已被其他请求刷新过
    if (failedAccessToken && token.accessToken !== failedAccessToken) {
      return true;
    }

    const refreshCb = this.refreshCallbacks.get(serverKey);
    if (!refreshCb) return false;

    try {
      const newToken = await refreshCb(token.refreshToken);
      await this.cacheToken(serverKey, newToken);
      logger.info(`401 handled: token refreshed for ${serverKey}`);
      return true;
    } catch (err) {
      logger.warn(`401 handle failed for ${serverKey}`);
      return false;
    }
  }

  /**
   * 带重试的Token刷新
   * 参考CC源码的refreshOAuthToken重试机制
   */
  private async refreshTokenWithRetry(
    serverKey: string,
    refreshToken: string,
    refreshFn: TokenRefreshFn,
    retryCount: number = 0
  ): Promise<string> {
    try {
      const newToken = await refreshFn(refreshToken);
      await this.cacheToken(serverKey, newToken);
      this.refreshRetryCount = 0; // 重置重试计数
      logger.info(`Token refreshed successfully for ${serverKey}`);
      return newToken.accessToken;
    } catch (error) {
      this.refreshRetryCount++;
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `Token refresh failed for ${serverKey} (attempt ${this.refreshRetryCount}/${this.config.maxRetries}):`,
        e
      );

      if (this.refreshRetryCount >= this.config.maxRetries) {
        logger.error(
          `Max refresh retries reached for ${serverKey}, clearing token`
        );
        this.clearToken(serverKey);
        throw new AppError(
          `Token refresh failed after ${this.config.maxRetries} retries`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }

      // 指数退避重试
      const delay = Math.min(
        this.config.retryBaseDelayMs * Math.pow(2, this.refreshRetryCount),
        this.config.maxRetryDelayMs
      );
      logger.info(`Retrying token refresh in ${delay}ms`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.refreshTokenWithRetry(
        serverKey,
        refreshToken,
        refreshFn,
        retryCount + 1
      );
    }
  }

  /**
   * 调度自动刷新
   * 在Token过期前自动刷新
   */
  private scheduleAutoRefresh(
    serverKey: string,
    token: CachedToken,
    refreshFn: TokenRefreshFn
  ): void {
    // 计算刷新时间（过期前缓冲时间）
    const refreshTime =
      token.expiresAt - this.config.refreshBufferMs - Date.now();

    if (refreshTime <= 0) {
      // Token已经过期或即将过期，立即刷新
      this.refreshTokenWithRetry(
        serverKey,
        token.refreshToken,
        refreshFn
      ).catch((error) => {
        logger.error(`Immediate token refresh failed for ${serverKey}:`, error);
      });
      return;
    }

    // 调度定时刷新
    this.refreshScheduler.schedule(
      serverKey,
      async () => {
        try {
          const newToken = await refreshFn(token.refreshToken);
          await this.cacheToken(serverKey, newToken);
          logger.debug(`Auto-refreshed token for ${serverKey}`);
        } catch (error) {
          const e = error instanceof Error ? error : new Error(String(error));
          logger.error(`Auto-refresh failed for ${serverKey}:`, e);
        }
      },
      refreshTime
    );
  }

  /**
   * 获取Token管理器状态
   */
  getStatus(): {
    cachedTokens: number;
    scheduledRefreshes: number;
    isRefreshing: boolean;
  } {
    return {
      cachedTokens: this.tokenCache.size,
      scheduledRefreshes: this.refreshScheduler.getActiveCount(),
      isRefreshing: this.isRefreshing,
    };
  }

  /**
   * 重置Token管理器（用于测试）
   */
  reset(): void {
    this.tokenCache.clear();
    this.refreshScheduler.clearAll();
    this.isRefreshing = false;
    this.refreshRetryCount = 0;
  }
}

/**
 * Token刷新调度器
 * 参考CC源码的Token刷新调度实现
 */
class RefreshScheduler {
  private timers: Map<string, NodeJS.Timeout>;

  constructor() {
    this.timers = new Map();
  }

  /**
   * 调度刷新任务
   * @param serverKey 服务器标识
   * @param refreshFn 刷新函数
   * @param delay 延迟时间（毫秒）
   */
  schedule(
    serverKey: string,
    refreshFn: () => Promise<void>,
    delay: number
  ): void {
    this.clear(serverKey);

    const timer = setTimeout(async () => {
      try {
        await refreshFn();
      } catch (error) {
        const e = error instanceof Error ? error : new Error(String(error));
        logger.error(`Scheduled token refresh failed for ${serverKey}:`, e);
      }
    }, delay);

    this.timers.set(serverKey, timer);
    logger.debug(`Scheduled token refresh for ${serverKey} in ${delay}ms`);
  }

  /**
   * 清除指定服务器的刷新调度
   */
  clear(serverKey: string): void {
    const timer = this.timers.get(serverKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(serverKey);
    }
  }

  /**
   * 清除所有刷新调度
   */
  clearAll(): void {
    const timers = Array.from(this.timers.values());
    for (const timer of timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * 获取活跃调度数量
   */
  getActiveCount(): number {
    return this.timers.size;
  }
}

/**
 * 创建Token管理器实例
 */
export function createTokenManager(
  config?: Partial<TokenRefreshConfig>
): TokenManager {
  return TokenManager.getInstance(config);
}
