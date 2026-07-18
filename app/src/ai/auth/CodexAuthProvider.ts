// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * CodexAuthProvider — ChatGPT/Codex OAuth 认证模块
 *
 * 管理 OpenAI Codex OAuth 令牌的获取和刷新。
 * 用于 OpenAICodexProvider 的无 API Key 生图方案。
 *
 * 认证流程：
 * 1. 用户在模型管理 UI 点击 "ChatGPT 登录"
 * 2. 打开浏览器授权页面
 * 3. OAuth 回调获取 access_token
 * 4. 通过 TokenManager 持久化到加密磁盘存储
 */
import { Logger, LogLevel } from '@modules/monitoring';
import { TokenManager } from '@modules/oauth';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:codex-auth' });

/** TokenManager 中使用的服务器标识 */
const TOKEN_SERVER_KEY = 'codex';

/** OAuth 令牌 */
export interface CodexToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

export class CodexAuthProvider {
  private static instance: CodexAuthProvider;
  private currentToken: CodexToken | null = null;
  private tokenManager: TokenManager;

  private constructor() {
    this.tokenManager = TokenManager.getInstance();
  }

  static getInstance(): CodexAuthProvider {
    if (!this.instance) {
      this.instance = new CodexAuthProvider();
    }
    return this.instance;
  }

  /**
   * 获取当前有效令牌
   * 自动从 TokenManager 磁盘存储恢复（AES-256-GCM 加密）
   */
  async getToken(): Promise<CodexToken | null> {
    if (this.currentToken && !this.isExpired()) {
      return this.currentToken;
    }

    try {
      const cached = this.tokenManager.getCachedToken(TOKEN_SERVER_KEY);
      if (cached && cached.expiresAt > Date.now()) {
        this.currentToken = {
          accessToken: cached.accessToken,
          refreshToken: cached.refreshToken,
          expiresAt: cached.expiresAt,
          tokenType: cached.tokenType ?? 'bearer',
        };
        return this.currentToken;
      }
    } catch (err) {
      // 无有效存储
    }

    return null;
  }

  /**
   * 存储令牌（从 OAuth 回调获取）
   */
  storeToken(token: CodexToken): void {
    this.currentToken = token;
    this.tokenManager
      .cacheToken(TOKEN_SERVER_KEY, {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken ?? '',
        expiresAt: token.expiresAt,
        tokenType: token.tokenType ?? 'bearer',
      })
      .catch((err) => {
        logger.warn('CodexAuthProvider · 令牌持久化失败', {
          error: (err as Error).message,
        });
      });

    logger.info('CodexAuthProvider · 令牌已存储', {
      expiresAt: new Date(token.expiresAt).toISOString(),
    });
  }

  /** 清除令牌（登出） */
  clearToken(): void {
    this.currentToken = null;
    this.tokenManager.clearToken(TOKEN_SERVER_KEY);
  }

  /** 检查令牌是否过期（含 5 分钟缓冲） */
  isExpired(): boolean {
    if (!this.currentToken) return true;
    return this.currentToken.expiresAt <= Date.now() + 5 * 60 * 1000;
  }

  /** 检查是否已认证 */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
