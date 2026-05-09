/**
 * JWT令牌管理工具
 * 负责JWT令牌的解析、验证和刷新
 */

import { decode, JwtPayload, verify } from 'jsonwebtoken';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 令牌刷新调度器选项
 */
interface TokenRefreshSchedulerOptions {
  /** 获取访问令牌的函数 */
  getAccessToken: () => string | undefined | Promise<string | undefined>;
  /** 令牌刷新回调 */
  onRefresh: (sessionId: string, token: string) => void;
  /** 刷新失败回调 */
  onRefreshFailed?: (sessionId: string, error: Error) => void;
  /** 刷新成功回调 */
  onRefreshSuccess?: (sessionId: string) => void;
  /** 标签 */
  label: string;
  /** 提前刷新时间（毫秒），默认5分钟 */
  refreshLeadTimeMs?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 重试间隔（毫秒） */
  retryIntervalMs?: number;
}

/**
 * 令牌刷新状态
 */
interface TokenRefreshState {
  sessionId: string;
  timer: NodeJS.Timeout;
  retryCount: number;
}

/**
 * 令牌刷新调度器
 */
class TokenRefreshScheduler {
  private readonly getAccessToken: () =>
    | string
    | undefined
    | Promise<string | undefined>;
  private readonly onRefresh: (sessionId: string, token: string) => void;
  private readonly onRefreshFailed?: (sessionId: string, error: Error) => void;
  private readonly onRefreshSuccess?: (sessionId: string) => void;
  private readonly label: string;
  private readonly refreshLeadTimeMs: number;
  private readonly maxRetries: number;
  private readonly retryIntervalMs: number;
  private refreshStates: Map<string, TokenRefreshState> = new Map();

  constructor(options: TokenRefreshSchedulerOptions) {
    this.getAccessToken = options.getAccessToken;
    this.onRefresh = options.onRefresh;
    this.onRefreshFailed = options.onRefreshFailed;
    this.onRefreshSuccess = options.onRefreshSuccess;
    this.label = options.label;
    this.refreshLeadTimeMs = options.refreshLeadTimeMs || 5 * 60 * 1000;
    this.maxRetries = options.maxRetries || 3;
    this.retryIntervalMs = options.retryIntervalMs || 30 * 1000;
  }

  /**
   * 解析JWT令牌
   */
  private parseToken(token: string): JwtPayload | null {
    try {
      return decode(token, { complete: false }) as JwtPayload;
    } catch (error) {
      return null;
    }
  }

