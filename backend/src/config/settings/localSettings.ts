// @ts-nocheck
/**
 * 本地设置管理（gitignored）
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的本地设置部分
 * 管理项目级别的本地配置（不提交到版本控制），存储在 .py_app/settings.local.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../../utils/log.js';

/**
 * 本地设置文件名
 */
const LOCAL_SETTINGS_FILE = 'settings.local.json';

/**
 * 项目设置目录名
 */
const PROJECT_SETTINGS_DIR = '.py_app';

/**
 * 获取本地设置文件路径
 */
export function getLocalSettingsPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  return join(root, PROJECT_SETTINGS_DIR, LOCAL_SETTINGS_FILE);
}

/**
 * 加载本地设置
 */
export function loadLocalSettings(projectRoot?: string): Record<string, any> {
  const filePath = getLocalSettingsPath(projectRoot);

  try {
    if (!existsSync(filePath)) {
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error('Failed to load local settings:', error);
    return {};
  }
}

/**
 * 保存本地设置
 */
export function saveLocalSettings(
  settings: Record<string, any>,
  projectRoot?: string,
): void {
  const filePath = getLocalSettingsPath(projectRoot);

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info('Local settings saved');
  } catch (error) {
    logger.error('Failed to save local settings:', error);
    throw error;
  }
}

/**
 * 更新本地设置（合并）
 */
export function updateLocalSettings(
  updates: Record<string, any>,
  projectRoot?: string,
): Record<string, any> {
  const current = loadLocalSettings(projectRoot);
  const merged = deepMerge(current, updates);
  saveLocalSettings(merged, projectRoot);
  return merged;
}

/**
 * 深度合并对象
 */
function deepMerge(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (
      key in result &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      typeof source[key] === 'object' &&
      source[key] !== null &&
      !Array.isArray(result[key]) &&
      !Array.isArray(source[key])
    ) {
      result[key] = deepMerge(result[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}
