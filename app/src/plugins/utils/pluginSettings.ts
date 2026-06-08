//
/**
 * 插件配置管理
 * 负责加载和保存插件配置
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { PluginConfig, PluginRepository } from '../types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 读取插件配置
 * @param configPath 配置文件路径
 * @returns 插件配置
 */
export function readPluginConfig(
  configPath: string = './settings.json'
): PluginConfig {
  if (!existsSync(configPath)) {
    return {
      repositories: {},
      enabled: [],
      disabled: [],
    };
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    return {
      repositories: config.plugins?.repositories || {},
      enabled: config.plugins?.enabled || [],
      disabled: config.plugins?.disabled || [],
    };
  } catch (error) {
    logger.error('Failed to read plugin config:', { error });
    return {
      repositories: {},
      enabled: [],
      disabled: [],
    };
  }
}

/**
 * 写入插件配置
 * @param configPath 配置文件路径
 * @param config 插件配置
 */
export function writePluginConfig(
  configPath: string = './settings.json',
  config: PluginConfig
): void {
  try {
    // 读取现有配置
    let existingConfig: any = {};
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      existingConfig = JSON.parse(content);
    }

    // 更新插件配置
    existingConfig.plugins = {
      repositories: config.repositories,
      enabled: config.enabled,
      disabled: config.disabled,
    };

    // 写入配置文件
    const content = JSON.stringify(existingConfig, null, 2);
    writeFileSync(configPath, content, 'utf8');
  } catch (error) {
    logger.error('Failed to write plugin config:', { error });
  }
}

/**
 * 添加插件到启用列表
 * @param configPath 配置文件路径
 * @param pluginId 插件标识符
 */
export function enablePlugin(
  configPath: string = './settings.json',
  pluginId: string
): void {
  const config = readPluginConfig(configPath);

  const enabled = config.enabled ?? [];
  const disabled = config.disabled ?? [];

  // 从禁用列表中移除
  config.disabled = disabled.filter((id) => id !== pluginId);

  // 添加到启用列表
  if (!enabled.includes(pluginId)) {
    config.enabled = [...enabled, pluginId];
  }

  writePluginConfig(configPath, config);
}

/**
 * 添加插件到禁用列表
 * @param configPath 配置文件路径
 * @param pluginId 插件标识符
 */
export function disablePlugin(
  configPath: string = './settings.json',
  pluginId: string
): void {
  const config = readPluginConfig(configPath);
  const enabled = config.enabled ?? [];
  const disabled = config.disabled ?? [];

  // 从启用列表中移除
  config.enabled = enabled.filter((id) => id !== pluginId);

  // 添加到禁用列表
  if (!disabled.includes(pluginId)) {
    config.disabled = [...disabled, pluginId];
  }

  writePluginConfig(configPath, config);
}

/**
 * 移除插件
 * @param configPath 配置文件路径
 * @param pluginId 插件标识符
 */
export function removePlugin(
  configPath: string = './settings.json',
  pluginId: string
): void {
  const config = readPluginConfig(configPath);
  const enabled = config.enabled ?? [];
  const disabled = config.disabled ?? [];

  // 从启用列表中移除
  config.enabled = enabled.filter((id) => id !== pluginId);

  // 从禁用列表中移除
  config.disabled = disabled.filter((id) => id !== pluginId);

  writePluginConfig(configPath, config);
}

/**
 * 添加插件仓库
 * @param configPath 配置文件路径
 * @param name 仓库名称
 * @param repository 仓库配置
 */
export function addPluginRepository(
  configPath: string = './settings.json',
  name: string,
  repository: PluginRepository
): void {
  const config = readPluginConfig(configPath);
  config.repositories = { ...(config.repositories ?? {}), [name]: repository };
  writePluginConfig(configPath, config);
}

/**
 * 移除插件仓库
 * @param configPath 配置文件路径
 * @param name 仓库名称
 */
export function removePluginRepository(
  configPath: string = './settings.json',
  name: string
): void {
  const config = readPluginConfig(configPath);
  if (config.repositories) {
    delete config.repositories[name];
  }
  writePluginConfig(configPath, config);
}

/**
 * 检查插件是否启用
 * @param configPath 配置文件路径
 * @param pluginId 插件标识符
 * @returns 是否启用
 */
export function isPluginEnabled(
  configPath: string = './settings.json',
  pluginId: string
): boolean {
  const config = readPluginConfig(configPath);
  return (config.enabled ?? []).includes(pluginId);
}

/**
 * 检查插件是否已安装
 * @param configPath 配置文件路径
 * @param pluginId 插件标识符
 * @returns 是否已安装
 */
export function isPluginInstalled(
  configPath: string = './settings.json',
  pluginId: string
): boolean {
  const config = readPluginConfig(configPath);
  return (
    (config.enabled ?? []).includes(pluginId) ||
    (config.disabled ?? []).includes(pluginId)
  );
}
