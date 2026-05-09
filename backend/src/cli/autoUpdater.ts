//
/**
 * 自动更新模块
 * 检查和提示CLI应用更新
 */

import chalk from 'chalk';

export interface AutoUpdaterOptions {
  verbose?: boolean;
  checkInterval?: number;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string[];
}

export class AutoUpdater {
  private options: AutoUpdaterOptions;
  private lastCheckTime: number = 0;
  private updateInfo: UpdateInfo | null = null;

  constructor(options?: AutoUpdaterOptions) {
    this.options = {
      verbose: false,
      checkInterval: 24 * 60 * 60 * 1000, // 24小时
      ...options,
    };
  }

  /**
   * 检查更新
   */
  async checkForUpdates(force: boolean = false): Promise<UpdateInfo> {
    const now = Date.now();
    
    // 如果上次检查时间间隔不够且不是强制检查，则返回缓存结果
    if (!force && now - this.lastCheckTime < (this.options?.checkInterval ?? 3600000)) {
      if (this.updateInfo && this.options.verbose) {
        console.log(chalk.blue('ℹ'), 'Using cached update info');
      }
      return (this.updateInfo || this.createDefaultInfo())!;
    }

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Checking for updates...');
    }

    this.lastCheckTime = now;

    try {
      // 模拟检查更新
      const info = await this.fetchUpdateInfo();
      this.updateInfo = info;

      if (info.updateAvailable) {
        this.displayUpdateNotification(info);
      }

      return info;
    } catch (error) {
      if (this.options.verbose) {
        console.warn(chalk.yellow('⚠'), `Update check failed: ${error}`);
      }
      return this.createDefaultInfo();
    }
  }

  /**
   * 获取当前更新信息
   */
  getUpdateInfo(): UpdateInfo | null {
    return this.updateInfo;
  }

  /**
   * 显示更新通知
   */
  displayUpdateNotification(info: UpdateInfo): void {
    console.log();
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  Update Available'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log(chalk.green('Current Version:'), chalk.bold(info.currentVersion));
    console.log(chalk.green('Latest Version:'), chalk.bold(info.latestVersion));
    console.log();
    console.log(chalk.yellow('To update, run:'));
    console.log(chalk.gray('  npm update -g py-app'));
    console.log();
    
    if (info.changelog && info.changelog.length > 0) {
      console.log(chalk.green('Changelog:'));
      info.changelog.forEach((item, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${item}`));
      });
    }
    
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
  }

  /**
   * 检查并提示更新
   */
  async checkAndNotify(): Promise<void> {
    const info = await this.checkForUpdates();
    if (info.updateAvailable) {
      this.displayUpdateNotification(info);
    }
  }

  /**
   * 获取更新状态
   */
  hasUpdate(): boolean {
    return this.updateInfo?.updateAvailable ?? false;
  }

  /**
   * 获取待更新版本号
   */
  getLatestVersion(): string {
    return this.updateInfo?.latestVersion || 'unknown';
  }

  /**
   * 获取当前版本号
   */
  getCurrentVersion(): string {
    return this.updateInfo?.currentVersion || 'unknown';
  }

  /**
   * 模拟获取更新信息
   */
  private async fetchUpdateInfo(): Promise<UpdateInfo> {
    await new Promise(resolve => setTimeout(resolve, 500));
    
    return {
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
      changelog: [
        'Added new CLI commands',
        'Improved performance',
        'Fixed bugs',
        'Enhanced security',
      ],
    };
  }

  /**
   * 创建默认更新信息
   */
  private createDefaultInfo(): UpdateInfo {
    return {
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      updateAvailable: false,
    };
  }
}

/**
 * 创建自动更新器
 */
export function createAutoUpdater(options?: AutoUpdaterOptions): AutoUpdater {
  return new AutoUpdater(options);
}

/**
 * 全局自动更新器实例
 */
export const autoUpdater = createAutoUpdater();
