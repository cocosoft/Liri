/**
 * 命令自动补全管理器
 * 负责提供命令自动补全功能
 */

import { commandRegistry } from '@modules/commands/registry/CommandRegistry.js';
import { commandHistoryManager } from '@modules/commands/history/CommandHistoryManager.js';

/**
 * 补全项类型
 */
export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

/**
 * 命令自动补全管理器
 */
export class CommandCompletionManager {
  /**
   * 获取命令补全
   * @param input 用户输入
   * @returns 补全项列表
   */
  getCompletions(input: string): CompletionItem[] {
    const completions: CompletionItem[] = [];

    // 解析输入
    const parts = input.trim().split(' ');
    const firstPart = parts[0];

    // 如果输入以/开头，认为是命令
    if (firstPart.startsWith('/')) {
      const commandPrefix = firstPart.substring(1);

      // 补全命令
      if (parts.length === 1) {
        completions.push(...this.getCommandCompletions(commandPrefix));
      } else {
        // 补全命令参数
        const commandName = commandPrefix;
        const args = parts.slice(1).join(' ');
        completions.push(...this.getArgumentCompletions(commandName, args));
      }
    } else {
      // 补全历史命令
      completions.push(...this.getHistoryCompletions(input));
    }

    return completions;
  }

  /**
   * 获取命令补全
   * @param prefix 命令前缀
   * @returns 命令补全项列表
   */
  private getCommandCompletions(prefix: string): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const commands = commandRegistry.getVisible();

    for (const command of commands) {
      if (command.name.toLowerCase().startsWith(prefix.toLowerCase())) {
        completions.push({
          value: `/${command.name}`,
          label: command.name,
          description: command.description,
        });
      }

      // 补全别名
      if (command.aliases) {
        for (const alias of command.aliases) {
          if (alias.toLowerCase().startsWith(prefix.toLowerCase())) {
            completions.push({
              value: `/${alias}`,
              label: alias,
              description: `别名 for /${command.name}`,
            });
          }
        }
      }
    }

    return completions;
  }

  /**
   * 获取参数补全
   * @param commandName 命令名称
   * @param args 参数
   * @returns 参数补全项列表
   */
  private getArgumentCompletions(
    commandName: string,
    args: string
  ): CompletionItem[] {
    const completions: CompletionItem[] = [];

    // 根据命令类型提供不同的参数补全
    switch (commandName) {
      case 'vim':
      case 'edit':
      case 'vi':
        completions.push(...this.getFileCompletions(args));
        break;
      case 'advisor':
        completions.push(
          { value: 'code', label: 'code', description: '分析代码质量' },
          {
            value: 'performance',
            label: 'performance',
            description: '分析性能',
          },
          { value: 'security', label: 'security', description: '分析安全性' }
        );
        break;
      case 'brief':
        completions.push(...this.getFileCompletions(args));
        break;
    }

    return completions;
  }

  /**
   * 获取文件补全
   * @param path 文件路径
   * @returns 文件补全项列表
   */
  private getFileCompletions(path: string): CompletionItem[] {
    const completions: CompletionItem[] = [];

    try {
      const fs = require('fs');
      const pathModule = require('path');

      const currentPath = path || '.';
      const dir = pathModule.dirname(currentPath);
      const base = pathModule.basename(currentPath);
      const fullDir = pathModule.resolve(dir);

      if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
        const files = fs.readdirSync(fullDir);

        for (const file of files) {
          if (file.toLowerCase().startsWith(base.toLowerCase())) {
            const fullPath = pathModule.join(fullDir, file);
            const isDirectory = fs.statSync(fullPath).isDirectory();

            completions.push({
              value: pathModule.join(dir, file) + (isDirectory ? '/' : ''),
              label: file,
              description: isDirectory ? '目录' : '文件',
            });
          }
        }
      }
    } catch (error) {
      // 忽略错误
    }

    return completions;
  }

  /**
   * 获取历史命令补全
   * @param input 用户输入
   * @returns 历史命令补全项列表
   */
  private getHistoryCompletions(input: string): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const history = commandHistoryManager.getHistory(50);

    for (const item of history) {
      const fullCommand = `/${item.command} ${item.args}`.trim();
      if (fullCommand.toLowerCase().includes(input.toLowerCase())) {
        completions.push({
          value: fullCommand,
          label: fullCommand,
          description: `历史命令`,
        });
      }
    }

    return completions;
  }

  /**
   * 获取最近使用的命令
   * @returns 最近使用的命令列表
   */
  getRecentCommands(): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const history = commandHistoryManager.getHistory(10);

    for (const item of history.reverse()) {
      const fullCommand = `/${item.command} ${item.args}`.trim();
      completions.push({
        value: fullCommand,
        label: fullCommand,
        description: `最近使用`,
      });
    }

    return completions;
  }

  /**
   * 获取常用命令
   * @returns 常用命令列表
   */
  getFrequentlyUsedCommands(): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const frequency = commandHistoryManager.getCommandFrequency();

    // 按使用频率排序
    const sortedCommands = Object.entries(frequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [command, count] of sortedCommands) {
      const cmd = commandRegistry.getCommand(command);
      if (cmd) {
        completions.push({
          value: `/${command}`,
          label: command,
          description: `${cmd.description} (使用 ${count} 次)`,
        });
      }
    }

    return completions;
  }
}

/**
 * 全局命令自动补全管理器实例
 */
export const commandCompletionManager = new CommandCompletionManager();
