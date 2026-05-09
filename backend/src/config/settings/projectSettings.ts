/**
 * 项目级设置管理
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的项目设置部分
 * 管理项目级别的共享配置，存储在项目根目录的 .py_app/settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '@modules/utils/log.js';

/**
 * 项目设置目录名
 */
const PROJECT_SETTINGS_DIR = '.py_app';

/**
 * 项目设置文件名
 */
const PROJECT_SETTINGS_FILE = 'settings.json';

/**
 * 获取项目设置文件路径
 */
export function getProjectSettingsPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  return join(root, PROJECT_SETTINGS_DIR, PROJECT_SETTINGS_FILE);
}

/**
 * 加载项目设置
 */
export function loadProjectSettings(projectRoot?: string): Record<string, any> {
  const filePath = getProjectSettingsPath(projectRoot);

  try {
    if (!existsSync(filePath)) {
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.error(
      'Failed to load project settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    return {};
  }
}

/**
 * 保存项目设置
 */
export function saveProjectSettings(
  settings: Record<string, any>,
  projectRoot?: string
): void {
  const filePath = getProjectSettingsPath(projectRoot);

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info('Project settings saved');
  } catch (error) {
    logger.error(
      'Failed to save project settings:',
      error instanceof Error ? error : new Error(String(error))
    );
    throw error;
  }
}

/**
 * 更新项目设置（合并）
 */
export function updateProjectSettings(
  updates: Record<string, any>,
  projectRoot?: string
): Record<string, any> {
  const current = loadProjectSettings(projectRoot);
  const merged = deepMerge(current, updates);
  saveProjectSettings(merged, projectRoot);
  return merged;
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
