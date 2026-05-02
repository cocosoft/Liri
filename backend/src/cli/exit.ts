/**
 * 退出处理模块
 * 处理CLI退出流程
 */

import chalk from 'chalk';

export interface ExitHandlerOptions {
  confirmBeforeExit?: boolean;
  verbose?: boolean;
}

export class ExitHandler {
  private options: ExitHandlerOptions;
  private exitHandlers: (() => Promise<void>)[] = [];

  constructor(options?: ExitHandlerOptions) {
    this.options = {
      confirmBeforeExit: true,
      verbose: false,
      ...options,
    };
  }

  /**
   * 注册退出处理器
   */
  registerExitHandler(handler: () => Promise<void>): void {
    this.exitHandlers.push(handler);
  }

  /**
   * 处理退出命令
   */
  async handleExit(args: string[]): Promise<void> {
    const force = args.includes('--force') || args.includes('-f');

    if (!force && this.options.confirmBeforeExit) {
      const confirmed = await this.confirmExit();
      if (!confirmed) {
        console.log(chalk.yellow('✓'), 'Exit cancelled');
        return;
      }
    }

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Preparing to exit...');
    }

    try {
      await this.executeExitHandlers();
      
      console.log(chalk.green('✓'), 'Goodbye!');
      
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('✗'), `Error during exit: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理强制退出
   */
  async handleForceExit(): Promise<void> {
    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Force exiting...');
    }

    try {
      await this.executeExitHandlers();
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('✗'), `Error during exit: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 显示退出确认提示
   */
  private async confirmExit(): Promise<boolean> {
    return new Promise((resolve) => {
      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      readline.question(chalk.yellow('Are you sure you want to exit? (y/n): '), (answer: string) => {
        readline.close();
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
      });
    });
  }

  /**
   * 执行所有注册的退出处理器
   */
  private async executeExitHandlers(): Promise<void> {
    for (const handler of this.exitHandlers) {
      try {
        await handler();
      } catch (error) {
        console.warn(chalk.yellow('⚠'), `Exit handler failed: ${error}`);
      }
    }
  }
}

/**
 * 创建退出处理器
 */
export function createExitHandler(options?: ExitHandlerOptions): ExitHandler {
  return new ExitHandler(options);
}