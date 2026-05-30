/**
 * OAuth常量
 * 提供OAuth 2.0认证所需的常量定义
 */

export const Liri_INFERENCE_SCOPE = 'user:inference';
export const Liri_PROFILE_SCOPE = 'user:profile';
const CONSOLE_SCOPE = 'org:create_api_key';

export const OAUTH_BETA_HEADER = 'oauth-2025-04-20';

export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  Liri_PROFILE_SCOPE,
] as const;

export const Liri_OAUTH_SCOPES = [
  Liri_PROFILE_SCOPE,
  Liri_INFERENCE_SCOPE,
  'user:sessions:Liri',
  'user:mcp_servers',
  'user:file_upload',
] as const;

export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...Liri_OAUTH_SCOPES])
);

export function getOAuthConfigType(): 'prod' | 'staging' | 'local' {
  if (process.env.Liri_USER_TYPE === 'ant') {
    if (process.env.USE_LOCAL_OAUTH === 'true') {
      return 'local';
    }
    if (process.env.USE_STAGING_OAUTH === 'true') {
      return 'staging';
    }
  }
  return 'prod';
}

export function getFileSuffixForOAuthConfig(): string {
  if (process.env.Liri_CUSTOM_OAUTH_URL) {
    return '-custom-oauth';
  }
  switch (getOAuthConfigType()) {
    case 'local':
      return '-local-oauth';
    case 'staging':
      return '-staging-oauth';
    case 'prod':
      return '';
  }
}
