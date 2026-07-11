/**
 * OAuth配置
 * 提供OAuth 2.0认证的配置管理
 * 支持多OAuth提供商配置
 */

import type { OAuthConfig } from './oauth-types.js';
import type { ValidationResult } from '@modules/common/types';
import { configManager } from '@modules/config';

const Liri_INFERENCE_SCOPE = 'user:inference';
const Liri_PROFILE_SCOPE = 'user:profile';
const CONSOLE_SCOPE = 'org:create_api_key';

export const CONSOLE_OAUTH_SCOPES = [CONSOLE_SCOPE, Liri_PROFILE_SCOPE];

export const Liri_OAUTH_SCOPES = [
  Liri_PROFILE_SCOPE,
  Liri_INFERENCE_SCOPE,
  'user:sessions:Liri',
  'user:mcp_servers',
  'user:file_upload',
];

export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...Liri_OAUTH_SCOPES])
);

export const SUCCESS_URL = 'https://openliri.com/auth/success';
export const MANUAL_REDIRECT_URL = 'https://openliri.com/auth/manual';

export const DEFAULT_API_BASE_URL = 'https://api.openliri.com';

export const ALLOWED_OAUTH_BASE_URLS: string[] = [
  'https://api.openliri.com',
  'https://api.staging.openliri.com',
  'http://localhost:8080',
];

/**
 * 从Keychain加载Client ID（macOS）
 */
function loadClientIdFromKeychain(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const { execSync } = require('child_process');
    const result = execSync(
      'security find-generic-password -s "py-app-oauth" -a "client_id" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 获取默认Client ID
 * 优先级：环境变量 > Keychain > 默认值
 */
function getDefaultClientId(): string {
  return (
    configManager.env('Liri_OAUTH_CLIENT_ID') ||
    loadClientIdFromKeychain() ||
    '00000000-0000-0000-0000-000000000000'
  );
}

/**
 * 验证OAuth配置
 */
export function validateOAuthConfig(config: OAuthConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.authorizeUrl) {
    errors.push('authorizeUrl is required');
  }

  if (!config.tokenUrl) {
    errors.push('tokenUrl is required');
  }

  if (!config.clientId) {
    errors.push('clientId is required');
  }

  if (!config.profileUrl) {
    errors.push('profileUrl is required');
  }

  if (!config.scopes || config.scopes.length === 0) {
    errors.push('scopes is required');
  }

  if (
    !ALLOWED_OAUTH_BASE_URLS.some((url) => config.authorizeUrl.startsWith(url))
  ) {
    errors.push(
      `authorizeUrl must start with one of: ${ALLOWED_OAUTH_BASE_URLS.join(', ')}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * OAuth提供商配置
 */
export interface OAuthProviderConfig extends OAuthConfig {
  providerId: string;
  providerName: string;
  enabled: boolean;
  priority: number;
}

/**
 * 获取自定义OAuth配置
 */
function getCustomOAuthConfig(): OAuthConfig {
  const baseApiUrl = configManager.env('CUSTOM_OAUTH_API_BASE_URL') || '';
  const clientId = configManager.env('CUSTOM_OAUTH_CLIENT_ID') || '';

  return {
    authorizeUrl: `${baseApiUrl}/oauth/authorize`,
    tokenUrl: `${baseApiUrl}/oauth/token`,
    profileUrl: `${baseApiUrl}/api/oauth/profile`,
    successUrl: SUCCESS_URL,
    manualRedirectUrl: MANUAL_REDIRECT_URL,
    clientId,
    scopes: Liri_OAUTH_SCOPES,
  };
}

/**
 * 获取OAuth提供商列表
 */
export function getOAuthProviders(): Map<string, OAuthProviderConfig> {
  const providers = new Map<string, OAuthProviderConfig>();

  // Liri默认提供商
  const defaultConfig = getOauthConfig(false);
  providers.set('pyapp', {
    providerId: 'pyapp',
    providerName: 'Liri',
    ...defaultConfig,
    enabled: true,
    priority: 1,
  });

  // 自定义提供商（如果启用）
  if (configManager.env('CUSTOM_OAUTH_ENABLED') === 'true') {
    const customConfig = getCustomOAuthConfig();
    providers.set('custom', {
      providerId: 'custom',
      providerName:
        configManager.env('CUSTOM_OAUTH_PROVIDER_NAME') || 'Custom OAuth',
      ...customConfig,
      enabled: true,
      priority: 2,
    });
  }

  return providers;
}

export function getOauthConfig(inferenceOnly: boolean = false): OAuthConfig {
  const baseApiUrl =
    configManager.env('Liri_API_BASE_URL') || DEFAULT_API_BASE_URL;
  const clientId = getDefaultClientId();

  const scopes = inferenceOnly ? [Liri_INFERENCE_SCOPE] : ALL_OAUTH_SCOPES;

  return {
    authorizeUrl: `${baseApiUrl}/oauth/authorize`,
    tokenUrl: `${baseApiUrl}/oauth/token`,
    profileUrl: `${baseApiUrl}/api/oauth/profile`,
    successUrl: SUCCESS_URL,
    manualRedirectUrl: MANUAL_REDIRECT_URL,
    clientId,
    scopes,
  };
}
