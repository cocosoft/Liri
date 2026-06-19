/**
 * 命令自动补全管理器
 * 负责提供命令自动补全功能，集成 CommandCatalog 增强补全体验
 */

import { commandRegistry } from '@modules/commands';
import { commandHistoryManager } from '@modules/commands';
import { commandCatalog } from '@modules/commands';

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

    const parts = input.trim().split(' ');
    const firstPart = parts[0];

    if (firstPart.startsWith('/')) {
      const commandPrefix = firstPart.substring(1);

      if (parts.length === 1) {
        completions.push(...this.getCommandCompletions(commandPrefix));
      } else {
        const commandName = commandPrefix;
        const args = parts.slice(1).join(' ');
        completions.push(...this.getArgumentCompletions(commandName, args));

        if (args.endsWith(' ')) {
          completions.push(...this.getCategoryCompletions(args.trim()));
        }
      }
    } else {
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

  /**
   * 获取分类补全
   * @param input 用户输入
   * @returns 分类相关的补全项
   */
  private getCategoryCompletions(input: string): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const categories = commandCatalog.getCategories();

    for (const cat of categories) {
      if (cat.name.toLowerCase().includes(input.toLowerCase())) {
        const commands = cat.commands.slice(0, 5);
        for (const cmdName of commands) {
          const cmd = commandRegistry.getCommand(cmdName);
          if (cmd) {
            completions.push({
              value: cmdName,
              label: cmdName,
              description: `${cat.icon} ${cmd.description}`,
            });
          }
        }
      }
    }

    return completions;
  }

  /**
   * 获取热门命令推荐（基于使用统计）
   * @returns 热门命令推荐列表
   */
  getHotCommands(): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const stats = commandCatalog.getMostUsedCommands(5);

    for (const stat of stats) {
      const cmd = commandRegistry.getCommand(stat.name);
      if (cmd) {
        completions.push({
          value: `/${stat.name}`,
          label: stat.name,
          description: `${cmd.description} (${stat.invokeCount} 次)`,
        });
      }
    }

    return completions;
  }

  /**
   * 获取收藏命令
   * @returns 收藏命令列表
   */
  getFavoriteCommands(): CompletionItem[] {
    const completions: CompletionItem[] = [];
    const favorites = commandCatalog.getFavorites();

    for (const fav of favorites) {
      const cmd = commandRegistry.getCommand(fav.name);
      if (cmd) {
        completions.push({
          value: `/${fav.name}`,
          label: fav.name,
          description: cmd.description,
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
