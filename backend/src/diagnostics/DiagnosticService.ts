/**
 * 诊断系统
 * 实现安装类型检测、多安装实例检测和配置问题检测
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { realpath } from 'fs/promises';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 安装类型
 */
export type InstallationType =
  | 'npm-global'
  | 'npm-local'
  | 'native'
  | 'package-manager'
  | 'development'
  | 'unknown';

/**
 * 安装信息
 */
export interface InstallationInfo {
  type: InstallationType;
  path: string;
}

/**
 * 警告信息
 */
export interface Warning {
  issue: string;
  fix: string;
}

/**
 * 诊断信息
 */
export interface DiagnosticInfo {
  installationType: InstallationType;
  version: string;
  installationPath: string;
  invokedBinary: string;
  multipleInstallations: InstallationInfo[];
  warnings: Warning[];
  recommendation?: string;
}

/**
 * 包管理器类型
 */
export type PackageManager =
  | 'homebrew'
  | 'winget'
  | 'mise'
  | 'asdf'
  | 'pacman'
  | 'deb'
  | 'rpm'
  | 'apk'
  | 'unknown';

/**
 * 检测Homebrew安装
 */
function detectHomebrew(): boolean {
  try {
    const result = execSync('which brew', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('brew');
  } catch {
    return false;
  }
}

/**
 * 检测Winget安装
 */
function detectWinget(): boolean {
  if (process.platform !== 'win32') {
    return false;
  }
  try {
    const result = execSync('where winget', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('winget');
  } catch {
    return false;
  }
}

/**
 * 检测Mise安装
 */
function detectMise(): boolean {
  try {
    const result = execSync('which mise', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('mise');
  } catch {
    return false;
  }
}

/**
 * 检测Asdf安装
 */
function detectAsdf(): boolean {
  try {
    const result = execSync('which asdf', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('asdf');
  } catch {
    return false;
  }
}

/**
 * 检测Pacman安装
 */
async function detectPacman(): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const result = execSync('which pacman', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('pacman');
  } catch {
    return false;
  }
}

/**
 * 检测Deb安装
 */
async function detectDeb(): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const result = execSync('which dpkg', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('dpkg');
  } catch {
    return false;
  }
}

/**
 * 检测Rpm安装
 */
async function detectRpm(): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const result = execSync('which rpm', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('rpm');
  } catch {
    return false;
  }
}

/**
 * 检测Apk安装
 */
async function detectApk(): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const result = execSync('which apk', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.includes('apk');
  } catch {
    return false;
  }
}

/**
 * 获取当前安装类型
 */
export async function getCurrentInstallationType(): Promise<InstallationType> {
  // 开发模式
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }

  const invokedPath = process.argv[1] || process.argv[0] || '';

  // 检查npm全局安装路径
  const npmGlobalPaths = [
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    '/opt/homebrew/lib/node_modules',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];

  if (npmGlobalPaths.some((p) => invokedPath.includes(p))) {
    return 'npm-global';
  }

  // 检查nvm安装
  if (
    invokedPath.includes('/.nvm/versions/node/') ||
    invokedPath.includes('/nvm/')
  ) {
    return 'npm-global';
  }

  // 检查npm本地安装
  const localPath = path.join(homedir(), '.claude', 'local');
  try {
    await fs.promises.access(localPath);
    return 'npm-local';
  } catch {
    // 不存在
  }

  // 检查是否在打包模式下运行
  const isBundled =
    invokedPath.includes('bundle') || invokedPath.includes('dist');

  if (isBundled) {
    // 检查包管理器安装
    if (
      detectHomebrew() ||
      detectWinget() ||
      detectMise() ||
      detectAsdf() ||
      (await detectPacman()) ||
      (await detectDeb()) ||
      (await detectRpm()) ||
      (await detectApk())
    ) {
      return 'package-manager';
    }
    return 'native';
  }

  // 检查npm路径
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (invokedPath.startsWith(npmPrefix)) {
      return 'npm-global';
    }
  } catch {
    // npm命令失败
  }

  return 'unknown';
}

/**
 * 获取安装路径
 */
export async function getInstallationPath(): Promise<string> {
  if (process.env.NODE_ENV === 'development') {
    return process.cwd();
  }

  try {
    const realPath = await realpath(process.execPath);
    return realPath;
  } catch {
    // 返回未知
  }

  return process.execPath || 'unknown';
}

/**
 * 获取调用的二进制文件路径
 */
