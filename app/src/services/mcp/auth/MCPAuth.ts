/**
 * MCP OAuth认证管理器
 * 集成OAuth Discovery和Token持久化功能
 */

import { createHash, randomBytes } from 'crypto';
import { MCPOAuthConfig, MCPOAuthToken, MCPOAuthState } from './types.js';
import { feature } from '@modules/featureflags';
import { OAuthDiscovery, createOAuthStorage } from '@modules/oauth';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = new Logger({
  module: 'services:mcp:auth:MCPAuth',
  level: LogLevel.INFO,
});

export class MCPAuthManager {
  private tokens: Map<string, MCPOAuthToken> = new Map();
  private states: Map<string, MCPOAuthState> = new Map();
  private discovery: OAuthDiscovery;
  private storage: ReturnType<typeof createOAuthStorage>;

  /** 401 去重：同一 serverKey 多次 401 只触发一次 OAuth 刷新（对标 hermes handle_401） */
  private pending401s = new Map<string, Promise<boolean>>();

  constructor() {
    this.discovery = new OAuthDiscovery();
    this.storage = createOAuthStorage();
    this.loadPersistedTokens();
  }

  private async loadPersistedTokens(): Promise<void> {
    try {
      const keys = await this.storage.listKeys();
      for (const serverKey of keys) {
        const tokenData = await this.storage.loadToken(serverKey);
        if (tokenData && tokenData.expiresAt > Date.now()) {
          this.tokens.set(serverKey, {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            expiresAt: tokenData.expiresAt,
            scopes: tokenData.scopes ?? [],
          });
          logger.debug(`Loaded persisted token for server: ${serverKey}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to load persisted OAuth tokens', {
        error: String(error),
      });
    }
  }

  async getAccessToken(
    serverKey: string,
    config: MCPOAuthConfig
  ): Promise<string> {
    if (!feature('MCP_OAUTH')) {
      throw new AppError(
        'MCP OAuth feature is not enabled',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const cached = this.tokens.get(serverKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.accessToken;
    }

    if (cached?.refreshToken) {
      return this.refreshToken(serverKey, cached.refreshToken, config);
    }

    return this.obtainNewToken(serverKey, config);
  }

  async initiateAuth(
    config: MCPOAuthConfig
  ): Promise<{ authUrl: string; state: string }> {
    const state = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    const oauthState: MCPOAuthState = {
      state,
      codeVerifier,
      codeChallenge,
      timestamp: Date.now(),
    };

    this.states.set(state, oauthState);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    if (config.scopes && config.scopes.length > 0) {
      params.set('scope', config.scopes.join(' '));
    }

    const authUrl = `${config.authUrl}?${params.toString()}`;

    return { authUrl, state };
  }

  async handleCallback(
    serverKey: string,
    code: string,
    state: string,
    config: MCPOAuthConfig
  ): Promise<MCPOAuthToken> {
    const oauthState = this.states.get(state);
    if (!oauthState) {
      throw new AppError(
        'Invalid OAuth state',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (Date.now() - oauthState.timestamp > 300000) {
      this.states.delete(state);
      throw new AppError(
        'OAuth state expired',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    this.states.delete(state);

    const token = await this.exchangeCodeForToken(
      serverKey,
      code,
      oauthState,
      config
    );
    return token;
  }

  private async exchangeCodeForToken(
    serverKey: string,
    code: string,
    state: MCPOAuthState,
    config: MCPOAuthConfig
  ): Promise<MCPOAuthToken> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: state.codeVerifier,
    });

    if (config.clientSecret) {
      params.set('client_secret', config.clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new AppError(
        `OAuth token exchange failed: ${response.status}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = await response.json();
    const token: MCPOAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      tokenType: data.token_type,
      scopes: data.scope?.split(' '),
    };

    this.tokens.set(serverKey, token);

    await this.storage.saveToken(serverKey, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || '',
      expiresAt: token.expiresAt,
      tokenType: token.tokenType || 'Bearer',
      scopes: token.scopes,
    });

    return token;
  }

  private async obtainNewToken(
    serverKey: string,
    config: MCPOAuthConfig
  ): Promise<string> {
    if (!config.clientSecret) {
      throw new AppError(
        'Client credentials flow requires clientSecret',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    if (config.scopes && config.scopes.length > 0) {
      params.set('scope', config.scopes.join(' '));
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new AppError(
        `OAuth token request failed: ${response.status}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = await response.json();
    const token: MCPOAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      tokenType: data.token_type,
    };

    this.tokens.set(serverKey, token);

    await this.storage.saveToken(serverKey, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || '',
      expiresAt: token.expiresAt,
      tokenType: token.tokenType || 'Bearer',
    });

    return token.accessToken;
  }

  private async refreshToken(
    serverKey: string,
    refreshToken: string,
    config: MCPOAuthConfig
  ): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
    });

    if (config.clientSecret) {
      params.set('client_secret', config.clientSecret);
    }

    const response = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      this.tokens.delete(serverKey);
      throw new AppError(
        `OAuth token refresh failed: ${response.status}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const data = await response.json();
    const token: MCPOAuthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      tokenType: data.token_type,
    };

    this.tokens.set(serverKey, token);

    await this.storage.saveToken(serverKey, {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || '',
      expiresAt: token.expiresAt,
      tokenType: token.tokenType || 'Bearer',
    });

    return token.accessToken;
  }

  async revokeToken(serverKey: string, config: MCPOAuthConfig): Promise<void> {
    const token = this.tokens.get(serverKey);
    if (!token) return;

    const revocationUrl = config.tokenUrl.replace('/token', '/revoke');

    if (token.refreshToken) {
      await this.revokeSingleToken(
        revocationUrl,
        token.refreshToken,
        'refresh_token',
        config
      );
    }

    await this.revokeSingleToken(
      revocationUrl,
      token.accessToken,
      'access_token',
      config
    );

    this.tokens.delete(serverKey);
    await this.storage.deleteToken(serverKey);
  }

  private async revokeSingleToken(
    endpoint: string,
    token: string,
    tokenTypeHint: string,
    config: MCPOAuthConfig
  ): Promise<void> {
    try {
      const params = new URLSearchParams({
        token,
        token_type_hint: tokenTypeHint,
        client_id: config.clientId,
      });

      if (config.clientSecret) {
        params.set('client_secret', config.clientSecret);
      }

      await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (err) {
      // Revocation is best-effort
    }
  }

  invalidateToken(serverKey: string): void {
    this.tokens.delete(serverKey);
    this.storage.deleteToken(serverKey).catch((err) => {
      logger.warn(`Failed to delete persisted token for ${serverKey}:`, err);
    });
  }

  /**
   * 401 HTTP 错误去重处理
   * 对标 hermes: mcp_oauth_manager.py handle_401
   *
   * 同一 serverKey 的多次 401 只触发一次 OAuth 刷新流程，
   * 后续请求等待第一次处理的结果，避免并发刷新竞态。
   *
   * @param serverKey 服务器标识
   * @param failedAccessToken 触发 401 的 access token（用于验证是否需要刷新）
   * @param config OAuth 配置
   * @returns 是否成功处理（刷新成功或已由其他请求处理）
   */
  async handle401(
    serverKey: string,
    failedAccessToken: string,
    config: MCPOAuthConfig
  ): Promise<boolean> {
    // 如果已有相同 serverKey 的 401 在处理中，共享结果
    const existing = this.pending401s.get(serverKey);
    if (existing) {
      logger.debug(`401 dedup: sharing pending refresh for ${serverKey}`);
      return existing;
    }

    const promise = this.doHandle401(serverKey, failedAccessToken, config);
    this.pending401s.set(serverKey, promise);

    try {
      return await promise;
    } finally {
      this.pending401s.delete(serverKey);
    }
  }

  private async doHandle401(
    serverKey: string,
    failedAccessToken: string,
    config: MCPOAuthConfig
  ): Promise<boolean> {
    const token = this.tokens.get(serverKey);
    if (!token) return false;

    // 如果失败 token 与当前缓存已不同，说明已被其他请求刷新过
    if (token.accessToken !== failedAccessToken) {
      return true;
    }

    if (!token.refreshToken) {
      // 无 refresh token，只能重新授权
      return false;
    }

    try {
      await this.refreshToken(serverKey, token.refreshToken, config);
      logger.info(`401 handled: token refreshed for ${serverKey}`);
      return true;
    } catch (err) {
      logger.warn(
        `401 handle failed for ${serverKey}: ${err instanceof Error ? err.message : String(err)}`
      );
      this.tokens.delete(serverKey);
      return false;
    }
  }

  hasToken(serverKey: string): boolean {
    const token = this.tokens.get(serverKey);
    return token !== undefined && token.expiresAt > Date.now();
  }

  clearAllTokens(): void {
    this.tokens.clear();
    this.storage.deleteAllTokens().catch((err: Error) => {
      logger.warn('Failed to clear all persisted tokens:', err);
    });
  }

  async discoverOAuthMetadata(authServerUrl: string) {
    try {
      const result = await this.discovery.discoverMetadata(authServerUrl);
      logger.info(`MCP OAuth discovery successful for ${authServerUrl}`);
      return result;
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:auth',
        action: 'MCP OAuth发现失败',
      });
      throw error;
    }
  }
}

export const mcpAuthManager = new MCPAuthManager();
