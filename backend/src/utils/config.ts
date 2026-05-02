/**
 * 配置管理工具
 * 负责应用的配置管理和环境设置
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from './log.js';
import { profileCheckpoint } from './startupProfiler.js';

/**
 * 配置接口
 */
export interface AppConfig {
  version: string;
  debug: boolean;
  verbose: boolean;
  companion?: {
    name: string;
    soul: string;
  };
  companionMuted?: boolean;
  [key: string]: any;
}

/**
 * 配置来源
 */
export enum ConfigSource {
  DEFAULT = 'default',
  ENV = 'env',
  FILE = 'file',
  RUNTIME = 'runtime',
}

/**
 * 配置验证规则
 */
export interface ConfigValidationRule {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: any;
  validate?: (value: any) => boolean;
  message?: string;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: AppConfig = {
  version: '1.0.0',
  debug: false,
  verbose: false,
  companion: undefined,
  companionMuted: false,
};

/**
 * 配置验证规则
 */
const VALIDATION_RULES: ConfigValidationRule[] = [
  { key: 'version', type: 'string', required: true },
  { key: 'debug', type: 'boolean', required: true },
  { key: 'verbose', type: 'boolean', required: true },
];

/**
 * 配置缓存
 */
let configCache: AppConfig | null = null;
let configSources: Record<string, any> = {};
let lastConfigLoadTime: number = 0;
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存过期时间

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.PY_APP', 'config.json');
}

/**
 * 从环境变量加载配置
 */
function loadFromEnv(): Record<string, any> {
  const envConfig: Record<string, any> = {};

  // 从环境变量加载配置，支持 PY_APP_ 前缀的环境变量
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PY_APP_') && value) {
      const configKey = key.substring('PY_APP_'.length).toLowerCase();
      // 尝试解析为JSON，否则使用原始值
      try {
        envConfig[configKey] = JSON.parse(value);
      } catch {
        envConfig[configKey] = value;
      }
    }
  }

  return envConfig;
}

/**
 * 从文件加载配置
 */
function loadFromFile(): Record<string, any> {
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    try {
      const configData = readFileSync(configPath, 'utf-8');
      return JSON.parse(configData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.warn('Failed to load config file, using empty config', {
        error: errorMessage,
      });
      return {};
    }
  }

  return {};
}

/**
 * 验证配置
 */
