import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { configManager } from '@modules/config';

/**
 * OAuth配置常量
 * 去除Anthropic/CLAUDE特定内容，适配Liri
 */

type OauthConfigType = 'prod' | 'staging' | 'local';

/**
 * 获取OAuth配置类型
 * 根据环境变量决定使用生产、预发布还是本地配置
 */
function getOauthConfigType(): OauthConfigType {
  if (configManager.env('Liri_USE_LOCAL_OAUTH') === 'true') {
    return 'local';
  }
  if (configManager.env('Liri_USE_STAGING_OAUTH') === 'true') {
    return 'staging';
  }
  return 'prod';
}

/**
 * 获取OAuth配置文件后缀
 */
export function fileSuffixForOauthConfig(): string {
  if (configManager.env('Liri_CUSTOM_OAUTH_URL')) {
    return '-custom-oauth';
  }
  switch (getOauthConfigType()) {
    case 'local':
      return '-local-oauth';
    case 'staging':
      return '-staging-oauth';
    case 'prod':
      return '';
  }
}

const ALLOWED_OAUTH_BASE_URLS = [
  'https://oauth.claude.ai',
  'http://localhost:8080',
  'https://oauth.liri.sh',
  'https://staging.oauth.liri.sh',
];

interface OauthConfig {
  BASE_API_URL: string;
  AUTHORIZE_URL: string;
  TOKEN_URL: string;
  API_KEY_URL: string;
  ROLES_URL: string;
  SUCCESS_URL: string;
  MANUAL_REDIRECT_URL: string;
  CLIENT_ID: string;
  OAUTH_FILE_SUFFIX: string;
  MCP_PROXY_URL: string;
  MCP_PROXY_PATH: string;
}

const PROD_OAUTH_CONFIG: OauthConfig = {
  BASE_API_URL: 'https://api.claude.ai',
  AUTHORIZE_URL: 'https://oauth.claude.ai/authorize',
  TOKEN_URL: 'https://oauth.claude.ai/token',
  API_KEY_URL: 'https://api.claude.ai/api/oauth/claude/create_api_key',
  ROLES_URL: 'https://api.claude.ai/api/oauth/claude/roles',
  SUCCESS_URL: 'https://claude.ai/oauth/code/success?app=py-app',
  MANUAL_REDIRECT_URL: 'https://claude.ai/oauth/code/callback',
  CLIENT_ID: 'py-app-client-id',
  OAUTH_FILE_SUFFIX: '-oauth',
  MCP_PROXY_URL: 'http://localhost:8205',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
};

const STAGING_OAUTH_CONFIG: OauthConfig = {
  BASE_API_URL: 'https://api.staging.claude.ai',
  AUTHORIZE_URL: 'https://staging.oauth.claude.ai/authorize',
  TOKEN_URL: 'https://staging.oauth.claude.ai/token',
  API_KEY_URL: 'https://api.staging.claude.ai/api/oauth/claude/create_api_key',
  ROLES_URL: 'https://api.staging.claude.ai/api/oauth/claude/roles',
  SUCCESS_URL: 'https://staging.claude.ai/oauth/code/success?app=py-app',
  MANUAL_REDIRECT_URL: 'https://staging.claude.ai/oauth/code/callback',
  CLIENT_ID: 'py-app-staging-client-id',
  OAUTH_FILE_SUFFIX: '-staging-oauth',
  MCP_PROXY_URL: 'http://localhost:8205',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
};

/**
 * 获取本地开发OAuth配置
 * 支持通过环境变量覆盖默认的本地服务地址
 */
function getLocalOauthConfig(): OauthConfig {
  const api =
    configManager.env('Liri_LOCAL_OAUTH_API_BASE')?.replace(/\/$/, '') ??
    'http://localhost:8000';
  const apps =
    configManager.env('Liri_LOCAL_OAUTH_APPS_BASE')?.replace(/\/$/, '') ??
    'http://localhost:4000';

  return {
    BASE_API_URL: api,
    AUTHORIZE_URL: `${apps}/oauth/authorize`,
    TOKEN_URL: `${api}/v1/oauth/token`,
    API_KEY_URL: `${api}/api/oauth/Liri/create_api_key`,
    ROLES_URL: `${api}/api/oauth/Liri/roles`,
    SUCCESS_URL: `${apps}/oauth/code/success?app=py-app`,
    MANUAL_REDIRECT_URL: `${apps}/oauth/code/callback`,
    CLIENT_ID: 'py-app-local-client-id',
    OAUTH_FILE_SUFFIX: '-local-oauth',
    MCP_PROXY_URL: 'http://localhost:8205',
    MCP_PROXY_PATH: '/v1/mcp/{server_id}',
  };
}

const OAUTH_CONFIGS: Record<OauthConfigType, OauthConfig> = {
  prod: PROD_OAUTH_CONFIG,
  staging: STAGING_OAUTH_CONFIG,
  local: getLocalOauthConfig(),
};

export function loadOauthConfig(): OauthConfig {
  let config = OAUTH_CONFIGS[getOauthConfigType()];

  const oauthBaseUrl = configManager.env('Liri_CUSTOM_OAUTH_URL');
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '');
    if (!ALLOWED_OAUTH_BASE_URLS.includes(base)) {
      throw new AppError(
        'Liri_CUSTOM_OAUTH_URL is not an approved endpoint.',
        ErrorCategory.VALIDATION,
        ErrorSeverity.HIGH
      );
    }
    config = {
      ...config,
      BASE_API_URL: base,
      AUTHORIZE_URL: `${base}/authorize`,
      TOKEN_URL: `${base}/token`,
      API_KEY_URL: `${base}/api/oauth/Liri/create_api_key`,
      ROLES_URL: `${base}/api/oauth/Liri/roles`,
      SUCCESS_URL: `${base}/code/success?app=py-app`,
      MANUAL_REDIRECT_URL: `${base}/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    };
  }

  const clientIdOverride = configManager.env('Liri_OAUTH_CLIENT_ID');
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    };
  }

  return config;
}
