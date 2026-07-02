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
 * 4. 存储到本地会话
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO, module: 'ai:codex-auth' });

/** OAuth 令牌 */
export interface CodexToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType: string;
}

/** 持久化 key */
const TOKEN_STORAGE_KEY = 'openliri:codex:access_token';

export class CodexAuthProvider {
  private static instance: CodexAuthProvider;
  private currentToken: CodexToken | null = null;

  static getInstance(): CodexAuthProvider {
    if (!this.instance) {
      this.instance = new CodexAuthProvider();
    }
    return this.instance;
  }

  /**
   * 获取当前有效令牌
   * 自动从持久化存储恢复
   */
  async getToken(): Promise<CodexToken | null> {
    if (this.currentToken && !this.isExpired()) {
      return this.currentToken;
    }

    // 从持久化存储恢复
    try {
      const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
      if (stored) {
        const token: CodexToken = JSON.parse(stored);
        if (token.expiresAt > Date.now()) {
          this.currentToken = token;
          return token;
        }
      }
    } catch {
      // 无有效存储
    }

    return null;
  }

  /**
   * 存储令牌（从 OAuth 回调获取）
   */
  storeToken(token: CodexToken): void {
    this.currentToken = token;
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
      logger.info('CodexAuthProvider · 令牌已存储', {
        expiresAt: new Date(token.expiresAt).toISOString(),
      });
    } catch (err) {
      logger.warn('CodexAuthProvider · 令牌持久化失败', {
        error: (err as Error).message,
      });
    }
  }

  /** 清除令牌（登出） */
  clearToken(): void {
    this.currentToken = null;
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  /** 检查令牌是否过期 */
  isExpired(): boolean {
    return this.currentToken ? this.currentToken.expiresAt <= Date.now() : true;
  }

  /** 检查是否已认证 */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null && !this.isExpired();
  }
}
