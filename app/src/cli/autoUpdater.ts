/**
 * 自动更新模块
 * 检查和提示CLI应用更新
 *
 * B5#3（2026-09-09）：配置驱动闭环——AutoUpdatePanel 写入的 autoUpdate.*
 * 由本模块真实消费（enabled/checkIntervalMs/channel/checkOnStartup/verbose）。
 */

import chalk from 'chalk';
import { getLogger } from '@modules/monitoring';
import { getGlobalConfig } from '@modules/config';
import type { UpdateChannel } from '../constants/product';
import { GitHubReleaseFetcher } from './updater/GitHubReleaseFetcher';
import { UpdateDownloader } from './updater/UpdateDownloader';
import { InstallManager } from './updater/InstallManager';

const logger = getLogger('cli:autoUpdater');

export interface AutoUpdaterOptions {
  verbose?: boolean;
  checkInterval?: number;
  releaseChannel?: UpdateChannel;
}

// UpdateInfo 为 interface（无运行时绑定）：必须 type-only 导入/导出，
// 否则 bun 启动时报 export 'UpdateInfo' not found（2026-09-05 预存 boot 错误修复）。
import type { UpdateInfo } from './updater/GitHubReleaseFetcher';
export type { UpdateInfo };

export class AutoUpdater {
  private options: AutoUpdaterOptions;
  private lastCheckTime: number = 0;
  private updateInfo: UpdateInfo | null = null;
  private fetcher: GitHubReleaseFetcher;
  private downloader: UpdateDownloader;
  private installer: InstallManager;
  private currentVersion: string;
  /** 是否启用自动更新（autoUpdate.enabled） */
  private enabled: boolean = true;
  /** 是否启动时静默检查（autoUpdate.checkOnStartup） */
  private checkOnStartup: boolean = true;
  /** 当前生效通道（用于检测配置变更后重建 fetcher） */
  private lastChannel: UpdateChannel = 'stable';
  private explicitVerbose: boolean = false;
  private explicitInterval: boolean = false;
  private explicitChannel: boolean = false;

  constructor(options?: AutoUpdaterOptions) {
    // 记录调用方显式传参，配置只填充未显式给出的项
    this.explicitVerbose = options?.verbose !== undefined;
    this.explicitInterval = options?.checkInterval !== undefined;
    this.explicitChannel = options?.releaseChannel !== undefined;

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

    // 配置驱动（B5#3 2026-09-09）：面板 autoUpdate.* 与真实更新器同源；
    // 显式传入 options 优先，其次读全局配置，最后默认值。
    this.syncOptionsFromConfig();
    this.lastChannel = this.options.releaseChannel ?? 'stable';

    this.fetcher = new GitHubReleaseFetcher(
      this.currentVersion,
      this.lastChannel
    );

    this.downloader = new UpdateDownloader();
    this.installer = new InstallManager();
  }

  /**
   * 从全局配置同步 autoUpdate.*（enabled/checkIntervalMs/channel/checkOnStartup/verbose）。
   * 显式 options（CLI 调用方）优先于配置；配置读取失败按默认值处理。
   */
  private syncOptionsFromConfig(): void {
    try {
      const autoUpdate = (
        getGlobalConfig() as {
          autoUpdate?: {
            enabled?: boolean;
            checkIntervalMs?: number;
            channel?: UpdateChannel;
            checkOnStartup?: boolean;
            verbose?: boolean;
          };
        }
      )?.autoUpdate;
      if (!autoUpdate) return;
      if (!this.explicitVerbose && typeof autoUpdate.verbose === 'boolean') {
        this.options.verbose = autoUpdate.verbose;
      }
      if (
        !this.explicitInterval &&
        typeof autoUpdate.checkIntervalMs === 'number'
      ) {
        this.options.checkInterval = autoUpdate.checkIntervalMs;
      }
      if (
        !this.explicitChannel &&
        (autoUpdate.channel === 'stable' || autoUpdate.channel === 'beta')
      ) {
        this.options.releaseChannel = autoUpdate.channel;
      }
      if (typeof autoUpdate.enabled === 'boolean') {
        this.enabled = autoUpdate.enabled;
      }
      if (typeof autoUpdate.checkOnStartup === 'boolean') {
        this.checkOnStartup = autoUpdate.checkOnStartup;
      }
    } catch (error) {
      logger.warning('读取 autoUpdate 配置失败，按默认值处理', { error });
    }
  }

  /**
   * 检查更新
   * @param force 是否强制刷新缓存
   */
  async checkForUpdates(force: boolean = false): Promise<UpdateInfo> {
    this.syncOptionsFromConfig();

    // enabled=false 时自动/静默检查直接跳过（显式 force 检查仍可执行）
    if (!this.enabled && !force) {
      return this.createDefaultInfo();
    }

    // channel 变更时重建 fetcher，使面板配置实时生效（B5#3）
    const activeChannel = this.options.releaseChannel ?? 'stable';
    if (this.lastChannel !== activeChannel) {
      this.fetcher = new GitHubReleaseFetcher(
        this.currentVersion,
        activeChannel
      );
      this.lastChannel = activeChannel;
      if (this.options.verbose) {
        logger.info(`更新通道切换为 ${activeChannel}`);
      }
    }

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
   * 启动检查（尊重 enabled 与 checkOnStartup，B5#3 2026-09-09）
   */
  async maybeCheckOnStartup(): Promise<void> {
    this.syncOptionsFromConfig();
    if (!this.enabled || !this.checkOnStartup) {
      if (this.options.verbose) {
        logger.info('自动更新关闭或未开启启动检查，跳过本次启动检查');
      }
      return;
    }
    await this.checkAndNotify();
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
