/**
 * 本地设置管理（gitignored）
 * 管理项目级别的本地配置（不提交到版本控制），存储在 ~/.pyapp/settings.local.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from '../../monitoring/logs/Logger.js';
import { handleError } from '@modules/error';

const logger = getLogger('LocalSettings');
import { deepMerge } from '@modules/utils/common.js';
import { resolvePyappHome } from '@modules/core';

/**
 * 本地设置文件名
 */
const LOCAL_SETTINGS_FILE = 'settings.local.json';

/**
 * 获取本地设置文件路径
 * 存储在用户主目录 ~/.pyapp/settings.local.json
 */
export function getLocalSettingsPath(projectRoot?: string): string {
  return join(resolvePyappHome(), LOCAL_SETTINGS_FILE);
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
    void handleError(error, {
      module: 'config:settings:local',
      action: '加载本地设置失败',
    });
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
    void handleError(error, {
      module: 'config:settings:local',
      action: '保存本地设置失败',
    });
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
