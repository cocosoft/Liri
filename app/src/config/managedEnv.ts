/**
 * 安全环境变量管理
 * 管理环境变量的安全应用，防止恶意配置劫持
 */

import { configManager } from '@modules/config';

/**
 * 提供商托管的环境变量集合
 * 当 LIRI_PROVIDER_MANAGED_BY_HOST 启用时，这些变量不会从设置源应用
 * 防止用户设置覆盖宿主配置的路由
 */
const PROVIDER_MANAGED_ENV_VARS = new Set([
  'LIRI_PROVIDER_MANAGED_BY_HOST',
  'LIRI_USE_BEDROCK',
  'LIRI_USE_VERTEX',
  'LIRI_USE_FOUNDRY',
  'LIRI_BASE_URL',
  'LIRI_BEDROCK_BASE_URL',
  'LIRI_VERTEX_BASE_URL',
  'LIRI_FOUNDRY_BASE_URL',
  'LIRI_FOUNDRY_RESOURCE',
  'LIRI_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'LIRI_API_KEY',
  'LIRI_AUTH_TOKEN',
  'LIRI_OAUTH_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'LIRI_FOUNDRY_API_KEY',
  'LIRI_SKIP_BEDROCK_AUTH',
  'LIRI_SKIP_VERTEX_AUTH',
  'LIRI_SKIP_FOUNDRY_AUTH',
  'LIRI_MODEL',
  'LIRI_DEFAULT_HAIKU_MODEL',
  'LIRI_DEFAULT_OPUS_MODEL',
  'LIRI_DEFAULT_SONNET_MODEL',
  'LIRI_SMALL_FAST_MODEL',
  'LIRI_SUBAGENT_MODEL',
]);

/**
 * 提供商托管的环境变量前缀
 * 用于前缀匹配（如 VERTEX_REGION_CLAUDE_* 系列）
 */
const PROVIDER_MANAGED_ENV_PREFIXES = [
  'VERTEX_REGION_CLAUDE_',
  'LIRI_VERTEX_REGION_',
];

/**
 * 判断环境变量是否为提供商托管变量
 */
export function isProviderManagedEnvVar(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    PROVIDER_MANAGED_ENV_VARS.has(upper) ||
    PROVIDER_MANAGED_ENV_PREFIXES.some((p) => upper.startsWith(p))
  );
}

/**
 * 危险的Shell设置项
 * 这些设置可以执行任意Shell代码，需要特别警惕
 */
export const DANGEROUS_SHELL_SETTINGS = [
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'gcpAuthRefresh',
  'otelHeadersHelper',
  'statusLine',
] as const;

/**
 * 安全的环境变量集合
 * 这些变量可以在信任对话框之前应用，不会造成安全风险
 * * 不在此列表中的环境变量被视为危险的，通过远程托管设置设置时会触发安全对话框
 */
export const SAFE_ENV_VARS = new Set([
  'LIRI_CUSTOM_HEADERS',
  'LIRI_CUSTOM_MODEL_OPTION',
  'LIRI_DEFAULT_HAIKU_MODEL',
  'LIRI_DEFAULT_OPUS_MODEL',
  'LIRI_DEFAULT_SONNET_MODEL',
  'LIRI_FOUNDRY_API_KEY',
  'LIRI_MODEL',
  'LIRI_SMALL_FAST_MODEL',
  'LIRI_SMALL_FAST_MODEL_AWS_REGION',
  'LIRI_SUBAGENT_MODEL',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'BASH_DEFAULT_TIMEOUT_MS',
  'BASH_MAX_OUTPUT_LENGTH',
  'BASH_MAX_TIMEOUT_MS',
  'LIRI_DISABLE_EXPERIMENTAL_BETAS',
  'LIRI_DISABLE_NONESSENTIAL_TRAFFIC',
  'LIRI_DISABLE_TERMINAL_TITLE',
  'LIRI_ENABLE_TELEMETRY',
  'LIRI_MAX_OUTPUT_TOKENS',
  'LIRI_SKIP_BEDROCK_AUTH',
  'LIRI_SKIP_FOUNDRY_AUTH',
  'LIRI_SKIP_VERTEX_AUTH',
  'LIRI_USE_BEDROCK',
  'LIRI_USE_FOUNDRY',
  'LIRI_USE_VERTEX',
  'DISABLE_AUTOUPDATER',
  'DISABLE_BUG_COMMAND',
  'DISABLE_COST_WARNINGS',
  'DISABLE_ERROR_REPORTING',
  'DISABLE_FEEDBACK_COMMAND',
  'DISABLE_TELEMETRY',
  'ENABLE_TOOL_SEARCH',
  'MAX_MCP_OUTPUT_TOKENS',
  'MAX_THINKING_TOKENS',
  'MCP_TIMEOUT',
  'MCP_TOOL_TIMEOUT',
  'USE_BUILTIN_RIPGREP',
]);