function validateConfig(config: AppConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const rule of VALIDATION_RULES) {
    const value = config[rule.key];

    // 检查必填字段
    if (rule.required && value === undefined) {
      errors.push(`Missing required config key: ${rule.key}`);
      continue;
    }

    // 检查类型
    if (value !== undefined && typeof value !== rule.type) {
      errors.push(
        `Invalid type for config key ${rule.key}: expected ${rule.type}, got ${typeof value}`
      );
      continue;
    }

    // 自定义验证
    if (value !== undefined && rule.validate && !rule.validate(value)) {
      errors.push(rule.message || `Invalid value for config key ${rule.key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 合并配置
 */
function mergeConfigs(sources: Record<string, any>[]): AppConfig {
  let merged: AppConfig = { ...DEFAULT_CONFIG };

  // 按照优先级从低到高合并
  for (const source of sources) {
    merged = { ...merged, ...source };
  }

  return merged;
}

/**
 * 检查配置缓存是否过期
 */
function isCacheExpired(): boolean {
  return Date.now() - lastConfigLoadTime > CONFIG_CACHE_TTL;
}

/**
 * 加载配置
 */
function loadConfig(): AppConfig {
  profileCheckpoint('config_load_start');
  // 检查缓存是否有效
  if (configCache && !isCacheExpired()) {
    profileCheckpoint('config_load_end');
    return configCache;
  }

  // 加载各个来源的配置
  const envConfig = loadFromEnv();
  const fileConfig = loadFromFile();

  // 存储配置来源
  configSources = {
    [ConfigSource.DEFAULT]: DEFAULT_CONFIG,
    [ConfigSource.ENV]: envConfig,
    [ConfigSource.FILE]: fileConfig,
  };

  // 合并配置
  let mergedConfig = mergeConfigs([
    configSources[ConfigSource.DEFAULT],
    configSources[ConfigSource.FILE],
    configSources[ConfigSource.ENV],
  ]);

  // 验证配置
  const { valid, errors } = validateConfig(mergedConfig);
  if (!valid) {
    logger.warn('Invalid configuration, using defaults with corrections', {
      errors,
    });
    // 使用默认值修正无效配置
    mergedConfig = { ...DEFAULT_CONFIG, ...mergedConfig };
  }

  // 更新缓存
  configCache = mergedConfig;
  lastConfigLoadTime = Date.now();

  profileCheckpoint('config_load_end');
  return configCache;
}

/**
 * 清除配置缓存
 */
export function clearConfigCache(): void {
  configCache = null;
  lastConfigLoadTime = 0;
  logger.debug('Config cache cleared');
}

/**
 * 强制重新加载配置
 */
export function reloadConfig(): AppConfig {
  clearConfigCache();
  return loadConfig();
}

/**
 * 保存配置
 */
function saveConfig(config: AppConfig): void {
  profileCheckpoint('config_save_start');
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  // 确保目录存在
  if (!existsSync(configDir)) {
    try {
      mkdirSync(configDir, { recursive: true });
    } catch (error) {
      const errorInstance = error instanceof Error ? error : undefined;
      logger.error('Failed to create config directory', errorInstance);
      profileCheckpoint('config_save_end');
      return;
    }
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    configCache = config;
    // 更新文件配置源
    configSources[ConfigSource.FILE] = { ...config };
  } catch (error) {
    const errorInstance = error instanceof Error ? error : undefined;
    logger.error('Failed to save config:', errorInstance);
  } finally {
    profileCheckpoint('config_save_end');
  }
}

/**
 * 启用配置系统
 */
export function enableConfigs(): void {
  profileCheckpoint('config_enable_start');
  loadConfig();
  profileCheckpoint('config_enable_end');
}

/**
 * 获取配置值
 */
export function getConfig(key?: string): any {
  profileCheckpoint('config_get_start');
  const config = loadConfig();

  if (key) {
    profileCheckpoint('config_get_end');
    return config[key];
  }

  profileCheckpoint('config_get_end');
  return config;
}

/**
 * 设置配置值
 */
export function setConfig(key: string, value: any): void {
  profileCheckpoint('config_set_start');
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  profileCheckpoint('config_set_end');
}

/**
 * 更新配置
 */
export function updateConfig(updates: Partial<AppConfig>): void {
  profileCheckpoint('config_update_start');
  const config = loadConfig();
  const updatedConfig = { ...config, ...updates };
  saveConfig(updatedConfig);
  profileCheckpoint('config_update_end');
}

/**
 * 重置配置
 */
export function resetConfig(): void {
  configCache = null;
  configSources = {};
  saveConfig(DEFAULT_CONFIG);
}

/**
 * 获取配置来源
 */
export function getConfigSources(): Record<string, any> {
  return { ...configSources };
}

/**
 * 从运行时设置配置（不持久化）
 */
export function setRuntimeConfig(updates: Partial<AppConfig>): void {
  const config = loadConfig();
  configSources[ConfigSource.RUNTIME] = { ...updates };
  // 重新合并配置
  configCache = mergeConfigs([
    configSources[ConfigSource.DEFAULT],
    configSources[ConfigSource.FILE],
    configSources[ConfigSource.ENV],
    configSources[ConfigSource.RUNTIME],
  ]);
}

/**
 * 获取全局配置
 * @returns 全局配置对象
 */
export function getGlobalConfig(): AppConfig {
  return loadConfig();
}

export default {
  enableConfigs,
  getConfig,
  setConfig,
  updateConfig,
  resetConfig,
  getConfigSources,
  setRuntimeConfig,
  clearConfigCache,
  reloadConfig,
  getGlobalConfig,
};
