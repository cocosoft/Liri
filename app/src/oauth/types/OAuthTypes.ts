/**
 * OAuth核心类型定义
 */

/**
 * OAuth Token数据结构
 */
export interface OAuthTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
}

export type OAuthTokens = OAuthTokenData;

/**
 * OAuth服务器元数据
 */
export interface OAuthServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint?: string;
  jwksUri?: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  responseTypesSupported?: string[];
  grantTypesSupported?: string[];
  tokenEndpointAuthMethodsSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

/**
 * OAuth配置
 */
export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  successUrl?: string;
  manualRedirectUrl?: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  redirectUri?: string;
}

/**
 * OAuth认证结果
 */
export interface OAuthAuthResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scopes: string[];
}

/**
 * OAuth错误类型
 */
export class OAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}
