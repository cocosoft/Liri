/**
 * MDM共享常量和路径构建器
 * 此模块零重量级导入（仅os），可安全从rawRead.ts使用
 */

import { homedir, userInfo } from 'os';
import { join } from 'path';

import { Logger, LogLevel } from '../../../monitoring/logs/Logger.js';
const logger = new Logger({
  module: 'config:settings:mdm:constants',
  level: LogLevel.INFO,
});

/**
 * macOS偏好域
 */
export const MACOS_PREFERENCE_DOMAIN = 'com.pyapp.py-app';

/**
 * Windows注册表键路径
 * 使用 SOFTWARE\Policies 路径，32位和64位进程共享
 */
export const WINDOWS_REGISTRY_KEY_PATH_HKLM = 'HKLM\\SOFTWARE\\Policies\\PyApp';
export const WINDOWS_REGISTRY_KEY_PATH_HKCU = 'HKCU\\SOFTWARE\\Policies\\PyApp';

/**
 * Windows注册表值名称
 */
export const WINDOWS_REGISTRY_VALUE_NAME = 'Settings';

/**
 * macOS plutil路径
 */
export const PLUTIL_PATH = '/usr/bin/plutil';

/**
 * plutil转换参数
 */
export const PLUTIL_ARGS_PREFIX = [
  '-convert',
  'json',
  '-o',
  '-',
  '--',
] as const;

/**
 * 子进程超时时间（毫秒）
 */
export const MDM_SUBPROCESS_TIMEOUT_MS = 5000;

/**
 * 构建macOS plist路径列表（按优先级从高到低）
 */
export function getMacOSPlistPaths(): Array<{ path: string; label: string }> {
  let username = '';
  try {
    username = userInfo().username;
  } catch (err) {
    // ignore

    logger.debug('Operation skipped', {
      context: 'ignore',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const paths: Array<{ path: string; label: string }> = [];

  if (username) {
    paths.push({
      path: `/Library/Managed Preferences/${username}/${MACOS_PREFERENCE_DOMAIN}.plist`,
      label: 'per-user managed preferences',
    });
  }

  paths.push({
    path: `/Library/Managed Preferences/${MACOS_PREFERENCE_DOMAIN}.plist`,
    label: 'device-level managed preferences',
  });

  return paths;
}