  /**
   * 验证JWT令牌（不验证签名，仅检查结构）
   */
  private validateTokenStructure(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      // 尝试解码payload部分
      Buffer.from(parts[1], 'base64url').toString('utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 计算令牌过期时间
   */
  private getTokenExpiry(token: string): number | null {
    const payload = this.parseToken(token);
    return payload?.exp ? payload.exp * 1000 : null;
  }

  /**
   * 获取令牌剩余时间（毫秒）
   */
  private getTokenRemainingTime(token: string): number | null {
    const expiry = this.getTokenExpiry(token);
    if (!expiry) return null;
    return expiry - Date.now();
  }

  /**
   * 检查令牌是否即将过期
   */
  isTokenExpiringSoon(token: string, thresholdMs?: number): boolean {
    const remaining = this.getTokenRemainingTime(token);
    if (remaining === null) return true;
    return remaining < (thresholdMs || this.refreshLeadTimeMs);
  }

  /**
   * 检查令牌是否已过期
   */
  isTokenExpired(token: string): boolean {
    const remaining = this.getTokenRemainingTime(token);
    if (remaining === null) return true;
    return remaining <= 0;
  }

  /**
   * 调度令牌刷新
   */
  schedule(sessionId: string, sessionIngressToken: string): void {
    // 清除现有的定时器
    this.cancel(sessionId);

    // 验证令牌结构
    if (!this.validateTokenStructure(sessionIngressToken)) {
      logger.warning(
        `${this.label}: Invalid token structure for session ${sessionId}`
      );
      return;
    }

    // 计算令牌过期时间
    const expiry = this.getTokenExpiry(sessionIngressToken);
    if (!expiry) {
      logger.warning(
        `${this.label}: Cannot determine token expiry for session ${sessionId}`
      );
      return;
    }

    // 计算刷新时间（过期前指定时间）
    const refreshTime = expiry - this.refreshLeadTimeMs;
    const now = Date.now();

    // 如果已经过了刷新时间，立即刷新
    if (refreshTime <= now) {
      this.refreshToken(sessionId, 0);
      return;
    }

    // 设置定时器
    const delay = refreshTime - now;
    const timer = setTimeout(() => {
      this.refreshToken(sessionId, 0);
    }, delay);

    this.refreshStates.set(sessionId, {
      sessionId,
      timer,
      retryCount: 0,
    });

    logger.debug(
      `${this.label}: Scheduled token refresh for session ${sessionId} in ${delay}ms`
    );
  }

  /**
   * 立即刷新令牌
   */
  async refreshNow(sessionId: string): Promise<void> {
    await this.refreshToken(sessionId, 0);
  }

  /**
   * 刷新令牌
   */
  private async refreshToken(
    sessionId: string,
    retryCount: number
  ): Promise<void> {
    try {
      const token = await this.getAccessToken();
      if (token) {
        this.onRefresh(sessionId, token);
        this.onRefreshSuccess?.(sessionId);
        // 重置重试计数
        const state = this.refreshStates.get(sessionId);
        if (state) {
          state.retryCount = 0;
        }
        logger.debug(
          `${this.label}: Token refreshed successfully for session ${sessionId}`
        );
      } else {
        throw new Error('Access token not available');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `${this.label}: Failed to refresh token for session ${sessionId}`,
        err.message
      );

      // 触发失败回调
      this.onRefreshFailed?.(sessionId, err);

      // 尝试重试
      if (retryCount < this.maxRetries) {
        const nextRetryCount = retryCount + 1;
        logger.debug(
          `${this.label}: Retrying token refresh for session ${sessionId} (attempt ${nextRetryCount}/${this.maxRetries})`
        );

        const timer = setTimeout(() => {
          this.refreshToken(sessionId, nextRetryCount);
        }, this.retryIntervalMs);

        this.refreshStates.set(sessionId, {
          sessionId,
          timer,
          retryCount: nextRetryCount,
        });
      } else {
        logger.error(
          `${this.label}: Max retries exceeded for session ${sessionId}, cancelling refresh`
        );
        this.cancel(sessionId);
      }
    }
  }

  /**
   * 取消令牌刷新
   */
  cancel(sessionId: string): void {
    const state = this.refreshStates.get(sessionId);
    if (state) {
      clearTimeout(state.timer);
      this.refreshStates.delete(sessionId);
      logger.debug(
        `${this.label}: Cancelled token refresh for session ${sessionId}`
      );
    }
  }

  /**
   * 检查是否有活动的刷新调度
   */
  hasScheduledRefresh(sessionId: string): boolean {
    return this.refreshStates.has(sessionId);
  }

  /**
   * 获取调度的刷新时间
   */
  getScheduledRefreshTime(sessionId: string): number | null {
    const state = this.refreshStates.get(sessionId);
    if (!state) return null;
    // 无法从timeout获取精确时间，返回null表示有调度但时间未知
    return Date.now() + this.retryIntervalMs; // 近似值
  }

  /**
   * 获取活动调度数量
   */
  getActiveRefreshCount(): number {
    return this.refreshStates.size;
  }

  /**
   * 清除所有定时器
   */
  clear(): void {
    for (const state of this.refreshStates.values()) {
      clearTimeout(state.timer);
    }
    this.refreshStates.clear();
    logger.debug(`${this.label}: Cleared all token refresh schedulers`);
  }

  /**
   * 重新调度所有活动的刷新
   */
  rescheduleAll(): void {
    const sessionIds = Array.from(this.refreshStates.keys());
    logger.debug(
      `${this.label}: Rescheduling ${sessionIds.length} token refresh(es)`
    );
    // 注意：需要外部提供新的令牌才能重新调度
    // 这里只是取消现有调度，需要调用者重新调用schedule
    this.clear();
  }
}

/**
 * 创建令牌刷新调度器
 */
export function createTokenRefreshScheduler(
  options: TokenRefreshSchedulerOptions
): TokenRefreshScheduler {
  return new TokenRefreshScheduler(options);
}

/**
 * 解析JWT令牌payload
 */
export function parseJwtToken(token: string): JwtPayload | null {
  try {
    return decode(token, { complete: false }) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * 获取令牌过期时间戳（毫秒）
 */
export function getTokenExpiryMs(token: string): number | null {
  const payload = parseJwtToken(token);
  return payload?.exp ? payload.exp * 1000 : null;
}

/**
 * 检查令牌是否过期
 */
export function isTokenExpired(token: string): boolean {
  const expiry = getTokenExpiryMs(token);
  if (!expiry) return true;
  return Date.now() >= expiry;
}

/**
 * 检查令牌是否即将过期
 */
export function isTokenExpiringSoon(
  token: string,
  thresholdMs: number = 5 * 60 * 1000
): boolean {
  const expiry = getTokenExpiryMs(token);
  if (!expiry) return true;
  return expiry - Date.now() < thresholdMs;
}

/**
 * 获取令牌剩余时间（毫秒）
 */
export function getTokenRemainingTimeMs(token: string): number | null {
  const expiry = getTokenExpiryMs(token);
  if (!expiry) return null;
  return expiry - Date.now();
}
