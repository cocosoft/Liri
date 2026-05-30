/**
 * 插件目录管理
 * 负责管理插件的目录结构和路径
 */

import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { resolvePyappHome } from '@modules/config/paths';

/**
 * 获取插件目录
 * @returns 插件目录路径
 */
export function getPluginsDirectory(): string {
  const baseDir =
    process.env.Liri_PLUGINS_DIR || join(resolvePyappHome(), 'plugins');

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
  // 可以从环境变量或配置文件中获取种子目录
  const seedDirs = process.env.PY_COPILOT_PLUGIN_SEED_DIRS || '';
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
