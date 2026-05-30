//
/**
 * 交互式命令执行器
 * 整合命令提示器和增强的命令历史管理器
 */

import readline from 'readline';
import { getCommandManager } from '@modules/commands/manager/CommandManager.js';
import { getEnhancedCommandHistory } from '@modules/commands/history/EnhancedCommandHistory.js';

/**
 * 交互式命令执行器选项
 */
export interface InteractiveCommandExecutorOptions {
  prompt?: string;
  enableSuggestions?: boolean;
  enableHistoryNavigation?: boolean;
  maxSuggestions?: number;
}

/**
 * 交互式命令执行器
 */
export class InteractiveCommandExecutor {
  private rl: readline.Interface;
  private promptPrefix: string;
  private commandManager = getCommandManager();
  private historyManager = getEnhancedCommandHistory();
  private options: InteractiveCommandExecutorOptions;

  /**
   * 构造函数
   * @param options 选项
   */
  constructor(options: InteractiveCommandExecutorOptions = {}) {
    this.options = {
      prompt: options.prompt || 'Liri> ',
      enableSuggestions: options.enableSuggestions !== false,
      enableHistoryNavigation: options.enableHistoryNavigation !== false,
      maxSuggestions: options.maxSuggestions || 10,
    };

    this.promptPrefix = this.options.prompt || 'Liri> ';

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.promptPrefix,
      completer: this.options.enableSuggestions
        ? this.completer.bind(this)
        : undefined,
    });

    this.setupEventHandlers();
  }

  /**
   * 设置事件处理程序
   */
  private setupEventHandlers(): void {
    // 处理行输入
    this.rl.on('line', async (line) => {
      line = line.trim();

      if (line) {
        await this.handleCommand(line);
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
    const commands = (this.commandManager as any).getCommands();
    const commandNames: string[] = Array.from(commands.keys() as string[]);

    // 获取建议
    const suggestions = this.historyManager.getSuggestions(
      line,
      this.options.maxSuggestions || 10
    );

    // 合并命令名称和历史建议
    const allSuggestions = [...new Set([...commandNames, ...suggestions])];

    // 按前缀过滤
    const matches = allSuggestions.filter((command: string) =>
      command.toLowerCase().startsWith(line.toLowerCase())
    );

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
      this.historyManager.addHistory(commandName, args, result.success);

      // 显示结果
      if (result.value) {
        console.log(result.value);
      } else if (result.data) {
        const data = result.data as { type?: string; value?: string };
        if (data.type === 'text') {
          console.log(data.value);
        } else {
          console.log(JSON.stringify(result.data, null, 2));
        }
      }
    } catch (error) {
      console.error('命令执行错误:', error);

      // 记录失败的命令
      const parts = line.split(' ');
      const commandName = parts[0];
      const args = parts.slice(1).join(' ');
      this.historyManager.addHistory(commandName, args, false);
    }
  }

  /**
   * 显示欢迎信息
   */
  private showWelcome(): void {
    console.log('');
    console.log('========================================');
    console.log('  Liri 交互式命令行工具');
    console.log('========================================');
    console.log('');
    console.log('可用命令:');
    const commands = (this.commandManager as any).getCommands();
    const commandNames: string[] = Array.from(
      commands.keys() as string[]
    ).slice(0, 10);
    commandNames.forEach((name: any) => {
      const cmd = commands.get(name);
      console.log(`  ${String(name).padEnd(20)} ${cmd?.description || ''}`);
    });
    console.log('');
    console.log('提示:');
    console.log('  - 输入命令名称执行命令');
    console.log('  - 使用 Tab 键自动补全');
    console.log('  - 按 Ctrl+C 退出');
    console.log('');
  }

  /**
   * 显示统计信息
   */
  private showStatistics(): void {
    const stats = this.historyManager.getStatistics();
    console.log('');
    console.log('命令统计:');
    console.log(`  总命令数: ${stats.totalCommands}`);
    console.log(`  成功命令: ${stats.successfulCommands}`);
    console.log(`  失败命令: ${stats.failedCommands}`);
    console.log(`  最常用命令: ${stats.mostUsedCommand}`);
    console.log(`  平均每天命令数: ${stats.averageCommandsPerDay.toFixed(2)}`);
    console.log('');
  }

  /**
   * 显示常用命令
   */
  private showFrequentCommands(): void {
    const frequent = this.historyManager.getFrequentCommands(10);
    console.log('');
    console.log('常用命令:');
    frequent.forEach(({ command, count }) => {
      console.log(`  ${command.padEnd(20)} ${count} 次`);
    });
    console.log('');
  }

  /**
   * 启动交互式命令执行器
   */
  start(): void {
    this.showWelcome();
    this.showStatistics();
    this.showFrequentCommands();
    this.rl.prompt();
  }

  /**
   * 关闭交互式命令执行器
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
 * 创建交互式命令执行器
 * @param options 选项
 * @returns 交互式命令执行器实例
 */
export function createInteractiveCommandExecutor(
  options: InteractiveCommandExecutorOptions = {}
): InteractiveCommandExecutor {
  return new InteractiveCommandExecutor(options);
}
