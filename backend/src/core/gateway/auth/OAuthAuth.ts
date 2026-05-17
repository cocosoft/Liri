import crypto from 'node:crypto';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { createToken, decodeToken } from '@modules/bridge/jwtUtils';
import type {
  GatewayAuthenticator,
  AuthResult,
  AuthCredentials,
} from './GatewayAuth';

const logger = new Logger({ level: LogLevel.INFO });

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes: string[];
  name?: string;
}

export interface PendingAuthCode {
  code: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
  expiresAt: number;
  userId: string;
  scopes: string[];
}

export interface TokenEntry {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  userId: string;
  scopes: string[];
  expiresAt: number;
  createdAt: number;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
  scopes: string[];
}

export interface OAuthClientRegistration {
  name?: string;
  redirectUris: string[];
  allowedScopes: string[];
  grantTypes?: string[];
}

export interface OAuthAuthConfig {
  issuer?: string;
  accessTokenExpiryMs?: number;
  refreshTokenExpiryMs?: number;
  authCodeExpiryMs?: number;
  jwtSecret?: string;
}

const BEARER_PREFIX = 'Bearer ';
const DEFAULT_ACCESS_TOKEN_EXPIRY_MS = 3600_000;
const DEFAULT_REFRESH_TOKEN_EXPIRY_MS = 2_592_000_000;
const DEFAULT_AUTH_CODE_EXPIRY_MS = 300_000;
const DEFAULT_GRANT_TYPES = [
  'authorization_code',
  'client_credentials',
  'refresh_token',
];

export class OAuthAuth implements GatewayAuthenticator {
  readonly name = 'OAuthAuth';

  private clients: Map<string, OAuthClientConfig> = new Map();
  private authCodes: Map<string, PendingAuthCode> = new Map();
  private accessTokens: Map<string, TokenEntry> = new Map();
  private refreshTokens: Map<string, string> = new Map();
  private config: Required<OAuthAuthConfig>;

  constructor(config?: OAuthAuthConfig) {
    this.config = {
      issuer: config?.issuer ?? 'py-app',
      accessTokenExpiryMs:
        config?.accessTokenExpiryMs ?? DEFAULT_ACCESS_TOKEN_EXPIRY_MS,
      refreshTokenExpiryMs:
        config?.refreshTokenExpiryMs ?? DEFAULT_REFRESH_TOKEN_EXPIRY_MS,
      authCodeExpiryMs: config?.authCodeExpiryMs ?? DEFAULT_AUTH_CODE_EXPIRY_MS,
      jwtSecret: config?.jwtSecret ?? 'py-app-oauth-secret',
    };
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const rawToken = this.extractBearerToken(credentials);
    if (!rawToken) {
      return { authenticated: false, reason: '未提供令牌' };
    }

    const entry = this.accessTokens.get(rawToken);
    if (!entry) {
      return { authenticated: false, reason: '令牌无效或已过期' };
    }

    if (Date.now() > entry.expiresAt) {
      this.accessTokens.delete(rawToken);
      this.cleanupExpiredTokens();
      return { authenticated: false, reason: '令牌已过期' };
    }

    const jwtPayload = decodeToken(rawToken);
    if (!jwtPayload) {
      return { authenticated: false, reason: '令牌格式无效' };
    }

    const sessionId = jwtPayload.sessionId;

    logger.info(`OAuthAuth: 用户 ${entry.userId} OAuth 令牌认证成功`);

    return {
      authenticated: true,
      userId: entry.userId,
      sessionId,
      metadata: {
        clientId: entry.clientId,
        scopes: entry.scopes,
        oauthAuth: true,
      },
    };
  }

  async validateSession(sessionId: string): Promise<boolean> {
    for (const [, entry] of this.accessTokens) {
      const payload = decodeToken(entry.accessToken);
      if (payload && payload.sessionId === sessionId) {
        return Date.now() <= entry.expiresAt;
      }
    }
    return false;
  }

  async revokeSession(sessionId: string): Promise<void> {
    for (const [token, entry] of this.accessTokens) {
      const payload = decodeToken(entry.accessToken);
      if (payload && payload.sessionId === sessionId) {
        this.accessTokens.delete(token);
        this.refreshTokens.delete(entry.refreshToken);
        logger.info(`OAuthAuth: 会话已撤销 — ${sessionId}`);
        return;
      }
    }
  }

