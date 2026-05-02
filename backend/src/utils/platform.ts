/**
 * 平台工具
 */

/**
 * 平台类型
 */
export type Platform = 'win32' | 'darwin' | 'linux' | 'wsl' | 'unknown';

/**
 * 获取当前平台
 */
export function getPlatform(): Platform {
  const platform = process.platform;

  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    // 检查是否是WSL
    if (platform === 'linux') {
      try {
        const fs = require('fs');
        const isWSL =
          fs.existsSync('/proc/version') &&
          fs.readFileSync('/proc/version', 'utf8').includes('microsoft');
        if (isWSL) {
          return 'wsl';
        }
      } catch {
        // 忽略错误
      }
    }
    return platform as Platform;
  }

  return 'unknown';
}

/**
 * 检查是否是Windows平台
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * 检查是否是macOS平台
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * 检查是否是Linux平台
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * 检查是否是WSL
 */
export function isWSL(): boolean {
  return getPlatform() === 'wsl';
}

/**
 * 获取WSL版本
 */
export function getWslVersion(): string | null {
  if (getPlatform() !== 'wsl') {
    return null;
  }

  try {
    const fs = require('fs');
    if (fs.existsSync('/proc/version')) {
      const versionInfo = fs.readFileSync('/proc/version', 'utf8');
      const match = versionInfo.match(/Microsoft WSL (\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  } catch {
    // 忽略错误
  }

  return null;
}
