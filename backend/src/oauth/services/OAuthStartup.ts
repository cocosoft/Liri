// @ts-nocheck
/**
 * OAuth启动预加载服务
 * 实现启动时OAuth Token并行预加载策略
 */

import { logger } from '@modules/infrastructure';
import { createOAuthStorage } from '@modules/oauth';

/**
 * OAuth启动预加载配置
 */
export interface OAuthStartupConfig {
  maxWaitMs?: number;
  enablePrefetch?: boolean;
  enableApiPreconnect?: boolean;
}

/**
 * OAuth启动预加载结果
 */
export interface OAuthStartupResult {
  tokensLoaded: number;
  prefetchSuccess: boolean;
  apiPreconnectSuccess: boolean;
  elapsedMs: number;
}

/**
 * OAuth启动预加载管理器
 * 
 * 启动时序：
 * T0: 立即返回启动进度
 * T1: 并行预加载：OAuth Token预取 + API预连接
 * T2: 解析命令行（依赖轻量模块）
 * T3: 最多等100ms，激活备用屏幕渲染启动界面
 * T4: 后台加载剩余模块（不阻塞用户输入）
 */
export class OAuthStartupManager {
  private storage: ReturnType<typeof createOAuthStorage>;
  private config: OAuthStartupConfig;

  constructor(config: OAuthStartupConfig = {}) {
    this.storage = createOAuthStorage();
    this.config = {
      maxWaitMs: 100,
      enablePrefetch: true,
      enableApiPreconnect: true,
      ...config,
    };
  }

  /**
   * 执行启动预加载
   * 在T1阶段并行预加载OAuth Token和API连接
   */
  async prefetch(): Promise<OAuthStartupResult> {
    const startTime = Date.now();
    logger.info('Starting OAuth startup prefetch...');

    const [tokensLoaded, apiPreconnectSuccess] = await Promise.allSettled([
      this.loadTokens(),
      this.preconnectApi(),
    ]);

    const result: OAuthStartupResult = {
      tokensLoaded: tokensLoaded.status === 'fulfilled' ? tokensLoaded.value : 0,
      prefetchSuccess: tokensLoaded.status === 'fulfilled',
      apiPreconnectSuccess: apiPreconnectSuccess.status === 'fulfilled' && apiPreconnectSuccess.value,
      elapsedMs: Date.now() - startTime,
    };

    logger.info(
      `OAuth startup prefetch completed in ${result.elapsedMs}ms: ` +
      `${result.tokensLoaded} tokens loaded, ` +
      `API preconnect: ${result.apiPreconnectSuccess}`
    );

    return result;
  }

  /**
   * 加载OAuth Token
   * 在后台异步执行，不阻塞启动
   */
  private async loadTokens(): Promise<number> {
    if (!this.config.enablePrefetch) {
      logger.debug('OAuth token prefetch disabled');
      return 0;
    }

    try {
      const serverKeys = await this.storage.listTokens();
      let loadedCount = 0;

      for (const serverKey of serverKeys) {
        const tokenData = await this.storage.loadToken(serverKey);
        if (tokenData && tokenData.expiresAt > Date.now()) {
          loadedCount++;
          logger.debug(`Preloaded OAuth token for ${serverKey}`);
        }
      }

      return loadedCount;
    } catch (error) {
      logger.warn('Failed to preload OAuth tokens:', error);
      return 0;
    }
  }

  /**
   * API预连接
   * 验证OAuth Token有效性并预连接API
   */
  private async preconnectApi(): Promise<boolean> {
    if (!this.config.enableApiPreconnect) {
      logger.debug('API preconnect disabled');
      return false;
    }

    try {
      const apiUrl = process.env.PY_APP_API_BASE_URL || 'https://api.pyapp.dev';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const success = response.ok;
      logger.debug(`API preconnect ${success ? 'successful' : 'failed'}`);
      return success;
    } catch (error) {
      logger.warn('API preconnect failed:', error);
      return false;
    }
  }

  /**
   * 获取预加载状态
   */
  getPrefetchStatus(): {
    enabled: boolean;
    maxWaitMs: number;
  } {
    return {
      enabled: this.config.enablePrefetch || false,
      maxWaitMs: this.config.maxWaitMs || 100,
    };
  }
}

export const oauthStartupManager = new OAuthStartupManager();
