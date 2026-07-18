/**
 * Google OAuth Provider
 * 实现 Google OAuth 2.0 授权流程
 */

import type { UserInfo } from '../types/OAuthProvider';
import { BaseOAuthProvider } from './BaseOAuthProvider';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_PROFILE = 'https://www.googleapis.com/oauth2/v3/userinfo';

export class GoogleOAuthProvider extends BaseOAuthProvider {
  readonly id = 'google';
  readonly name = 'Google';

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes?: string[]
  ) {
    super(
      GOOGLE_AUTHORIZE,
      GOOGLE_TOKEN,
      GOOGLE_PROFILE,
      clientId,
      clientSecret,
      redirectUri,
      scopes || ['openid', 'email', 'profile']
    );
  }

  /**
   * Google 特有：支持 access_type 和 prompt 参数
   */
  override getAuthorizationUrl(options?: {
    state?: string;
    redirectUri?: string;
    scopes?: string[];
    accessType?: 'online' | 'offline';
    prompt?: 'none' | 'consent' | 'select_account';
  }): string {
    const url = super.getAuthorizationUrl(options);
    const parsed = new URL(url);
    if (options?.accessType)
      parsed.searchParams.set('access_type', options.accessType);
    if (options?.prompt) parsed.searchParams.set('prompt', options.prompt);
    return parsed.toString();
  }

  protected parseUserInfo(raw: Record<string, unknown>): UserInfo {
    return {
      id: (raw.sub as string) || String(raw.id || ''),
      name: raw.name as string,
      email: raw.email as string,
      email_verified: raw.email_verified as boolean,
      picture: raw.picture as string,
      locale: raw.locale as string,
      family_name: raw.family_name as string,
      given_name: raw.given_name as string,
    };
  }
}

export function createGoogleOAuthProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes?: string[]
): GoogleOAuthProvider {
  return new GoogleOAuthProvider(clientId, clientSecret, redirectUri, scopes);
}
