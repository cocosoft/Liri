/**
 * 本地设置管理（gitignored）
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的本地设置部分
 * 管理项目级别的本地配置（不提交到版本控制），存储在 .py_app/settings.local.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '@modules/utils/log.js';
import { deepMerge } from '@modules/utils/common.js';

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
export function loadLocalSettings(
  projectRoot?: string
): Record<string, unknown> {
  const filePath = getLocalSettingsPath(projectRoot);

  try {
    if (!existsSync(filePath)) {
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(
      'Failed to load local settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    return {};
  }
}

/**
 * 保存本地设置
 */
export function saveLocalSettings(
  settings: Record<string, unknown>,
  projectRoot?: string
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
    logger.error(
      'Failed to save local settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * 更新本地设置（合并）
 */
export function updateLocalSettings(
  updates: Record<string, unknown>,
  projectRoot?: string
): Record<string, unknown> {
  const current = loadLocalSettings(projectRoot);
  const merged = deepMerge(current, updates);
  saveLocalSettings(merged, projectRoot);
  return merged;
}
