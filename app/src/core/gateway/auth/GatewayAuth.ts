import { Logger, LogLevel } from '@modules/monitoring';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({ level: LogLevel.INFO, module: 'gateway:auth' });

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  sessionId?: string;
  role?: string;
  permissions?: string[];
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthCredentials {
  token?: string;
  apiKey?: string;
  deviceCode?: string;
  username?: string;
  password?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayAuthenticator {
  readonly name: string;
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  validateSession(sessionId: string): Promise<boolean>;
  revokeSession(sessionId: string): Promise<void>;
}

export interface AuthConfig {
  tokenExpiryMs?: number;
  maxSessionsPerUser?: number;
  enableDeviceAuth?: boolean;
}

export class GatewayAuth {
  private authenticators: Map<string, GatewayAuthenticator> = new Map();
  private config: Required<AuthConfig>;
  private activeSessions: Map<
    string,
    { userId: string; authenticator: string; expiresAt: number }
  > = new Map();
  private userSessionCount: Map<string, number> = new Map();

  constructor(config?: AuthConfig) {
    this.config = {
      tokenExpiryMs: config?.tokenExpiryMs ?? 3600_000,
      maxSessionsPerUser: config?.maxSessionsPerUser ?? 10,
      enableDeviceAuth: config?.enableDeviceAuth ?? true,
    };
  }

  registerAuthenticator(authenticator: GatewayAuthenticator): void {
    if (this.authenticators.has(authenticator.name)) {
      throw new AppError(
        `认证器 ${authenticator.name} 已存在`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.LOW
      );
    }
    this.authenticators.set(authenticator.name, authenticator);
    logger.info(`GatewayAuth: 认证器已注册 — ${authenticator.name}`);
  }

  unregisterAuthenticator(name: string): void {
    this.authenticators.delete(name);
    logger.info(`GatewayAuth: 认证器已注销 — ${name}`);
  }

  getAuthenticator(name: string): GatewayAuthenticator | undefined {
    return this.authenticators.get(name);
  }

  listAuthenticators(): string[] {
    return Array.from(this.authenticators.keys());
  }

  async authenticate(
    credentials: AuthCredentials,
    preferredAuthenticator?: string
  ): Promise<AuthResult> {
    if (this.authenticators.size === 0) {
      return { authenticated: true };
    }

    const authenticators = preferredAuthenticator
      ? ([this.authenticators.get(preferredAuthenticator)].filter(
          Boolean
        ) as GatewayAuthenticator[])
      : Array.from(this.authenticators.values());

    for (const authenticator of authenticators) {
      try {
        const result = await authenticator.authenticate(credentials);
        if (result.authenticated && result.userId) {
          const sessionCount = this.userSessionCount.get(result.userId) ?? 0;
          if (sessionCount >= this.config.maxSessionsPerUser) {
            return {
              authenticated: false,
              reason: `用户 ${result.userId} 的会话数已达上限 (${this.config.maxSessionsPerUser})`,
            };
          }

          const sessionId =
            result.sessionId ?? `${result.userId}_${Date.now()}`;
          this.activeSessions.set(sessionId, {
            userId: result.userId,
            authenticator: authenticator.name,
            expiresAt: Date.now() + this.config.tokenExpiryMs,
          });
          this.userSessionCount.set(result.userId, sessionCount + 1);

          logger.info(
            `GatewayAuth: 用户 ${result.userId} 认证成功 (${authenticator.name})`
          );

          return {
            ...result,
            sessionId: result.sessionId ?? sessionId,
            metadata: { ...result.metadata, authenticator: authenticator.name },
          };
        }
      } catch (error) {
        logger.warning(`GatewayAuth: 认证器 ${authenticator.name} 执行异常`, {
          error: String(error),
        });
      }
    }

    return { authenticated: false, reason: '所有认证器均未通过' };
  }

  async validateSession(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(sessionId);
      this.decrementSessionCount(session.userId);
      return false;
    }
    const authenticator = this.authenticators.get(session.authenticator);
    if (!authenticator) return false;
    return authenticator.validateSession(sessionId);
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const authenticator = this.authenticators.get(session.authenticator);
    if (authenticator) {
      await authenticator.revokeSession(sessionId);
    }

    this.activeSessions.delete(sessionId);
    this.decrementSessionCount(session.userId);
    logger.info(`GatewayAuth: 会话已注销 — ${sessionId}`);
  }

  revokeUserSessions(userId: string): number {
    const toRemove: string[] = [];
    for (const [sessionId, session] of this.activeSessions) {
      if (session.userId === userId) {
        toRemove.push(sessionId);
      }
    }
    for (const sessionId of toRemove) {
      this.activeSessions.delete(sessionId);
    }
    this.userSessionCount.delete(userId);
    logger.info(
      `GatewayAuth: 用户 ${userId} 的所有会话已注销 (${toRemove.length} 个)`
    );
    return toRemove.length;
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  getActiveSessions(): Array<{
    sessionId: string;
    userId: string;
    authenticator: string;
    expiresAt: number;
  }> {
    return Array.from(this.activeSessions.entries()).map(
      ([sessionId, session]) => ({
        sessionId,
        ...session,
      })
    );
  }

  private decrementSessionCount(userId: string): void {
    const count = this.userSessionCount.get(userId) ?? 1;
    if (count <= 1) {
      this.userSessionCount.delete(userId);
    } else {
      this.userSessionCount.set(userId, count - 1);
    }
  }
}
