//
/**
 * 命令提示器
 * 负责提供交互式命令提示和自动补全
 */

import readline from 'readline';
import { getCommandManager } from '@modules/commands';
import { commandHistoryManager } from '@modules/commands';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('CommandPrompt');

/**
 * 命令提示器选项
 */
export interface CommandPromptOptions {
  prompt?: string;
  historySize?: number;
  autoComplete?: boolean;
}

/**
 * 命令提示器
 */
export class CommandPrompt {
  private rl: readline.Interface;
  private promptText: string;
  private commandManager = getCommandManager();
  private history: string[] = [];
  private historyIndex = -1;

  /**
   * 构造函数
   * @param options 选项
   */
  constructor(options: CommandPromptOptions = {}) {
    this.promptText = options.prompt || 'Liri> ';

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.promptText,
      historySize: options.historySize || 1000,
      completer:
        options.autoComplete !== false ? this.completer.bind(this) : undefined,
    });

    this.setupEventHandlers();
  }

  /**
   * 设置事件处理程序
   */
  private setupEventHandlers(): void {
    // 处理行输入
    this.rl.on('line', (line) => {
      line = line.trim();
      if (line) {
        this.history.push(line);
        this.historyIndex = -1;
        this.handleCommand(line);
      }
      this.rl.prompt();
    });

    // 处理Ctrl+C
    this.rl.on('SIGINT', () => {
      this.rl.question('确定要退出吗？(y/N) ', (answer) => {
        if (answer.toLowerCase() === 'y') {
          this.rl.close();
          process.exit(0);
        } else {
          this.rl.prompt();
        }
      });
    });

    // 处理退出
    this.rl.on('close', () => {
      console.log('再见！');
      process.exit(0);
    });
  }

  /**
   * 命令自动补全
   * @param line 当前输入行
   * @param callback 回调函数
   */
  private completer(
    line: string,
    callback: (err: any, result: [string[], string]) => void
  ): void {
    const commands = this.commandManager.getAllCommands();
    const commandNames = commands.map((c) => c.name);

    // 按前缀过滤命令
    const matches = commandNames.filter((command) => command.startsWith(line));

    callback(null, [matches, line]);
  }

  /**
   * 处理命令
   * @param line 命令行
   */
  private async handleCommand(line: string): Promise<void> {
    try {
      // 解析命令
      const parts = line.split(' ');
      const commandName = parts[0];
      const args = parts.slice(1).join(' ');

      // 执行命令
      const result = await this.commandManager.executeCommand(
        commandName,
        args,
        {}
      );

      // 记录命令历史
      commandHistoryManager.addHistory(commandName, args, result.success);

      // 显示结果
      if (result.data) {
        console.log(JSON.stringify(result.data, null, 2));
      }
    } catch (error) {
      logger.error('命令执行错误', error);
      // 记录失败的命令
      const parts = line.split(' ');
      const commandName = parts[0];
      const args = parts.slice(1).join(' ');
      commandHistoryManager.addHistory(commandName, args, false);
    }
  }

  /**
   * 启动命令提示器
   */
  start(): void {
    console.log('Liri 命令行工具');
    console.log('输入命令或按 Ctrl+C 退出');
    console.log('输入 help 查看可用命令');
    console.log('');
    this.rl.prompt();
  }

  /**
   * 关闭命令提示器
   */
  close(): void {
    this.rl.close();
  }

  /**
   * 显示提示
   */
  prompt(): void {
    this.rl.prompt();
  }
}

/**
 * 创建命令提示器
 * @param options 选项
 * @returns 命令提示器实例
 */
export function createCommandPrompt(
  options: CommandPromptOptions = {}
): CommandPrompt {
  return new CommandPrompt(options);
}
