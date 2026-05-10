/**
 * 策略设置管理（企业托管）
 * 基于CC源码 cc_code/backend/utils/settings/settings.ts 的策略设置部分
 * 管理企业级托管配置，支持 managed-settings.json 和 drop-in 目录
 * 策略设置优先级最高，且不可被用户/项目设置覆盖
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { logger } from '@modules/utils/log.js';
import { deepMerge } from '@modules/utils/common.js';

/**
 * 托管设置文件名
 */
const MANAGED_SETTINGS_FILE = 'managed-settings.json';

/**
 * Drop-in 目录名
 */
const MANAGED_DROPIN_DIR = 'managed-settings.d';

/**
 * 获取托管设置目录路径
 */
export function getManagedSettingsDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '.';
  return join(homeDir, '.py_app');
}

/**
 * 获取托管设置文件路径
 */
export function getManagedSettingsPath(): string {
  return join(getManagedSettingsDir(), MANAGED_SETTINGS_FILE);
}

/**
 * 获取 drop-in 目录路径
 */
export function getManagedDropInDir(): string {
  return join(getManagedSettingsDir(), MANAGED_DROPIN_DIR);
}

/**
 * 加载托管文件设置
 * 先加载 managed-settings.json 作为基础
 * 再按字母顺序加载 managed-settings.d/*.json 覆盖
 * 遵循 systemd/sudoers 的 drop-in 约定
 */
export function loadManagedFileSettings(): {
  settings: Record<string, any>;
  errors: Array<{ file: string; message: string }>;
} {
  const errors: Array<{ file: string; message: string }> = [];
  let merged: Record<string, any> = {};

  const managedPath = getManagedSettingsPath();
  if (existsSync(managedPath)) {
    try {
      const content = readFileSync(managedPath, 'utf-8');
      merged = JSON.parse(content);
    } catch (error) {
      errors.push({
        file: managedPath,
        message: `Failed to parse: ${error}`,
      });
    }
  }

  const dropInDir = getManagedDropInDir();
  if (existsSync(dropInDir)) {
    try {
      const files = readdirSync(dropInDir)
        .filter((f) => f.endsWith('.json'))
        .sort();

      for (const file of files) {
        const filePath = join(dropInDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const dropInConfig = JSON.parse(content);
          merged = deepMerge(merged, dropInConfig);
        } catch (error) {
          errors.push({
            file: filePath,
            message: `Failed to parse: ${error}`,
          });
        }
      }
    } catch (error) {
      errors.push({
        file: dropInDir,
        message: `Failed to read drop-in directory: ${error}`,
      });
    }
  }

  return { settings: merged, errors };
}

/**
 * 加载策略设置
 * 合并文件托管设置和远程托管设置
 */
export function loadPolicySettings(): Record<string, any> {
  const { settings, errors } = loadManagedFileSettings();

  if (errors.length > 0) {
    for (const error of errors) {
      logger.warn(`Policy settings error in ${error.file}: ${error.message}`);
    }
  }

  return settings;
}

/**
 * 检查是否启用了策略设置
 */
export function isPolicySettingsAvailable(): boolean {
  const managedPath = getManagedSettingsPath();
  const dropInDir = getManagedDropInDir();
  return existsSync(managedPath) || existsSync(dropInDir);
}
