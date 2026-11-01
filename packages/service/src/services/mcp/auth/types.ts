/**
 * MCP OAuth类型定义
 */

export interface MCPOAuthConfig {
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes?: string[];
}

export interface MCPOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
}

export interface MCPOAuthState {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  timestamp: number;
}

export interface MCPOAuthDiscoveryState {
  authorizationServerUrl: string;
  metadata?: Record<string, unknown>;
  supportsPkce: boolean;
  supportsDynamicClientRegistration: boolean;
}
