/**
 * 自动模式处理器
 * 处理CLI中的自动模式相关命令
 */

import chalk from 'chalk';

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
   * 处理自动模式启用命令
   */
  async handleEnable(args: string[]): Promise<void> {
    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Enabling auto mode...');
    }

    try {
      this.isAutoModeEnabled = true;
      
      // 解析额外参数
      const config = this.parseArgs(args);
      
      console.log(chalk.green('✓'), 'Auto mode enabled');
      
      if (this.options.verbose) {
        console.log(chalk.gray('  Configuration:'));
        console.log(chalk.gray(`    Auto-save: ${config.autoSave}`));
        console.log(chalk.gray(`    Interval: ${config.interval}ms`));
      }
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to enable auto mode: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理自动模式禁用命令
   */
  async handleDisable(): Promise<void> {
    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Disabling auto mode...');
    }

    try {
      this.isAutoModeEnabled = false;
      console.log(chalk.green('✓'), 'Auto mode disabled');
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to disable auto mode: ${error}`);
      process.exit(1);
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
      console.error(chalk.red('✗'), `Failed to update config: ${error}`);
      process.exit(1);
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
    console.log(chalk.green('Auto-save:'), this.options.autoSave ? 'Yes' : 'No');
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
        throw new Error(`Unknown config key: ${key}`);
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
export function createAutoModeHandler(options?: AutoModeHandlerOptions): AutoModeHandler {
  return new AutoModeHandler(options);
}