export function getInvokedBinary(): string {
  try {
    return process.execPath || process.argv[0] || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 检测多个安装实例
 */
export async function detectMultipleInstallations(): Promise<
  InstallationInfo[]
> {
  const installations: InstallationInfo[] = [];

  // 检查本地npm安装
  const localPath = path.join(homedir(), '.claude', 'local');
  try {
    await fs.promises.access(localPath);
    installations.push({ type: 'npm-local', path: localPath });
  } catch {
    // 不存在
  }

  // 检查全局npm安装
  try {
    const npmPrefix = execSync('npm config get prefix', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const isWindows = process.platform === 'win32';
    const globalBinPath = isWindows
      ? path.join(npmPrefix, 'claude')
      : path.join(npmPrefix, 'bin', 'claude');

    try {
      await fs.promises.access(globalBinPath);
      installations.push({ type: 'npm-global', path: globalBinPath });
    } catch {
      // 不存在
    }
  } catch {
    // npm命令失败
  }

  // 检查原生安装
  const nativeBinPath = path.join(homedir(), '.local', 'bin', 'claude');
  try {
    await fs.promises.access(nativeBinPath);
    installations.push({ type: 'native', path: nativeBinPath });
  } catch {
    // 不存在
  }

  return installations;
}

/**
 * 检测配置问题
 */
export async function detectConfigurationIssues(
  type: InstallationType
): Promise<Warning[]> {
  const warnings: Warning[] = [];

  // 开发模式不检查
  if (type === 'development') {
    return warnings;
  }

  // 检查PATH中是否包含.local/bin（原生安装）
  if (type === 'native') {
    const pathEnv = process.env.PATH || '';
    const pathDirectories = pathEnv.split(path.delimiter);
    const localBinPath = path.join(homedir(), '.local', 'bin');

    const localBinInPath = pathDirectories.some((dir) => {
      const normalizedDir = dir.replace(/[/\\]+$/, '');
      const normalizedLocalBin = localBinPath.replace(/[/\\]+$/, '');
      return normalizedDir === normalizedLocalBin;
    });

    if (!localBinInPath) {
      warnings.push({
        issue: `原生安装存在但 ${localBinPath} 不在PATH中`,
        fix: `在shell配置文件中添加: export PATH="$HOME/.local/bin:$PATH"`,
      });
    }
  }

  // 检查npm全局安装和本地安装同时存在
  if (type === 'npm-global') {
    const localPath = path.join(homedir(), '.claude', 'local');
    try {
      await fs.promises.access(localPath);
      warnings.push({
        issue: '同时存在本地安装',
        fix: '考虑使用原生安装: claude install',
      });
    } catch {
      // 不存在
    }
  }

  // 检查本地安装不在PATH中
  if (type === 'npm-local') {
    try {
      const whichResult = execSync('which claude', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (!whichResult.includes('claude')) {
        warnings.push({
          issue: '本地安装不在PATH中',
          fix: '创建别名: alias claude="~/.claude/local/claude"',
        });
      }
    } catch {
      warnings.push({
        issue: '本地安装不可访问',
        fix: '创建别名: alias claude="~/.claude/local/claude"',
      });
    }
  }

  return warnings;
}

/**
 * 获取推荐的安装类型
 */
export function getInstallationRecommendation(type: InstallationType): string {
  switch (type) {
    case 'npm-global':
      return '建议使用原生安装以获得更好的性能和自动更新支持。运行: claude install';
    case 'npm-local':
      return '本地安装运行正常。考虑使用原生安装以获得更好的集成体验。';
    case 'unknown':
      return '无法确定安装类型。请尝试使用原生安装: claude install';
    case 'native':
    case 'package-manager':
    case 'development':
    default:
      return '安装正常';
  }
}

/**
 * 获取诊断信息
 */
export async function getDiagnosticInfo(): Promise<DiagnosticInfo> {
  const installationType = await getCurrentInstallationType();
  const installationPath = await getInstallationPath();
  const invokedBinary = getInvokedBinary();
  const multipleInstallations = await detectMultipleInstallations();
  const warnings = await detectConfigurationIssues(installationType);
  const recommendation = getInstallationRecommendation(installationType);

  return {
    installationType,
    version: '1.0.0',
    installationPath,
    invokedBinary,
    multipleInstallations,
    warnings,
    recommendation,
  };
}

/**
 * 打印诊断信息
 */
export async function printDiagnosticInfo(): Promise<void> {
  const info = await getDiagnosticInfo();

  logger.info('=== 诊断信息 ===');
  logger.info(`安装类型: ${info.installationType}`);
  logger.info(`安装路径: ${info.installationPath}`);
  logger.info(`调用二进制: ${info.invokedBinary}`);
  logger.info(`版本: ${info.version}`);

  if (info.multipleInstallations.length > 0) {
    logger.info('\n=== 检测到多个安装 ===');
    for (const install of info.multipleInstallations) {
      logger.info(`- 类型: ${install.type}, 路径: ${install.path}`);
    }
  }

  if (info.warnings.length > 0) {
    logger.info('\n=== 警告 ===');
    for (const warning of info.warnings) {
      logger.info(`- 问题: ${warning.issue}`);
      logger.info(`  修复: ${warning.fix}`);
    }
  }

  if (info.recommendation) {
    logger.info(`\n建议: ${info.recommendation}`);
  }
}
