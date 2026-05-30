import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

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
  if (process.env.Liri_USE_LOCAL_OAUTH === 'true') {
    return 'local';
  }
  if (process.env.Liri_USE_STAGING_OAUTH === 'true') {
    return 'staging';
  }
  return 'prod';
}

/**
 * 获取OAuth配置文件后缀
 */
export function fileSuffixForOauthConfig(): string {
  if (process.env.Liri_CUSTOM_OAUTH_URL) {
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

/**
 * OAuth作用域常量
 */
export const INFERENCE_SCOPE = 'user:inference' as const;
export const PROFILE_SCOPE = 'user:profile' as const;

/**
 * OAuth Beta头
 */
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const;

/**
 * 控制台OAuth作用域 - 用于API密钥创建
 */
export const CONSOLE_OAUTH_SCOPES = [
  'org:create_api_key',
  PROFILE_SCOPE,
] as const;

/**
 * 应用OAuth作用域 - 用于应用订阅者
 */
export const APP_OAUTH_SCOPES = [
  PROFILE_SCOPE,
  INFERENCE_SCOPE,
  'user:sessions:Liri',
  'user:mcp_servers',
  'user:file_upload',
] as const;

/**
 * 所有OAuth作用域 - 登录时请求所有作用域
 */
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...APP_OAUTH_SCOPES])
);

/**
 * OAuth配置接口
 */
export type OauthConfig = {
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
};

/**
 * 生产环境OAuth配置
 */
const PROD_OAUTH_CONFIG: OauthConfig = {
  BASE_API_URL: 'https://api.pyapp.dev',
  AUTHORIZE_URL: 'https://platform.pyapp.dev/oauth/authorize',
  TOKEN_URL: 'https://platform.pyapp.dev/v1/oauth/token',
  API_KEY_URL: 'https://api.pyapp.dev/api/oauth/Liri/create_api_key',
  ROLES_URL: 'https://api.pyapp.dev/api/oauth/Liri/roles',
  SUCCESS_URL: 'https://platform.pyapp.dev/oauth/code/success?app=py-app',
  MANUAL_REDIRECT_URL: 'https://platform.pyapp.dev/oauth/code/callback',
  CLIENT_ID: 'py-app-client-id',
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: 'https://mcp-proxy.pyapp.dev',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const;

/**
 * 预发布环境OAuth配置
 */
const STAGING_OAUTH_CONFIG: OauthConfig = {
  BASE_API_URL: 'https://api-staging.pyapp.dev',
  AUTHORIZE_URL: 'https://platform-staging.pyapp.dev/oauth/authorize',
  TOKEN_URL: 'https://platform-staging.pyapp.dev/v1/oauth/token',
  API_KEY_URL: 'https://api-staging.pyapp.dev/api/oauth/Liri/create_api_key',
  ROLES_URL: 'https://api-staging.pyapp.dev/api/oauth/Liri/roles',
  SUCCESS_URL:
    'https://platform-staging.pyapp.dev/oauth/code/success?app=py-app',
  MANUAL_REDIRECT_URL: 'https://platform-staging.pyapp.dev/oauth/code/callback',
  CLIENT_ID: 'py-app-staging-client-id',
  OAUTH_FILE_SUFFIX: '-staging-oauth',
  MCP_PROXY_URL: 'https://mcp-proxy-staging.pyapp.dev',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const;

/**
 * 获取本地开发OAuth配置
 * 支持通过环境变量覆盖默认的本地服务地址
 */
function getLocalOauthConfig(): OauthConfig {
  const api =
    process.env.Liri_LOCAL_OAUTH_API_BASE?.replace(/\/$/, '') ??
    'http://localhost:8000';
  const apps =
    process.env.Liri_LOCAL_OAUTH_APPS_BASE?.replace(/\/$/, '') ??
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

/**
 * 允许的自定义OAuth基础URL白名单
 * 防止OAuth令牌被发送到任意端点
 */
const ALLOWED_OAUTH_BASE_URLS = [
  'https://pyapp.dev',
  'https://staging.pyapp.dev',
];

/**
 * 获取OAuth配置
 * 根据环境变量自动选择生产、预发布或本地配置
 * 支持通过环境变量覆盖客户端ID
 */
export function getOauthConfig(): OauthConfig {
  let config: OauthConfig = (() => {
    switch (getOauthConfigType()) {
      case 'local':
        return getLocalOauthConfig();
      case 'staging':
        return STAGING_OAUTH_CONFIG;
      case 'prod':
        return PROD_OAUTH_CONFIG;
    }
  })();

  const oauthBaseUrl = process.env.Liri_CUSTOM_OAUTH_URL;
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '');
    if (!ALLOWED_OAUTH_BASE_URLS.includes(base)) {
      throw new AppError(
        'Liri_CUSTOM_OAUTH_URL is not an approved endpoint.',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    config = {
      ...config,
      BASE_API_URL: base,
      AUTHORIZE_URL: `${base}/oauth/authorize`,
      TOKEN_URL: `${base}/v1/oauth/token`,
      API_KEY_URL: `${base}/api/oauth/Liri/create_api_key`,
      ROLES_URL: `${base}/api/oauth/Liri/roles`,
      SUCCESS_URL: `${base}/oauth/code/success?app=py-app`,
      MANUAL_REDIRECT_URL: `${base}/oauth/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    };
  }

  const clientIdOverride = process.env.Liri_OAUTH_CLIENT_ID;
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    };
  }

  return config;
}
