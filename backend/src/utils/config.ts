/**
 * 配置管理工具（兼容层）
 *
 * 本文件为旧版配置系统的兼容层，所有功能委托给新的 ConfigManager 实现。
 * 新代码应直接使用 @modules/config 而非此文件。
 */

import { join } from 'path';
import { configManager } from '../config/ConfigManager.js';
import type { GlobalConfig } from '../config/types.js';
import { profileCheckpoint } from './startupProfiler.js';

export type AppConfig = GlobalConfig;

export enum ConfigSource {
  DEFAULT = 'default',
  ENV = 'env',
  FILE = 'file',
  RUNTIME = 'runtime',
}

export interface ConfigValidationRule {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: any;
  validate?: (value: any) => boolean;
  message?: string;
}

let runtimeOverrides: Record<string, unknown> = {};

export function getConfigPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.PY_APP', 'config.json');
}

export function enableConfigs(): void {
  profileCheckpoint('config_enable_start');
  configManager.enableConfigs();
  profileCheckpoint('config_enable_end');
}

export function getGlobalConfig(): GlobalConfig {
  return configManager.getGlobalConfig();
}

export function getConfig(key?: string): any {
  profileCheckpoint('config_get_start');

  if (key) {
    const value = configManager.getConfigValue(key);
    const runtimeValue = runtimeOverrides[key];
    const result = runtimeValue !== undefined ? runtimeValue : value;
    profileCheckpoint('config_get_end');
    return result;
  }

  const baseConfig = configManager.getGlobalConfig();
  const merged = { ...baseConfig, ...runtimeOverrides };
  profileCheckpoint('config_get_end');
  return merged;
}

export function setConfig(key: string, value: any): void {
  profileCheckpoint('config_set_start');
  delete runtimeOverrides[key];
  configManager.setConfigValue(key, value);
  profileCheckpoint('config_set_end');
}

export function updateConfig(updates: Partial<GlobalConfig>): void {
  profileCheckpoint('config_update_start');

  for (const [key, value] of Object.entries(updates)) {
    delete runtimeOverrides[key];
    configManager.setConfigValue(key, value);
  }

  profileCheckpoint('config_update_end');
}

export function resetConfig(): void {
  runtimeOverrides = {};
  configManager.resetConfig();
}

export function getConfigSources(): Record<string, unknown> {
  return {
    [ConfigSource.DEFAULT]: {},
    [ConfigSource.ENV]: {},
    [ConfigSource.FILE]: configManager.getGlobalConfig(),
    runtimeOverrides: { ...runtimeOverrides },
  };
}

export function setRuntimeConfig(updates: Partial<GlobalConfig>): void {
  Object.assign(runtimeOverrides, updates);
}

export function clearConfigCache(): void {
  configManager.clearCache();
}

export function reloadConfig(): GlobalConfig {
  return configManager.reloadConfig();
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
