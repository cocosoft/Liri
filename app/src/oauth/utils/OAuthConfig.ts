/**
 * OAuth配置管理工具
 */

import type { OAuthConfig } from '../types/OAuthTypes';

/**
 * 创建OAuth配置
 */
export function createOAuthConfig(options: {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl?: string;
  clientId: string;
  scopes: string[];
  successUrl?: string;
  manualRedirectUrl?: string;
}): OAuthConfig {
  return {
    authorizeUrl: options.authorizeUrl,
    tokenUrl: options.tokenUrl,
    profileUrl: options.profileUrl || '',
    successUrl: options.successUrl || 'https://pyapp.dev/auth/success',
    manualRedirectUrl:
      options.manualRedirectUrl || 'https://pyapp.dev/auth/manual',
    clientId: options.clientId,
    scopes: options.scopes,
  };
}
