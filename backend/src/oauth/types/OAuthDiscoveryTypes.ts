/**
 * OAuth Discovery类型定义
 * 基于RFC 8414标准
 */

/**
 * OAuth元数据发现结果
 */
export interface OAuthDiscoveryResult {
  metadata: OAuthServerMetadata;
  discoveredAt: number;
  expiresAt?: number;
  source: 'well-known' | 'fallback' | 'manual';
}

/**
 * OAuth服务器元数据（RFC 8414）
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
  responseModesSupported?: string[];
  grantTypesSupported?: string[];
  tokenEndpointAuthMethodsSupported?: string[];
  tokenEndpointAuthSigningAlgValuesSupported?: string[];
  serviceDocumentation?: string;
  uiLocalesSupported?: string[];
  opPolicyUri?: string;
  opTosUri?: string;
  revocationEndpoint?: string;
  revocationEndpointAuthMethodsSupported?: string[];
  revocationEndpointAuthSigningAlgValuesSupported?: string[];
  introspectionEndpoint?: string;
  introspectionEndpointAuthMethodsSupported?: string[];
  introspectionEndpointAuthSigningAlgValuesSupported?: string[];
  codeChallengeMethodsSupported?: string[];
}

/**
 * Discovery配置
 */
export interface DiscoveryConfig {
  timeout?: number;
  retries?: number;
  cacheEnabled?: boolean;
  cacheDuration?: number;
  fallbackUrls?: string[];
}

/**
 * Discovery缓存条目
 */
export interface DiscoveryCacheEntry {
  result: OAuthDiscoveryResult;
  cachedAt: number;
  expiresAt: number;
}
