/**
 * 受保护文件路径定义
 * 对标 Hermes agent/file_safety.py，定义精确的文件写入保护列表
 */
import os from 'node:os';
import path from 'node:path';

/**
 * 获取用户主目录
 */
function homeDir(): string {
  return os.homedir();
}

/**
 * 跨平台路径规范化
 * @param p 输入路径
 * @returns 规范化后的路径
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 17 个精确受保护文件路径
 * 这些文件的写入操作将被直接拒绝
 */
export const PROTECTED_FILES: string[] = (() => {
  const home = homeDir();

  return [
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.profile'),
    path.join(home, '.zshrc'),
    path.join(home, '.zprofile'),
    path.join(home, '.zshenv'),
    path.join(home, '.config', 'fish', 'config.fish'),
    '/etc/passwd',
    '/etc/shadow',
    '/etc/group',
    '/etc/sudoers',
    '/etc/hosts',
    '/etc/hostname',
    '/etc/fstab',
    '/etc/crontab',
    path.join(home, '.ssh', 'authorized_keys'),
    path.join(home, '.ssh', 'known_hosts'),
  ];
})();

/**
 * 9 个精确受保护目录前缀
 * 写入这些目录下的文件将被拒绝
 */
export const PROTECTED_DIRECTORY_PREFIXES: string[] = (() => {
  const home = homeDir();

  return [
    '/etc/systemd/system/',
    '/etc/init.d/',
    '/etc/apt/',
    '/etc/ssl/',
    path.join(home, '.ssh/'),
    path.join(home, '.gnupg/'),
    path.join(home, '.aws/'),
    path.join(home, '.config/gcloud/'),
    path.join(home, '.kube/'),
  ];
})();

/**
 * 跨平台的受保护文件路径映射
 * 将 Unix 风格路径转换 Windows 对应的路径（如果系统为 Windows）
 */
export function getCrossPlatformProtectedFiles(): string[] {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    return PROTECTED_FILES.map((p) => normalizePath(p));
  }

  const windowsMappings: Record<string, string> = {
    '/etc/passwd': 'C:\\Windows\\System32\\config\\SAM',
    '/etc/shadow': 'C:\\Windows\\System32\\config\\SAM',
    '/etc/group': 'C:\\Windows\\System32\\config\\SAM',
    '/etc/sudoers': 'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '/etc/hosts': 'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '/etc/hostname': 'C:\\Windows\\System32\\drivers\\etc\\hosts',
    '/etc/fstab': 'C:\\Windows\\System32\\config\\SYSTEM',
    '/etc/crontab': 'C:\\Windows\\System32\\Tasks',
    '/etc/ssl/': 'C:\\Windows\\System32\\certlm.msc',
  };

  const home = homeDir();

  return PROTECTED_FILES.map((p) => {
    const normalized = normalizePath(p);

    if (windowsMappings[normalized]) {
      return normalizePath(windowsMappings[normalized]);
    }

    return normalized;
  });
}

/**
 * 跨平台的受保护目录前缀映射
 */
export function getCrossPlatformProtectedDirectoryPrefixes(): string[] {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    return PROTECTED_DIRECTORY_PREFIXES.map((p) => normalizePath(p));
  }

  const home = homeDir();

  const windowsMappings: Record<string, string> = {
    '/etc/systemd/system/': 'C:\\Windows\\System32\\',
    '/etc/init.d/': 'C:\\Windows\\System32\\',
    '/etc/apt/': 'C:\\ProgramData\\',
    '/etc/ssl/': 'C:\\Windows\\System32\\',
  };

  return PROTECTED_DIRECTORY_PREFIXES.map((p) => {
    const normalized = normalizePath(p);

    if (windowsMappings[normalized]) {
      return normalizePath(windowsMappings[normalized]);
    }

    return normalized;
  });
}

/**
 * 判断给定路径是否匹配任一受保护文件
 * @param filePath 待检查的文件路径
 * @returns 是否受保护
 */
export function isProtectedFile(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const protectedFiles = getCrossPlatformProtectedFiles();

  for (const protectedPath of protectedFiles) {
    if (normalized === normalizePath(protectedPath)) {
      return true;
    }
  }

  return false;
}

/**
 * 判断给定路径是否在受保护目录下
 * @param filePath 待检查的文件路径
 * @returns 是否在受保护目录下
 */
export function isProtectedDirectory(filePath: string): boolean {
  const normalized = normalizePath(filePath) + '/';
  const prefixes = getCrossPlatformProtectedDirectoryPrefixes();

  for (const prefix of prefixes) {
    if (normalized.startsWith(normalizePath(prefix))) {
      return true;
    }
  }

  return false;
}

/**
 * 判断给定路径是否受写入保护
 * @param filePath 待检查的文件路径
 * @returns 是否受保护
 */
export function isWriteProtected(filePath: string): boolean {
  return isProtectedFile(filePath) || isProtectedDirectory(filePath);
}

/**
 * 获取拒绝写入的原因描述
 * @param filePath 被拒绝的路径
 * @returns 原因描述
 */
export function getWriteProtectionReason(filePath: string): string {
  if (isProtectedFile(filePath)) {
    return `路径 '${filePath}' 匹配受保护文件列表，写入被拒绝`;
  }

  if (isProtectedDirectory(filePath)) {
    return `路径 '${filePath}' 在受保护目录下，写入被拒绝`;
  }

  return '';
}
