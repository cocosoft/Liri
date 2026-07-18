/**
 * GitHub OAuth Provider
 * 实现 GitHub OAuth 2.0 授权流程
 */

import type { UserInfo } from '../types/OAuthProvider';
import { BaseOAuthProvider } from './BaseOAuthProvider';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_PROFILE = 'https://api.github.com/user';

export class GitHubOAuthProvider extends BaseOAuthProvider {
  readonly id = 'github';
  readonly name = 'GitHub';

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    scopes?: string[]
  ) {
    super(
      GITHUB_AUTHORIZE,
      GITHUB_TOKEN,
      GITHUB_PROFILE,
      clientId,
      clientSecret,
      redirectUri,
      scopes || ['read:user', 'user:email']
    );
  }

  protected parseUserInfo(raw: Record<string, unknown>): UserInfo {
    return {
      id: String(raw.id || ''),
      name: raw.name as string,
      email: raw.email as string,
      login: raw.login as string,
      avatar_url: raw.avatar_url as string,
      html_url: raw.html_url as string,
      bio: raw.bio as string,
      public_repos: raw.public_repos as number,
    };
  }
}

export function createGitHubOAuthProvider(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  scopes?: string[]
): GitHubOAuthProvider {
  return new GitHubOAuthProvider(clientId, clientSecret, redirectUri, scopes);
}
