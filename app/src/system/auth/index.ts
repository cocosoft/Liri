// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
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

export { AuthCodeListener } from './auth-code-listener.js';

// 从统一的OAuth模块导出
export {
  OAuthService,
  oauthService,
  OAuthClient,
  TokenManager,
  OAuthDiscovery,
  type OAuthProvider,
  type OAuthToken,
  type OAuthProviderConfig,
  type AuthorizeOptions,
} from '@modules/oauth';

export {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from '@modules/oauth';

export { getOauthConfig } from './oauthConfig.js';

export { getOauthProfileFromOauthToken } from './getOauthProfile.js';

export { executePostLogin, type PostLoginOptions } from './post-login.js';

export {
  getTrustedDeviceToken,
  clearTrustedDeviceToken,
  setTrustedDeviceToken,
  enrollTrustedDevice,
} from './trusted-device.js';

export { CoreOAuthProvider, coreOAuthProvider } from './CoreOAuthProvider.js';

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