/**
 * 受信任的设置源
 * 这些源的环境变量可以在信任对话框之前应用
 * - userSettings: 用户控制，非项目特定
 * - flagSettings: 用户显式传递
 * - policySettings: 企业IT/管理员控制，最高优先级
 */
export const TRUSTED_SETTING_SOURCES = [
  'userSettings',
  'flagSettings',
  'policySettings',
] as const;

export type TrustedSettingSource = (typeof TRUSTED_SETTING_SOURCES)[number];

/**
 * 过滤SSH隧道变量
 * 当 LIRI_UNIX_SOCKET 设置时，从设置源的环境变量中移除相关认证变量
 */
function withoutSSHTunnelVars(
  env: Record<string, string> | undefined
): Record<string, string> {
  if (!env || !configManager.env('LIRI_UNIX_SOCKET')) return env || {};
  const {
    LIRI_UNIX_SOCKET: _1,
    LIRI_BASE_URL: _2,
    LIRI_API_KEY: _3,
    LIRI_AUTH_TOKEN: _4,
    LIRI_OAUTH_TOKEN: _5,
    ...rest
  } = env;
  return rest;
}

/**
 * 过滤宿主托管的提供商变量
 * 当 LIRI_PROVIDER_MANAGED_BY_HOST 启用时，移除提供商选择/模型默认变量
 */
function withoutHostManagedProviderVars(
  env: Record<string, string> | undefined
): Record<string, string> {
  if (!env) return {};
  if (!isEnvTruthy(process.env.LIRI_PROVIDER_MANAGED_BY_HOST)) {
    return env;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!isProviderManagedEnvVar(key)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * CCD启动时的环境变量快照
 * 用于防止设置覆盖宿主进程设置的环境变量
 */
let ccdSpawnEnvKeys: Set<string> | null | undefined;

function withoutCcdSpawnEnvKeys(
  env: Record<string, string> | undefined
): Record<string, string> {
  if (!env || !ccdSpawnEnvKeys) return env || {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ccdSpawnEnvKeys.has(key)) out[key] = value;
  }
  return out;
}

/**
 * 组合所有过滤规则
 */
function filterSettingsEnv(
  env: Record<string, string> | undefined
): Record<string, string> {
  return withoutCcdSpawnEnvKeys(
    withoutHostManagedProviderVars(withoutSSHTunnelVars(env))
  );
}

/**
 * 安全地应用配置环境变量
 * 在信任对话框之前调用，仅应用受信任源的环境变量
 */
export function applySafeConfigEnvironmentVariables(
  sources: Record<string, Record<string, string> | undefined>
): void {
  if (ccdSpawnEnvKeys === undefined) {
    ccdSpawnEnvKeys =
      configManager.env('LIRI_ENTRYPOINT') === 'liri-desktop'
        ? new Set(Object.keys(process.env))
        : null;
  }

  for (const source of TRUSTED_SETTING_SOURCES) {
    const env = sources[source];
    if (env) {
      Object.assign(process.env, filterSettingsEnv(env));
    }
  }
}

/**
 * 应用项目范围的环境变量（仅安全变量）
 * 项目范围的设置可能包含恶意配置，只允许安全变量
 */
export function applyProjectScopedEnvVariables(
  env: Record<string, string> | undefined
): void {
  if (!env) return;

  for (const [key, value] of Object.entries(env)) {
    if (SAFE_ENV_VARS.has(key)) {
      process.env[key] = value;
    }
  }
}

/**
 * 检查环境变量是否安全
 */
export function isSafeEnvVar(key: string): boolean {
  return SAFE_ENV_VARS.has(key);
}

/**
 * 检查环境变量是否危险
 */
export function isDangerousEnvVar(key: string): boolean {
  return !SAFE_ENV_VARS.has(key) && !isProviderManagedEnvVar(key);
}

/**
 * 检查环境变量值是否为真
 */
function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}
