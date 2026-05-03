// @ts-nocheck
/**
 * 认证模块
 * 
 * @deprecated Use @modules/oauth for OAuth functionality
 */

export {
  DefaultAuthManager,
  getAuthManager,
  setAuthManager,
  createAuthManager,
  type OAuthTokens,
  type CloudCredentials,
  type CloudProvider,
  type AuthConfig,
  type AuthManager,
} from './AuthManager.js';

export {
  AuthCodeListener,
} from './auth-code-listener.js';

// 从统一的OAuth模块导出
export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  OAuthService,
  oauthService,
  OAuthClient,
  OAuthTokenManager,
  OAuthDiscovery,
  type OAuthProvider,
  type OAuthToken,
  type OAuthProviderConfig,
  type AuthorizeOptions,
} from '@modules/oauth';

export {
  getOauthConfig,
} from './oauthConfig.js';

export {
  getOauthProfileFromOauthToken,
} from './getOauthProfile.js';

export {
  executePostLogin,
  type PostLoginOptions,
} from './post-login.js';

export {
  getTrustedDeviceToken,
  clearTrustedDeviceToken,
  setTrustedDeviceToken,
  enrollTrustedDevice,
} from './trusted-device.js';

export {
  CoreOAuthProvider,
  coreOAuthProvider,
} from './CoreOAuthProvider.js';

export type {
  OAuthTokens as OAuthTokensType,
  OAuthTokenExchangeResponse,
  OAuthProfileResponse,
  OAuthConfig,
  OAuthProfileInfo,
  OAuthServiceOptions,
  SubscriptionType,
  RateLimitTier,
} from './oauth-types.js';