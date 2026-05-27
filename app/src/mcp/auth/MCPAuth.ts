/**
 * MCP OAuth认证管理器
 * 集成OAuth Discovery和Token持久化功能
 */

import { createHash, randomBytes } from 'crypto';
import { MCPOAuthConfig, MCPOAuthToken, MCPOAuthState } from './types.js';
import { feature } from '@modules/featureflags';
import { OAuthDiscovery, createOAuthStorage } from '@modules/oauth';
import { logger } from '@modules/infrastructure';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

export class MCPAuthManager {
  private tokens: Map<string, MCPOAuthToken> = new Map();
  private states: Map<string, MCPOAuthState> = new Map();
  private discovery: OAuthDiscovery;
  private storage: ReturnType<typeof createOAuthStorage>;

  constructor() {
    this.discovery = new OAuthDiscovery();
    this.storage = createOAuthStorage();
    this.loadPersistedTokens();
  }

  private async loadPersistedTokens(): Promise<void> {
    try {
      const allTokens = await this.storage.loadAllTokens();
      for (const [serverKey, tokenData] of Object.entries(allTokens)) {
        if (tokenData && tokenData.expiresAt > Date.now()) {
          this.tokens.set(serverKey, {
            accessToken: tokenData.accessToken,
            refreshToken: tokenData.refreshToken,
            expiresAt: tokenData.expiresAt,
            scopes: tokenData.scopes,
          });
          logger.debug(`Loaded persisted token for server: ${serverKey}`);
        }
      }
    } catch (error) {
      logger.warn('Failed to load persisted OAuth tokens', { error });
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
      serverKey,
      savedAt: Date.now(),
    } as any);

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
      serverKey,
      savedAt: Date.now(),
    } as any);

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
      serverKey,
      savedAt: Date.now(),
    } as any);

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
    } catch {
      // Revocation is best-effort
    }
  }

  invalidateToken(serverKey: string): void {
    this.tokens.delete(serverKey);
    this.storage.deleteToken(serverKey).catch((err) => {
      logger.warn(`Failed to delete persisted token for ${serverKey}:`, err);
    });
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
      logger.error(
        `MCP OAuth discovery failed for ${authServerUrl}:`,
        error as Error
      );
      throw error;
    }
  }
}

export const mcpAuthManager = new MCPAuthManager();
