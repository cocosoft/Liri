/**
 * 自动更新 CLI 命令（update check / update install）
 *
 * B5#3（2026-09-09）：废弃原 mock 实现（假 1.0.0→1.1.0，CS04 违规），
 * 委托真实更新链（cli/autoUpdater → fetcher/downloader/installer）。
 */

import chalk from 'chalk';
import { getLogger } from '@modules/monitoring';
import { autoUpdater } from './autoUpdater';

const logger = getLogger('update');

export interface UpdateHandlerOptions {
  autoCheck?: boolean;
  verbose?: boolean;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes?: string;
  downloadUrl?: string;
  changelog?: string[];
}

export class UpdateHandler {
  private options: UpdateHandlerOptions;

  constructor(options?: UpdateHandlerOptions) {
    this.options = {
      autoCheck: true,
      verbose: false,
      ...options,
    };
  }

  /**
   * 处理检查更新命令（显式 force，绕过缓存/开关门禁）
   */
  async handleCheck(): Promise<void> {
    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Checking for updates...');
    }

    try {
      const info = await autoUpdater.checkForUpdates(true);

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  Update Check'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();
      console.log(chalk.green('Current version:'), info.currentVersion);
      console.log(chalk.green('Latest version:'), info.latestVersion);

      if (info.updateAvailable) {
        console.log(chalk.yellow('⚠'), 'Update available!');
        if (info.changelog && info.changelog.length > 0) {
          console.log(chalk.gray('Changelog:'));
          info.changelog.forEach((item) =>
            console.log(chalk.gray(`  - ${item}`))
          );
        }
        if (info.downloadUrl) {
          console.log(chalk.gray(`Download: ${info.downloadUrl}`));
        }
        console.log();
        console.log(
          chalk.gray('Run "update install" to install the latest version')
        );
      } else {
        console.log(chalk.green('✓'), 'You are running the latest version');
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to check for updates: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理安装更新命令
   */
  async handleInstall(args: string[]): Promise<void> {
    const force = args.includes('--force') || args.includes('-f');

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Preparing to install update...');
    }

    try {
      // 显式检查（绕过缓存；install 属显式操作，不受 enabled 门禁影响）
      const info = await autoUpdater.checkForUpdates(true);

      if (!info.updateAvailable && !force) {
        console.log(chalk.green('✓'), 'No updates available');
        return;
      }

      if (!info.downloadUrl) {
        console.error(chalk.red('✗'), '未获取到下载地址，无法安装');
        process.exit(1);
      }

      console.log(
        chalk.yellow('⚠'),
        `Updating from ${info.currentVersion} to ${info.latestVersion}`
      );
      console.log(chalk.gray('This may take a few moments...'));

      const filePath = await autoUpdater.downloadUpdate(info);
      if (!filePath) {
        console.error(chalk.red('✗'), '下载更新包失败');
        process.exit(1);
      }

      const installed = await autoUpdater.installUpdate(filePath);
      if (!installed) {
        console.error(chalk.red('✗'), '安装更新失败，请查看日志');
        process.exit(1);
      }

      console.log(chalk.green('✓'), 'Update installed successfully');
      console.log(
        chalk.gray('Please restart the application to apply the update')
      );
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to install update: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理自动检查（内部使用；尊重 enabled/checkOnStartup 配置）
   */
  async handleAutoCheck(): Promise<UpdateInfo | null> {
    if (!this.options.autoCheck) {
      return null;
    }

    try {
      await autoUpdater.maybeCheckOnStartup();
    } catch {
      // 静默失败
    }
    return null;
  }
}

/**
 * 创建更新处理器
 */
export function createUpdateHandler(
  options?: UpdateHandlerOptions
): UpdateHandler {
  return new UpdateHandler(options);
}
