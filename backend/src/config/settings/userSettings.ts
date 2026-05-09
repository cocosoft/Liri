/**
 * 用户全局设置管理
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的用户设置部分
 * 管理用户级别的全局配置，存储在 ~/.py_app/settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '@modules/utils/log.js';

/**
 * 用户设置文件名
 */
const USER_SETTINGS_FILE = 'settings.json';

/**
 * 获取用户设置文件路径
 */
export function getUserSettingsPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.py_app', USER_SETTINGS_FILE);
}

/**
 * 加载用户设置
 */
export function loadUserSettings(): Record<string, any> {
  const filePath = getUserSettingsPath();

  try {
    if (!existsSync(filePath)) {
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(
      'Failed to load user settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    return {};
  }
}

/**
 * 保存用户设置
 */
export function saveUserSettings(settings: Record<string, any>): void {
  const filePath = getUserSettingsPath();

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info('User settings saved');
  } catch (error) {
    logger.error(
      'Failed to save user settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * 更新用户设置（合并）
 */
export function updateUserSettings(
  updates: Record<string, any>
): Record<string, any> {
  const current = loadUserSettings();
  const merged = deepMerge(current, updates);
  saveUserSettings(merged);
  return merged;
}

/**
 * 删除用户设置项
 */
export function deleteUserSetting(key: string): Record<string, any> {
  const current = loadUserSettings();
  deleteNestedKey(current, key.split('.'));
  saveUserSettings(current);
  return current;
}

/**
 * 深度合并对象
 */
function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>
): Record<string, any> {
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

/**
 * 删除嵌套键
 */
function deleteNestedKey(obj: Record<string, any>, keys: string[]): void {
  if (keys.length === 1) {
    delete obj[keys[0]];
    return;
  }

  const key = keys[0]!;
  if (typeof obj[key] === 'object' && obj[key] !== null) {
    deleteNestedKey(obj[key], keys.slice(1));
    if (Object.keys(obj[key]).length === 0) {
      delete obj[key];
    }
  }
}
