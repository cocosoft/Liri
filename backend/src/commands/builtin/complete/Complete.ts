import type { CommandContext } from '../../types/index.js';
import { commandCompletionManager } from '../../completion/CommandCompletionManager.js';

/**
 * Complete命令
 * 提供命令自动补全功能
 */
const completeCommand = {
  async execute(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const command = params[0];
    const input = params.slice(1).join(' ');

    switch (command) {
      case 'list':
        return await this.listCompletions(input);
      case 'recent':
        return await this.listRecentCommands();
      case 'frequent':
        return await this.listFrequentCommands();
      default:
        return {
          success: true,
          message:
            '用法: /complete <命令> [输入]\n\n命令列表:\n  list - 列出补全项\n  recent - 列出最近使用的命令\n  frequent - 列出常用命令\n\n示例: /complete list /vim',
        };
    }
  },

  async listCompletions(input: string) {
    const completions = commandCompletionManager.getCompletions(input);

    if (completions.length === 0) {
      return {
        success: true,
        message: `没有找到补全项 for "${input}"`,
      };
    }

    const completionList = completions
      .map(
        (item) =>
          `  ${item.value.padEnd(30)} - ${item.description || item.label}`
      )
      .join('\n');

    return {
      success: true,
      message: `补全项 for "${input}":\n\n${completionList}`,
    };
  },

  async listRecentCommands() {
    const completions = commandCompletionManager.getRecentCommands();

    if (completions.length === 0) {
      return {
        success: true,
        message: '没有最近使用的命令',
      };
    }

    const recentList = completions
      .map(
        (item, index) => `  ${(index + 1).toString().padEnd(3)} ${item.value}`
      )
      .join('\n');

    return {
      success: true,
      message: `最近使用的命令:\n\n${recentList}`,
    };
  },

  async listFrequentCommands() {
    const completions = commandCompletionManager.getFrequentlyUsedCommands();

    if (completions.length === 0) {
      return {
        success: true,
        message: '没有常用命令',
      };
    }

    const frequentList = completions
      .map((item) => `  ${item.value.padEnd(20)} - ${item.description}`)
      .join('\n');

    return {
      success: true,
      message: `常用命令:\n\n${frequentList}`,
    };
  },
};

export default completeCommand;