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
 * 在 Windows 上使用 Windows 原生关键文件替代 Unix /etc/ 路径
 */
export function getCrossPlatformProtectedFiles(): string[] {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    return PROTECTED_FILES.map((p) => normalizePath(p));
  }

  const home = homeDir();
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';

  // Windows 受保护文件列表：逐一映射，避免多个 Unix 路径指向同一 Windows 路径
  const windowsProtected: string[] = [
    // 保留跨平台通用的家目录配置文件
    path.join(home, '.bashrc'),
    path.join(home, '.bash_profile'),
    path.join(home, '.profile'),
    path.join(home, '.zshrc'),
    path.join(home, '.zprofile'),
    path.join(home, '.zshenv'),
    path.join(home, '.config', 'fish', 'config.fish'),
    path.join(home, '.ssh', 'authorized_keys'),
    path.join(home, '.ssh', 'known_hosts'),
    // Windows 系统注册表配置单元（替换 /etc/passwd、/etc/shadow、/etc/group）
    path.join(sysRoot, 'System32', 'config', 'SAM'),
    path.join(sysRoot, 'System32', 'config', 'SECURITY'),
    path.join(sysRoot, 'System32', 'config', 'SOFTWARE'),
    // Windows 系统配置（替换 /etc/sudoers）
    path.join(sysRoot, 'System32', 'GroupPolicy', 'Machine', 'Registry.pol'),
    // Windows hosts 文件（替换 /etc/hosts）
    path.join(sysRoot, 'System32', 'drivers', 'etc', 'hosts'),
    // Windows 计算机名/网络配置（替换 /etc/hostname）
    path.join(sysRoot, 'System32', 'drivers', 'etc', 'networks'),
    // Windows 注册表 SYSTEM 配置单元（替换 /etc/fstab）
    path.join(sysRoot, 'System32', 'config', 'SYSTEM'),
    // Windows 计划任务目录（替换 /etc/crontab）
    path.join(sysRoot, 'System32', 'Tasks'),
  ];

  return windowsProtected.map((p) => normalizePath(p));
}

/**
 * 跨平台的受保护目录前缀映射
 * 在 Windows 上使用 Windows 原生系统目录替代 Unix /etc/ 前缀
 */
export function getCrossPlatformProtectedDirectoryPrefixes(): string[] {
  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    return PROTECTED_DIRECTORY_PREFIXES.map((p) => normalizePath(p));
  }

  const home = homeDir();
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const programData = process.env.ProgramData || 'C:\\ProgramData';

  return [
    // Windows 系统目录（替换 /etc/systemd/system/、/etc/init.d/）
    normalizePath(path.join(sysRoot, 'System32', 'Tasks')) + '/',
    normalizePath(path.join(sysRoot, 'System32', 'GroupPolicy')) + '/',
    normalizePath(path.join(sysRoot, 'System32', 'config')) + '/',
    // Windows 程序数据目录（替换 /etc/apt/）
    normalizePath(path.join(programData)) + '/',
    // Windows SSL 管理（替换 /etc/ssl/）
    normalizePath(path.join(sysRoot, 'System32', 'certlm.msc')) + '/',
    // Windows 服务配置（替换 /etc/systemd/system/）
    normalizePath(path.join(sysRoot, 'System32', 'drivers', 'etc')) + '/',
    // 保留跨平台通用的家目录前缀
    normalizePath(path.join(home, '.ssh')) + '/',
    normalizePath(path.join(home, '.gnupg')) + '/',
    normalizePath(path.join(home, '.aws')) + '/',
    normalizePath(path.join(home, '.config', 'gcloud')) + '/',
    normalizePath(path.join(home, '.kube')) + '/',
  ];
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
