/**
 * 自动模式处理器
 * 处理CLI中的自动模式相关命令
 */

import chalk from 'chalk';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

const logger = new Logger({ level: LogLevel.INFO });

export interface AutoModeHandlerOptions {
  verbose?: boolean;
  autoSave?: boolean;
}

export class AutoModeHandler {
  private options: AutoModeHandlerOptions;
  private isAutoModeEnabled = false;

  constructor(options?: AutoModeHandlerOptions) {
    this.options = { verbose: false, autoSave: true, ...options };
  }

  /**
   * 处理自动模式启动命令（handleEnable 的别名）
   */
  async handleStart(args: string[]): Promise<void> {
    await this.handleEnable(args);
  }

  /**
   * 处理自动模式停止命令（handleDisable 的别名）
   */
  async handleStop(): Promise<void> {
    await this.handleDisable();
  }

  /**
   * 处理自动模式启用命令
   */
  async handleEnable(args: string[]): Promise<void> {
    if (this.options.verbose) {
      logger.info('Enabling auto mode...');
    }

    try {
      this.isAutoModeEnabled = true;

      const config = this.parseArgs(args);

      console.log(chalk.green('✓'), 'Auto mode enabled');

      if (this.options.verbose) {
        console.log(chalk.gray('  Configuration:'));
        console.log(chalk.gray(`    Auto-save: ${config.autoSave}`));
        console.log(chalk.gray(`    Interval: ${config.interval}ms`));
      }
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'AutoModeHandler', operation: 'handleEnable' },
      });
    }
  }

  /**
   * 处理自动模式禁用命令
   */
  async handleDisable(): Promise<void> {
    if (this.options.verbose) {
      logger.info('Disabling auto mode...');
    }

    try {
      this.isAutoModeEnabled = false;
      console.log(chalk.green('✓'), 'Auto mode disabled');
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'AutoModeHandler', operation: 'handleDisable' },
      });
    }
  }

  /**
   * 处理状态检查命令
   */
  async handleStatus(): Promise<void> {
    if (this.isAutoModeEnabled) {
      console.log(chalk.green('✓'), 'Auto mode: Enabled');
    } else {
      console.log(chalk.yellow('⚠'), 'Auto mode: Disabled');
      console.log(chalk.gray('  Use "auto enable" to enable'));
    }
  }

  /**
   * 处理配置命令
   */
  async handleConfig(args: string[]): Promise<void> {
    if (args.length === 0) {
      this.showCurrentConfig();
      return;
    }

    try {
      const [key, value] = args;
      await this.updateConfig(key, value);
      console.log(chalk.green('✓'), `Config updated: ${key} = ${value}`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'AutoModeHandler', operation: 'handleConfig' },
      });
    }
  }

  /**
   * 显示当前配置
   */
  private showCurrentConfig(): void {
    console.log(chalk.cyan('═'.repeat(40)));
    console.log(chalk.bold('  Auto Mode Configuration'));
    console.log(chalk.cyan('═'.repeat(40)));
    console.log();
    console.log(chalk.green('Enabled:'), this.isAutoModeEnabled ? 'Yes' : 'No');
    console.log(
      chalk.green('Auto-save:'),
      this.options.autoSave ? 'Yes' : 'No'
    );
    console.log(chalk.cyan('═'.repeat(40)));
  }

  /**
   * 更新配置
   */
  private async updateConfig(key: string, value: string): Promise<void> {
    switch (key.toLowerCase()) {
      case 'autosave':
        this.options.autoSave = value.toLowerCase() === 'true';
        break;
      case 'verbose':
        this.options.verbose = value.toLowerCase() === 'true';
        break;
      default:
        throw new AppError(
          `Unknown config key: ${key}`,
          ErrorCategory.CONFIGURATION,
          ErrorSeverity.HIGH,
          '400'
        );
    }
  }

  /**
   * 解析参数
   */
  private parseArgs(args: string[]): { autoSave: boolean; interval: number } {
    let autoSave = this.options.autoSave ?? true;
    let interval = 1000;

    for (const arg of args) {
      if (arg.startsWith('--')) {
        const [key, val] = arg.slice(2).split('=');
        switch (key.toLowerCase()) {
          case 'autosave':
            autoSave = val?.toLowerCase() === 'true';
            break;
          case 'interval':
            interval = parseInt(val || '1000', 10);
            break;
        }
      }
    }

    return { autoSave, interval };
  }
}

/**
 * 创建自动模式处理器
 */
export function createAutoModeHandler(
  options?: AutoModeHandlerOptions
): AutoModeHandler {
  return new AutoModeHandler(options);
}
