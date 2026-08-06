/**
 * 插件目录管理
 * 负责管理插件的目录结构和路径
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { resolvePluginsDir } from '@modules/core';
import { configManager } from '@modules/config';

/**
 * 获取插件目录
 * 2026-08-06 路径收敛：统一走 core/paths 注册表 resolvePluginsDir()（~/.pyapp/plugins/），
 * 仅允许 Liri_PLUGINS_DIR 环境变量覆盖。
 * @returns 插件目录路径
 */
export function getPluginsDirectory(): string {
  // 2026-08-06 环境变量规范：标准 key 为 LIRI_PLUGINS_DIR，兼容旧驼峰 key Liri_PLUGINS_DIR
  const baseDir =
    configManager.env('LIRI_PLUGINS_DIR') ||
    configManager.env('Liri_PLUGINS_DIR') ||
    resolvePluginsDir();

  // 确保目录存在
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true });
  }

  return baseDir;
}

/**
 * 获取插件缓存目录
 * @returns 插件缓存目录路径
 */
export function getPluginCachePath(): string {
  const cachePath = join(getPluginsDirectory(), 'cache');

  // 确保目录存在
  if (!existsSync(cachePath)) {
    mkdirSync(cachePath, { recursive: true });
  }

  return cachePath;
}

/**
 * 获取插件种子目录
 * @returns 插件种子目录列表
 */
export function getPluginSeedDirs(): string[] {
  // 2026-08-06 环境变量规范：PY_COPILOT_PLUGIN_SEED_DIRS → LIRI_PLUGIN_SEED_DIRS（LIRI_ 前缀）
  const seedDirs = configManager.env('LIRI_PLUGIN_SEED_DIRS') || '';
  return seedDirs.split(';').filter((dir) => dir.trim() !== '');
}

/**
 * 获取版本化的插件缓存路径
 * @param pluginId 插件标识符
 * @param version 版本字符串
 * @returns 版本化的插件缓存路径
 */
export function getVersionedCachePath(
  pluginId: string,
  version: string
): string {
  const { name, marketplace } = parsePluginIdentifier(pluginId);
  const sanitizedMarketplace = (marketplace || 'unknown').replace(
    /[^a-zA-Z0-9\-_]/g,
    '-'
  );
  const sanitizedPlugin = (name || pluginId).replace(/[^a-zA-Z0-9\-_]/g, '-');
  const sanitizedVersion = version.replace(/[^a-zA-Z0-9\-_\.]/g, '-');

  return join(
    getPluginCachePath(),
    sanitizedMarketplace,
    sanitizedPlugin,
    sanitizedVersion
  );
}

/**
 * 获取版本化的ZIP缓存路径
 * @param pluginId 插件标识符
 * @param version 版本字符串
 * @returns 版本化的ZIP缓存路径
 */
export function getVersionedZipCachePath(
  pluginId: string,
  version: string
): string {
  return `${getVersionedCachePath(pluginId, version)}.zip`;
}

/**
 * 解析插件标识符
 * @param pluginId 插件标识符
 * @returns 解析后的插件名称和市场
 */
function parsePluginIdentifier(pluginId: string): {
  name: string | undefined;
  marketplace: string | undefined;
} {
  const parts = pluginId.split('@');
  if (parts.length === 2) {
    return {
      name: parts[0],
      marketplace: parts[1],
    };
  }
  return {
    name: pluginId,
    marketplace: undefined,
  };
}
