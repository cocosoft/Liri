/**
 * 配置系统入口
 * 提供配置管理的统一接口
 */

export {
  ConfigManager,
  configManager,
} from './ConfigManager.js';

export {
  ConfigValidator,
} from './ConfigValidator.js';

export {
  ConfigMigration,
  CURRENT_MIGRATION_VERSION,
} from './ConfigMigration.js';

export type {
  GlobalConfig,
  ProjectConfig,
  ConfigStats,
  ConfigValidationRule,
  GlobalConfigKey,
  ProjectConfigKey,
  NotificationChannel,
  EditorMode,
  DiffTool,
  AIConfig,
  OllamaConfig,
  RoutingConfig,
  TokenEstimatorConfig,
  MiniAgentConfig,
} from './types.js';

export {
  createDefaultGlobalConfig,
  DEFAULT_PROJECT_CONFIG,
  GLOBAL_CONFIG_KEYS,
  PROJECT_CONFIG_KEYS,
  ConfigSource,
} from './types.js';

// 导出 ConfigLoader
export {
  ConfigLoader,
  configLoader,
} from './loader/ConfigLoader.js';

export type {
  ConfigSource as LoaderConfigSource,
  ConfigFormat,
  ConfigLoadResult,
  ConfigChangeCallback,
  IConfigLoader,
} from './loader/ConfigLoader.js';

// 导出 HotReloader
export {
  HotReloader,
  hotReloader,
} from './hotreload/HotReloader.js';

export type {
  ReloadStrategy,
  ReloadEvent,
  ReloadResult,
  ReloadListener,
  ReloadErrorListener,
  HotReloadConfig,
} from './hotreload/HotReloader.js';

// 导出 VersionController
export {
  VersionController,
  versionController,
} from './version/VersionController.js';

export type {
  ConfigSnapshot,
  ConfigDiff,
  VersionInfo,
} from './version/VersionController.js';

// 导出统一配置管理器
export {
  UnifiedConfigManager,
  getUnifiedConfigManager,
  resetUnifiedConfigManager,
  SETTING_SOURCES,
  getSettingSourceName,
  getSourceDisplayName,
} from './UnifiedConfigManager.js';

export type {
  SettingSource,
  EditableSettingSource,
} from './UnifiedConfigManager.js';

// 导出多源设置管理
export {
  MultiSourceSettingsManager,
  getMultiSourceSettingsManager,
} from './settings/index.js';

export {
  loadUserSettings,
  saveUserSettings,
  updateUserSettings,
  deleteUserSetting,
  getUserSettingsPath,
} from './settings/userSettings.js';

export {
  loadProjectSettings,
  saveProjectSettings,
  updateProjectSettings,
  getProjectSettingsPath,
} from './settings/projectSettings.js';

export {
  loadLocalSettings,
  saveLocalSettings,
  updateLocalSettings,
  getLocalSettingsPath,
} from './settings/localSettings.js';

export {
  loadManagedFileSettings,
  loadPolicySettings,
  isPolicySettingsAvailable,
  getManagedSettingsDir,
  getManagedSettingsPath,
  getManagedDropInDir,
} from './settings/policySettings.js';

// 导出MDM设置管理
export {
  startMdmSettingsLoad,
  ensureMdmSettingsLoaded,
  getMdmSettings,
  getHkcuSettings,
  clearMdmSettingsCache,
  refreshMdmSettings,
  type MdmResult,
} from './settings/mdm/index.js';

// 导出安全环境变量管理
export {
  isProviderManagedEnvVar,
  isSafeEnvVar,
  isDangerousEnvVar,
  applySafeConfigEnvironmentVariables,
  applyProjectScopedEnvVariables,
  SAFE_ENV_VARS,
  DANGEROUS_SHELL_SETTINGS,
  TRUSTED_SETTING_SOURCES,
  type TrustedSettingSource,
} from './managedEnv.js';

// 导出便捷函数
import { configManager } from './ConfigManager.js';
import type { GlobalConfig } from './types.js';

/**
 * 启用配置系统
 */
export function enableConfigs(): void {
  configManager.enableConfigs();
}

/**
 * 获取全局配置对象
 */
export function getGlobalConfig(): GlobalConfig {
  return configManager.getGlobalConfig();
}

/**
 * 获取全局配置对象（别名）
 */
export function getConfig(): GlobalConfig {
  return configManager.getGlobalConfig();
}

/**
 * 获取配置值
 */
export function getConfigValue<T = any>(key: string): T | undefined {
  return configManager.getConfigValue(key);
}

/**
 * 设置配置值
 */
export function setConfigValue<T = any>(key: string, value: T): void {
  configManager.setConfigValue(key, value);
}

/**
 * 重置配置为默认值
 */
export function resetConfigToDefaults(): void {
  configManager.resetConfig();
}
