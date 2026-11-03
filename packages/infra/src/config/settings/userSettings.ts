/**
 * 用户全局设置管理
 * 管理用户级别的全局配置，存储在 ~/.pyapp/settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { getLogger } from '@openliri/kernel/loggerFacade';
import { handleError } from '@openliri/infra/error/handleError';

const logger = getLogger('UserSettings');
import { deepMerge } from '@openliri/infra/utils/common';
import { resolvePyappHome } from '@openliri/infra/environment';

/**
 * 用户设置文件名
 */
const USER_SETTINGS_FILE = 'settings.json';

/**
 * 项目存放位置（`settings.json` 顶层键）—— 项目**工作区根**的用户设置项。
 *
 * P2（2026-11-03）：与 `dataDirectory`（运行数据目录）刻意分开：
 * 前者是用户可见的代码/产物目录，后者是配置/会话库/附件。
 * 单一事实源：解析侧 `workspace/projectWorkspaceRoot.ts`、设置页 API 都读本常量。
 */
export const PROJECTS_DIRECTORY_SETTING_KEY = 'projectsDirectory';

/**
 * 获取用户设置文件路径
 */
export function getUserSettingsPath(): string {
  return join(resolvePyappHome(), USER_SETTINGS_FILE);
}

/**
 * 加载用户设置
 */
export function loadUserSettings(): Record<string, unknown> {
  const filePath = getUserSettingsPath();

  try {
    if (!existsSync(filePath)) {
      return {};
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    void handleError(error, {
      module: 'config:settings:user',
      action: '加载用户设置失败',
    });
    return {};
  }
}

/**
 * 保存用户设置
 */
export function saveUserSettings(settings: Record<string, unknown>): void {
  const filePath = getUserSettingsPath();

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    logger.info('User settings saved');
  } catch (error) {
    void handleError(error, {
      module: 'config:settings:user',
      action: '保存用户设置失败',
    });
    throw error;
  }
}

/**
 * 更新用户设置（合并）
 */
export function updateUserSettings(
  updates: Record<string, unknown>
): Record<string, unknown> {
  const current = loadUserSettings();
  const merged = deepMerge(current, updates);
  saveUserSettings(merged);
  return merged;
}

/**
 * 删除用户设置项
 */
export function deleteUserSetting(key: string): Record<string, unknown> {
  const current = loadUserSettings();
  deleteNestedKey(current, key.split('.'));
  saveUserSettings(current);
  return current;
}

/**
 * 删除嵌套键
 */
function deleteNestedKey(obj: Record<string, unknown>, keys: string[]): void {
  if (keys.length === 1) {
    delete obj[keys[0]];
    return;
  }

  const key = keys[0]!;
  if (typeof obj[key] === 'object' && obj[key] !== null) {
    deleteNestedKey(obj[key] as Record<string, unknown>, keys.slice(1));
    if (Object.keys(obj[key] as Record<string, unknown>).length === 0) {
      delete obj[key];
    }
  }
}
