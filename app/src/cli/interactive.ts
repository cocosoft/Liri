/**
 * 交互式命令行模块
 * 提供交互式命令行界面
 */

import readline from 'readline';
import { commandHistory } from './history';
import { commandCompleter } from './completion';
import chalk from 'chalk';

export interface InteractiveOptions {
  prompt?: string;
  historySize?: number;
}

export class InteractiveShell {
  private rl: readline.Interface;
  private options: InteractiveOptions;
  private prompt: string;
  private commandHandler: ((command: string) => Promise<void> | void) | null =
    null;

  constructor(options?: InteractiveOptions) {
    this.options = {
      prompt: 'pyapp> ',
      historySize: 100,
      ...options,
    };
    this.prompt = this.options.prompt!;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.prompt,
      historySize: this.options.historySize,
      completer: this.handleComplete.bind(this),
    });

    this.setupEvents();
  }

  /**
   * 设置事件处理
   */
  private setupEvents(): void {
    this.rl.on('line', this.handleLine.bind(this));
    this.rl.on('close', this.handleClose.bind(this));
    this.rl.on('SIGINT', this.handleSigint.bind(this));
    this.rl.on('SIGTSTP', this.handleSigtstp.bind(this));
  }

  /**
   * 处理命令行输入
   */
  private async handleLine(line: string): Promise<void> {
    const command = line.trim();

    if (!command) {
      this.rl.prompt();
      return;
    }

    // 添加到历史记录
    commandHistory.add(command);

    // 处理退出命令
    if (['exit', 'quit', 'q'].includes(command.toLowerCase())) {
      this.close();
      return;
    }

    // 处理帮助命令
    if (command.toLowerCase() === 'help') {
      this.showHelp();
      this.rl.prompt();
      return;
    }

    // 处理命令
    try {
      if (this.commandHandler) {
        await this.commandHandler(command);
      } else {
        console.log(chalk.yellow(`Unknown command: ${command}`));
        console.log('Type "help" for available commands');
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${(error as Error).message}`));
    }

    this.rl.prompt();
  }

  /**
   * 处理自动补全
   */
  private handleComplete(line: string): [string[], string] {
    const suggestions = commandCompleter.complete(line);
    const matches = suggestions.map((s) => s.value);
    return [matches, line];
  }

  /**
   * 处理关闭
   */
  private handleClose(): void {
    console.log(chalk.cyan('\nGoodbye!'));
    process.exit(0);
  }

  /**
   * 处理SIGINT
   */
  private handleSigint(): void {
    console.log(chalk.cyan('\nType "exit" or "quit" to exit'));
    this.rl.prompt();
  }

  /**
   * 处理SIGTSTP
   */
  private handleSigtstp(): void {
    // 忽略Ctrl+Z
  }

  /**
   * 设置命令处理器
   */
  setCommandHandler(handler: (command: string) => Promise<void> | void): void {
    this.commandHandler = handler;
  }

  /**
   * 显示帮助信息
   */
  private showHelp(): void {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  PY_APP Interactive Shell'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    console.log('  Available commands:');
    console.log();

    const commands = commandCompleter.getAllCommands();
    commands.forEach((cmd) => {
      console.log(
        chalk.green(`    ${cmd.value}`) + chalk.gray(` - ${cmd.description}`)
      );
    });

    console.log();
    console.log('  Shortcuts:');
    console.log('    Ctrl+C - Show exit hint');
    console.log('    Tab    - Autocomplete');
    console.log('    ↑/↓    - Navigate history');
    console.log(chalk.cyan('═'.repeat(60)));
  }

  /**
   * 启动交互式shell
   */
  start(): void {
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.bold('  PY_APP Interactive Shell'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log(chalk.gray('  Type "help" for available commands'));
    console.log(chalk.cyan('═'.repeat(60)));
    console.log();
    this.rl.prompt();
  }

  /**
   * 关闭交互式shell
   */
  close(): void {
    this.rl.close();
  }

  /**
   * 设置提示文本
   */
  setPrompt(prompt: string): void {
    this.prompt = prompt;
    this.rl.setPrompt(prompt);
  }

  /**
   * 显示消息
   */
  displayMessage(message: string): void {
    console.log(message);
    this.rl.prompt();
  }

  /**
   * 显示成功消息
   */
  displaySuccess(message: string): void {
    console.log(chalk.green(message));
    this.rl.prompt();
  }

  /**
   * 显示错误消息
   */
  displayError(message: string): void {
    console.log(chalk.red(message));
    this.rl.prompt();
  }
}

/**
 * 创建交互式shell实例
 */
export function createInteractiveShell(
  options?: InteractiveOptions
): InteractiveShell {
  return new InteractiveShell(options);
}

/**
 * 全局交互式shell实例
 */
export const interactiveShell = createInteractiveShell();