  generateAuthorizationUrl(
    clientId: string,
    redirectUri: string,
    codeChallenge: string,
    state: string,
    scopes?: string[]
  ): { url: string; code: string } {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new AppError(
        `客户端 ${clientId} 不存在`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }
    if (!client.redirectUris.includes(redirectUri)) {
      throw new AppError(
        `重定向 URI ${redirectUri} 未在白名单中`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    const code = this.generateAuthCode();
    const now = Date.now();

    const pendingCode: PendingAuthCode = {
      code,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: codeChallenge.length === 43 ? 'S256' : 'plain',
      expiresAt: now + this.config.authCodeExpiryMs,
      userId: '',
      scopes: scopes ?? client.allowedScopes,
    };

    this.authCodes.set(code, pendingCode);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: pendingCode.codeChallengeMethod,
    });
    if (scopes && scopes.length > 0) {
      params.set('scope', scopes.join(' '));
    }

    const url = `/oauth/authorize?${params.toString()}`;

    logger.info(`OAuthAuth: 授权码已生成 — 客户端 ${clientId}`);

    return { url, code };
  }

  exchangeAuthorizationCode(
    code: string,
    codeVerifier: string,
    clientId: string,
    clientSecret: string,
    userId: string
  ): OAuthTokenResponse {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new AppError(
        `客户端 ${clientId} 不存在`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }
    if (client.clientSecret !== clientSecret) {
      throw new AppError(
        '客户端密钥验证失败',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH
      );
    }

    const pendingCode = this.authCodes.get(code);
    if (!pendingCode) {
      throw new AppError(
        '授权码无效',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }
    if (pendingCode.clientId !== clientId) {
      throw new AppError(
        '授权码与客户端不匹配',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }
    if (Date.now() > pendingCode.expiresAt) {
      this.authCodes.delete(code);
      throw new AppError(
        '授权码已过期',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    this.verifyCodeChallenge(
      pendingCode.codeChallenge,
      pendingCode.codeChallengeMethod,
      codeVerifier
    );

    this.authCodes.delete(code);

    const tokens = this.issueTokens(clientId, userId, pendingCode.scopes);

    logger.info(`OAuthAuth: 授权码已兑换 — 用户 ${userId}`);

    return tokens;
  }

  exchangeClientCredentials(
    clientId: string,
    clientSecret: string,
    requestedScopes?: string[]
  ): OAuthTokenResponse {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new AppError(
        `客户端 ${clientId} 不存在`,
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }
    if (client.clientSecret !== clientSecret) {
      throw new AppError(
        '客户端密钥验证失败',
        ErrorCategory.PERMISSION,
        ErrorSeverity.HIGH
      );
    }
    if (!client.grantTypes.includes('client_credentials')) {
      throw new AppError(
        '客户端不支持 client_credentials 授权模式',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    const scopes = requestedScopes
      ? requestedScopes.filter((s) => client.allowedScopes.includes(s))
      : client.allowedScopes;

    const tokens = this.issueTokens(clientId, `client:${clientId}`, scopes);

    logger.info(`OAuthAuth: 客户端凭证已兑换 — ${clientId}`);

    return tokens;
  }

  refreshAccessToken(refreshToken: string): OAuthTokenResponse {
    const accessTokenKey = this.refreshTokens.get(refreshToken);
    if (!accessTokenKey) {
      throw new AppError(
        '刷新令牌无效',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    const oldEntry = this.accessTokens.get(accessTokenKey);
    if (!oldEntry) {
      this.refreshTokens.delete(refreshToken);
      throw new AppError(
        '刷新令牌已过期',
        ErrorCategory.VALIDATION,
        ErrorSeverity.MEDIUM
      );
    }

    this.accessTokens.delete(accessTokenKey);
    this.refreshTokens.delete(refreshToken);

    const tokens = this.issueTokens(
      oldEntry.clientId,
      oldEntry.userId,
      oldEntry.scopes
    );

    logger.info(`OAuthAuth: 令牌已刷新 — 用户 ${oldEntry.userId}`);

    return tokens;
  }

  registerClient(config: OAuthClientRegistration): {
    clientId: string;
    clientSecret: string;
  } {
    const clientId = `oauth_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = crypto.randomBytes(32).toString('hex');

    const client: OAuthClientConfig = {
      clientId,
      clientSecret,
      redirectUris: config.redirectUris,
      allowedScopes: config.allowedScopes,
      grantTypes: config.grantTypes ?? DEFAULT_GRANT_TYPES,
      name: config.name,
    };

    this.clients.set(clientId, client);

    logger.info(
      `OAuthAuth: 客户端已注册 — ${clientId} (${config.name ?? '未命名'})`
    );

    return { clientId, clientSecret };
  }

  unregisterClient(clientId: string): boolean {
    const removed = this.clients.delete(clientId);
    if (removed) {
      logger.info(`OAuthAuth: 客户端已注销 — ${clientId}`);
    }
    return removed;
  }

  getClient(clientId: string): OAuthClientConfig | undefined {
    const client = this.clients.get(clientId);
    if (client) {
      return { ...client, clientSecret: '' };
    }
    return undefined;
  }

  listClients(): Array<{ clientId: string; name?: string }> {
    return Array.from(this.clients.values()).map((c) => ({
      clientId: c.clientId,
      name: c.name,
    }));
  }

  validateToken(token: string): {
    valid: boolean;
    userId?: string;
    clientId?: string;
    scopes?: string[];
  } {
    const entry = this.accessTokens.get(token);
    if (!entry) {
      return { valid: false };
    }
    if (Date.now() > entry.expiresAt) {
      this.accessTokens.delete(token);
      return { valid: false };
    }
    const payload = decodeToken(token);
    if (!payload) {
      return { valid: false };
    }
    return {
      valid: true,
      userId: entry.userId,
      clientId: entry.clientId,
      scopes: entry.scopes,
    };
  }

  revokeToken(token: string): boolean {
    const entry = this.accessTokens.get(token);
    if (entry) {
      this.accessTokens.delete(token);
      this.refreshTokens.delete(entry.refreshToken);
      logger.info('OAuthAuth: 令牌已撤销');
      return true;
    }
    return false;
  }

  getActiveTokenCount(): number {
    this.cleanupExpiredTokens();
    return this.accessTokens.size;
  }

  private issueTokens(
    clientId: string,
    userId: string,
    scopes: string[]
  ): OAuthTokenResponse {
    const accessToken = this.createAccessToken(clientId, userId, scopes);
    const refreshToken = this.createRefreshToken();
    const now = Date.now();

    const entry: TokenEntry = {
      accessToken,
      refreshToken,
      clientId,
      userId,
      scopes,
      expiresAt: now + this.config.accessTokenExpiryMs,
      createdAt: now,
    };

    this.accessTokens.set(accessToken, entry);
    this.refreshTokens.set(refreshToken, accessToken);

    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(this.config.accessTokenExpiryMs / 1000),
      tokenType: 'Bearer',
      scopes,
    };
  }

  private createAccessToken(
    clientId: string,
    userId: string,
    _scopes: string[]
  ): string {
    const now = Date.now();
    const sessionId = `${userId}_oauth_${now}`;
    const payload = {
      sub: userId,
      sessionId,
      iat: now,
      exp: now + this.config.accessTokenExpiryMs,
    };
    return createToken(payload, this.config.jwtSecret);
  }

  private createRefreshToken(): string {
    return `refresh_${crypto.randomUUID().replace(/-/g, '')}_${crypto.randomBytes(16).toString('hex')}`;
  }

  private generateAuthCode(): string {
    return crypto.randomBytes(24).toString('hex');
  }

  private verifyCodeChallenge(
    codeChallenge: string,
    method: 'S256' | 'plain',
    codeVerifier: string
  ): void {
    if (method === 'plain') {
      if (codeChallenge !== codeVerifier) {
        throw new AppError(
          'PKCE 验证失败: code_verifier 不匹配',
          ErrorCategory.PERMISSION,
          ErrorSeverity.HIGH
        );
      }
    } else {
      const computedChallenge = this.base64UrlEncode(
        crypto.createHash('sha256').update(codeVerifier).digest()
      );
      if (codeChallenge !== computedChallenge) {
        throw new AppError(
          'PKCE 验证失败: code_challenge 不匹配',
          ErrorCategory.PERMISSION,
          ErrorSeverity.HIGH
        );
      }
    }
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString('base64url');
  }

  private extractBearerToken(credentials: AuthCredentials): string | undefined {
    if (credentials.token) {
      const token = credentials.token.startsWith(BEARER_PREFIX)
        ? credentials.token.slice(BEARER_PREFIX.length)
        : credentials.token;
      return token.trim() || undefined;
    }
    if (credentials.metadata?.accessToken) {
      return credentials.metadata.accessToken as string;
    }
    return undefined;
  }

  private cleanupExpiredTokens(): void {
    const now = Date.now();
    for (const [token, entry] of this.accessTokens) {
      if (now > entry.expiresAt) {
        this.accessTokens.delete(token);
        this.refreshTokens.delete(entry.refreshToken);
      }
    }
  }
}
