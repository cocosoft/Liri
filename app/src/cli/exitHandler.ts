/**
 * 退出处理器
 * 处理CLI应用的退出逻辑
 */

import chalk from 'chalk';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('exitHandler');

export interface ExitHandlerOptions {
  verbose?: boolean;
  confirmExit?: boolean;
}

export class ExitHandler {
  private options: ExitHandlerOptions;
  private exitHandlers: Array<() => Promise<void>> = [];

  constructor(options?: ExitHandlerOptions) {
    this.options = {
      verbose: false,
      confirmExit: true,
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
   * 取消注册退出处理器
   */
  unregisterExitHandler(handler: () => Promise<void>): void {
    const index = this.exitHandlers.indexOf(handler);
    if (index >= 0) {
      this.exitHandlers.splice(index, 1);
    }
  }

  /**
   * 执行退出流程
   */
  async exit(code: number = 0, reason?: string): Promise<void> {
    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), 'Preparing to exit...');
    }

    // 执行所有注册的退出处理器
    for (const handler of this.exitHandlers) {
      try {
        await handler();
      } catch (error) {
        console.error(chalk.yellow('⚠'), `Error during exit handler: ${error}`);
      }
    }

    if (reason) {
      if (code === 0) {
        console.log(chalk.green('✓'), reason);
      } else {
        console.error(chalk.red('✗'), reason);
      }
    }

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), `Exiting with code ${code}`);
    }

    process.exit(code);
  }

  /**
   * 安全退出
   */
  async safeExit(reason?: string): Promise<void> {
    await this.exit(0, reason);
  }

  /**
   * 错误退出
   */
  async errorExit(error: Error): Promise<void> {
    console.error(chalk.red('✗'), error.message);
    await this.exit(1, error.message);
  }

  /**
   * 设置退出确认
   */
  setConfirmExit(confirm: boolean): void {
    this.options.confirmExit = confirm;
  }

  /**
   * 获取退出处理器数量
   */
  getHandlerCount(): number {
    return this.exitHandlers.length;
  }
}

/**
 * 创建退出处理器
 */
export function createExitHandler(options?: ExitHandlerOptions): ExitHandler {
  return new ExitHandler(options);
}

/**
 * 全局退出处理器实例
 */
export const exitHandler = createExitHandler();
