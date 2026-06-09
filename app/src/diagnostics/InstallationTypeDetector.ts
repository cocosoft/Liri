//
/**
 * 安装类型检测服务
 * 提供应用安装类型检测功能
 * 参考CC源码: cc_code/backend/utils/doctorDiagnostic.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { platform, homedir } from 'os';
import { configManager } from '@modules/config';
import { delimiter, join, sep } from 'path';

const execAsync = promisify(exec) as (
  command: string,
  options?: Record<string, unknown>
) => Promise<{ stdout: string; stderr: string }>;

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
  version?: string;
  packageManager?: string;
}

/**
 * 多安装实例信息
 */
export interface MultipleInstallationInfo {
  installations: InstallationInfo[];
  hasMultiple: boolean;
  recommendation?: string;
}

/**
 * 安装类型检测服务类
 */
export class InstallationTypeDetector {
  private static instance: InstallationTypeDetector;
  private currentInstallation: InstallationInfo | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): InstallationTypeDetector {
    if (!InstallationTypeDetector.instance) {
      InstallationTypeDetector.instance = new InstallationTypeDetector();
    }
    return InstallationTypeDetector.instance;
  }

  /**
   * 检测当前安装类型
   */
  async detectInstallationType(): Promise<InstallationInfo> {
    if (this.currentInstallation) {
      return this.currentInstallation;
    }

    const type = await this.determineInstallationType();
    const path = this.getInstallationPath();
    const version = await this.getVersion();
    const packageManager = await this.detectPackageManager();

    this.currentInstallation = {
      type,
      path,
      version,
      packageManager,
    };

    return this.currentInstallation;
  }

  /**
   * 确定安装类型
   */
  private async determineInstallationType(): Promise<InstallationType> {
    if (
      configManager.env('NODE_ENV') === 'development' ||
      configManager.env('NODE_ENV') === 'test'
    ) {
      return 'development';
    }

    const invokedPath = process.argv[1] || '';
    const execPath = process.execPath || process.argv[0] || '';

    if (this.isInBundledMode(execPath)) {
      const packageManager = await this.detectPackageManager();
      if (packageManager) {
        return 'package-manager';
      }
      return 'native';
    }

    if (this.isRunningFromLocalInstallation(invokedPath)) {
      return 'npm-local';
    }

    if (await this.isNpmGlobalInstallation(invokedPath)) {
      return 'npm-global';
    }

    return 'unknown';
  }

  /**
   * 检查是否在打包模式下运行
   */
  private isInBundledMode(execPath: string): boolean {
    const currentPlatform = platform();

    if (currentPlatform === 'win32') {
      return execPath.includes(`${sep}Liri.exe`) || execPath.endsWith('.exe');
    }

    return (
      execPath.includes(`${sep}Liri`) &&
      !execPath.includes('node_modules') &&
      !execPath.includes('node')
    );
  }

  /**
   * 检查是否从本地安装运行
   */
  private isRunningFromLocalInstallation(invokedPath: string): boolean {
    return (
      invokedPath.includes('node_modules') &&
      !invokedPath.includes('node_modules' + sep + 'bin')
    );
  }

  /**
   * 检查是否为npm全局安装
   */
  private async isNpmGlobalInstallation(invokedPath: string): Promise<boolean> {
    const npmGlobalPaths = [
      join(sep, 'usr', 'local', 'lib', 'node_modules'),
      join(sep, 'usr', 'lib', 'node_modules'),
      join(sep, 'opt', 'homebrew', 'lib', 'node_modules'),
      join(sep, 'opt', 'homebrew', 'bin'),
      join(sep, 'usr', 'local', 'bin'),
    ];

    if (npmGlobalPaths.some((path) => invokedPath.includes(path))) {
      return true;
    }

    if (
      invokedPath.includes(join(sep, 'npm' + sep)) ||
      invokedPath.includes(join(sep, 'nvm' + sep))
    ) {
      return true;
    }

    try {
      const { stdout } = await execAsync('npm config get prefix', {
        shell: true,
      });
      const globalPrefix = stdout.trim();
      if (globalPrefix && invokedPath.startsWith(globalPrefix)) {
        return true;
      }
    } catch (error) {
      // npm命令不可用，忽略
    }

    return false;
  }

  /**
   * 检测包管理器
   */
  private async detectPackageManager(): Promise<string | undefined> {
    const currentPlatform = platform();

    if (currentPlatform === 'darwin') {
      if (await this.detectHomebrew()) {
        return 'homebrew';
      }
      if (await this.detectMise()) {
        return 'mise';
      }
    }

    if (currentPlatform === 'win32') {
      if (await this.detectWinget()) {
        return 'winget';
      }
    }

    if (currentPlatform === 'linux') {
      if (await this.detectApt()) {
        return 'apt';
      }
      if (await this.detectYum()) {
        return 'yum';
      }
      if (await this.detectPacman()) {
        return 'pacman';
      }
    }

    return undefined;
  }

  /**
   * 检测Homebrew
   */
  private async detectHomebrew(): Promise<boolean> {
    try {
      await execAsync('which brew', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测Mise
   */
  private async detectMise(): Promise<boolean> {
    try {
      await execAsync('which mise', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测Winget
   */
  private async detectWinget(): Promise<boolean> {
    try {
      await execAsync('where winget', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测Apt
   */
  private async detectApt(): Promise<boolean> {
    try {
      await execAsync('which apt', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测Yum
   */
  private async detectYum(): Promise<boolean> {
    try {
      await execAsync('which yum', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 检测Pacman
   */
  private async detectPacman(): Promise<boolean> {
    try {
      await execAsync('which pacman', { shell: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取安装路径
   */
  private getInstallationPath(): string {
    return process.argv[1] || process.cwd();
  }

  /**
   * 获取版本
   */
  private async getVersion(): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync('py-app --version', { shell: true });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  /**
   * 检测多个安装实例
   */
  async detectMultipleInstallations(): Promise<MultipleInstallationInfo> {
    const installations: InstallationInfo[] = [];
    const currentInstallation = await this.detectInstallationType();

    installations.push(currentInstallation);

    try {
      const { stdout } = await execAsync('where py-app', { shell: true });
      const paths = stdout.trim().split('\n').filter(Boolean);

      for (const path of paths) {
        const trimmedPath = path.trim();
        if (trimmedPath !== currentInstallation.path) {
          installations.push({
            type: 'unknown',
            path: trimmedPath,
          });
        }
      }
    } catch {
      // where命令失败，可能只有一个安装
    }

    const hasMultiple = installations.length > 1;

    return {
      installations,
      hasMultiple,
      recommendation: hasMultiple
        ? '检测到多个安装实例，建议清理多余的安装以避免冲突'
        : undefined,
    };
  }

  /**
   * 获取安装建议
   */
  getInstallationRecommendation(type: InstallationType): string {
    switch (type) {
      case 'npm-global':
        return '使用npm全局安装，可以通过 npm update -g py-app 更新';
      case 'npm-local':
        return '使用npm本地安装，建议在项目目录中运行';
      case 'native':
        return '使用原生安装包，建议使用包管理器管理';
      case 'package-manager':
        return '使用包管理器安装，可以通过包管理器更新';
      case 'development':
        return '开发模式运行，建议在生产环境中使用正式安装';
      case 'unknown':
        return '无法确定安装类型，建议重新安装';
      default:
        return '无建议';
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.currentInstallation = null;
  }
}

/**
 * 导出单例
 */
export const installationTypeDetector = InstallationTypeDetector.getInstance();
