/**
 * 自动更新模块
 * 检查和提示CLI应用更新
 */

import chalk from 'chalk';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { UpdateChannel } from '../constants/product';
import { GitHubReleaseFetcher } from './updater/GitHubReleaseFetcher';
import { UpdateDownloader } from './updater/UpdateDownloader';
import { InstallManager } from './updater/InstallManager';

const logger = new Logger({ level: LogLevel.INFO });

export interface AutoUpdaterOptions {
  verbose?: boolean;
  checkInterval?: number;
  releaseChannel?: UpdateChannel;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog?: string[];
  downloadUrl?: string;
  releaseDate?: string;
  checksum?: string;
  releaseNotesUrl?: string;
  releaseChannel?: UpdateChannel;
}

export class AutoUpdater {
  private options: AutoUpdaterOptions;
  private lastCheckTime: number = 0;
  private updateInfo: UpdateInfo | null = null;
  private fetcher: GitHubReleaseFetcher;
  private downloader: UpdateDownloader;
  private installer: InstallManager;
  private currentVersion: string;

  constructor(options?: AutoUpdaterOptions) {
    this.options = {
      verbose: false,
      checkInterval: 24 * 60 * 60 * 1000,
      releaseChannel: 'stable',
      ...options,
    };

    this.currentVersion =
      process.env['npm_package_version'] ||
      process.env['Liri_VERSION'] ||
      '1.0.0';

    this.fetcher = new GitHubReleaseFetcher(
      this.currentVersion,
      this.options.releaseChannel
    );

    this.downloader = new UpdateDownloader();
    this.installer = new InstallManager();
  }

  /**
   * 检查更新
   * @param force 是否强制刷新缓存
   */
  async checkForUpdates(force: boolean = false): Promise<UpdateInfo> {
    const now = Date.now();

    if (
      !force &&
      now - this.lastCheckTime < (this.options.checkInterval ?? 3600000)
    ) {
      if (this.updateInfo && this.options.verbose) {
        logger.info('使用缓存的更新信息');
      }
      return (this.updateInfo || this.createDefaultInfo())!;
    }

    if (this.options.verbose) {
      logger.info('正在检查更新...');
    }

    this.lastCheckTime = now;

    try {
      const info = await this.fetcher.fetchLatest();
      this.updateInfo = info;

      if (info.updateAvailable && this.options.verbose) {
        logger.info(
          `发现新版本: ${info.currentVersion} → ${info.latestVersion}`
        );
      }

      return info;
    } catch (error) {
      logger.warning('检查更新失败', { error });
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
    console.log(
      chalk.green('Current Version:'),
      chalk.bold(info.currentVersion)
    );
    console.log(chalk.green('Latest Version:'), chalk.bold(info.latestVersion));
    console.log();

    const updateCmd = this.getUpdateCommand();
    console.log(chalk.yellow('To update, run:'));
    console.log(chalk.gray(`  ${updateCmd}`));
    console.log();

    if (info.changelog && info.changelog.length > 0) {
      console.log(chalk.green('Changelog:'));
      info.changelog.forEach((item, index) => {
        console.log(chalk.gray(`  ${index + 1}. ${item}`));
      });
    }

    if (info.releaseNotesUrl) {
      console.log();
      console.log(chalk.gray(`Full release notes: ${info.releaseNotesUrl}`));
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
   * 下载更新包
   * @param info 更新信息
   */
  async downloadUpdate(info?: UpdateInfo): Promise<string | null> {
    const updateInfo = info || this.updateInfo;
    if (!updateInfo?.downloadUrl) {
      logger.warning('无下载地址');
      return null;
    }

    try {
      const result = await this.downloader.download(
        updateInfo.downloadUrl,
        updateInfo.latestVersion
      );

      logger.info('更新包下载完成', {
        path: result.filePath,
        size: result.fileSize,
      });
      return result.filePath;
    } catch (error) {
      logger.error('下载更新包失败', error as Error);
      return null;
    }
  }

  /**
   * 安装更新包
   * @param filePath 更新包路径
   */
  async installUpdate(filePath: string): Promise<boolean> {
    const info = this.updateInfo;

    if (info?.checksum) {
      const valid = await this.installer.verify(filePath, info.checksum);
      if (!valid) {
        logger.error('更新包校验失败');
        return false;
      }
    }

    const result = await this.installer.install(filePath);
    return result.success;
  }

  /**
   * 获取更新命令提示
   */
  private getUpdateCommand(): string {
    const hasGlobal = process.env['npm_config_global'];
    return hasGlobal ? 'npm update -g Liri' : 'bun run update';
  }

  /**
   * 创建默认更新信息
   */
  private createDefaultInfo(): UpdateInfo {
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
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
