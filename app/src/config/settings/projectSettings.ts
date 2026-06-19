/**
 * 项目级设置管理
 * 管理项目级别的共享配置，存储在 app/settings.json（通过 resolveProjectSettingsPath() 解析）
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'ProjectSettings' });
import { deepMerge } from '@modules/utils/common.js';
import { resolveProjectSettingsPath } from '@modules/core';

/**
 * 获取项目设置文件路径
 * 使用统一的 app/settings.json
 */
export function getProjectSettingsPath(projectRoot?: string): string {
  return resolveProjectSettingsPath();
}

/**
 * 加载项目设置
 */
export function loadProjectSettings(
  projectRoot?: string
): Record<string, unknown> {
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
  settings: Record<string, unknown>,
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
  updates: Record<string, unknown>,
  projectRoot?: string
): Record<string, unknown> {
  const current = loadProjectSettings(projectRoot);
  const merged = deepMerge(current, updates);
  saveProjectSettings(merged, projectRoot);
  return merged;
}
