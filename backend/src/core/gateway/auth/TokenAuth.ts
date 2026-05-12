import crypto from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  GatewayAuthenticator,
  AuthResult,
  AuthCredentials,
} from './GatewayAuth';

const logger = new Logger({ level: LogLevel.INFO });

export interface TokenAuthConfig {
  validTokens: Map<string, TokenUserInfo>;
  tokenExtractor?: (credentials: AuthCredentials) => string | undefined;
  tokenPrefix?: string;
  issuer?: string;
}

export interface TokenUserInfo {
  userId: string;
  role?: string;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

const BEARER_PREFIX = 'Bearer ';

function defaultTokenExtractor(
  credentials: AuthCredentials
): string | undefined {
  if (credentials.token) {
    const token = credentials.token.startsWith(BEARER_PREFIX)
      ? credentials.token.slice(BEARER_PREFIX.length)
      : credentials.token;
    return token.trim() || undefined;
  }
  return undefined;
}

export class TokenAuth implements GatewayAuthenticator {
  readonly name = 'TokenAuth';
  private config: TokenAuthConfig;
  private tokenExtractor: (credentials: AuthCredentials) => string | undefined;
  private activeTokens: Map<string, { userId: string; issuedAt: number }> =
    new Map();

  constructor(config: TokenAuthConfig) {
    this.config = config;
    this.tokenExtractor = config.tokenExtractor ?? defaultTokenExtractor;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const rawToken = this.tokenExtractor(credentials);
    if (!rawToken) {
      return { authenticated: false, reason: '未提供令牌' };
    }

    const userInfo = this.config.validTokens.get(rawToken);
    if (!userInfo) {
      return { authenticated: false, reason: '令牌无效' };
    }

    const sessionId = this.generateSessionId(userInfo.userId);
    this.activeTokens.set(rawToken, {
      userId: userInfo.userId,
      issuedAt: Date.now(),
    });

    logger.info(`TokenAuth: 用户 ${userInfo.userId} 令牌认证成功`);

    return {
      authenticated: true,
      userId: userInfo.userId,
      sessionId,
      role: userInfo.role,
      permissions: userInfo.permissions,
      metadata: { ...userInfo.metadata, tokenAuth: true },
    };
  }

  async validateSession(sessionId: string): Promise<boolean> {
    for (const [, session] of this.activeTokens) {
      if (`${session.userId}_${session.issuedAt}` === sessionId) {
        return true;
      }
    }
    return false;
  }

  async revokeSession(sessionId: string): Promise<void> {
    for (const [token, session] of this.activeTokens) {
      if (`${session.userId}_${session.issuedAt}` === sessionId) {
        this.activeTokens.delete(token);
        logger.info(`TokenAuth: 会话已撤销 — ${sessionId}`);
        return;
      }
    }
  }

  revokeToken(token: string): void {
    this.activeTokens.delete(token);
    logger.info('TokenAuth: 令牌已撤销');
  }

  addToken(token: string, userInfo: TokenUserInfo): void {
    this.config.validTokens.set(token, userInfo);
    logger.info(`TokenAuth: 令牌已添加 — 用户 ${userInfo.userId}`);
  }

  removeToken(token: string): boolean {
    const removed = this.config.validTokens.delete(token);
    if (removed) {
      this.activeTokens.delete(token);
      logger.info('TokenAuth: 令牌已移除');
    }
    return removed;
  }

  generateToken(userId: string, role?: string, permissions?: string[]): string {
    const raw = crypto.randomBytes(32).toString('hex');
    const token = `${this.config.issuer ?? 'gw'}_${raw}`;
    this.addToken(token, { userId, role, permissions });
    return token;
  }

  getActiveTokenCount(): number {
    return this.activeTokens.size;
  }

  private generateSessionId(userId: string): string {
    return `${userId}_${Date.now()}`;
  }
}
