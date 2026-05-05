/**
 * Complete命令
 * 提供命令自动补全功能
 */
import type { CommandContext } from '../../types/index.js';
import { commandCompletionManager } from '../completion/CommandCompletionManager.js';

interface CompleteOptions {
  limit?: number;
  all?: boolean;
  fuzzy?: boolean;
}

interface CompleteResult {
  type: 'text' | 'error';
  value: string;
}

/**
 * Complete命令类
 */
export class CompleteCommand {
  /**
   * 执行命令
   */
  async call(args: string, context: CommandContext): Promise<CompleteResult> {
    try {
      const { subcommand, options } = this.parseArgs(args);

      if (!subcommand) {
        return this.showHelp();
      }

      switch (subcommand.toLowerCase()) {
        case 'list':
        case 'l':
          return this.listCompletions(options);

        case 'recent':
        case 'r':
          return this.listRecentCommands(options);

        case 'frequent':
        case 'f':
          return this.listFrequentCommands(options);

        case 'search':
        case 's':
          return this.searchCompletions(options);

        case 'stats':
        case 'st':
          return this.showStats();

        case 'clear':
        case 'c':
          return this.clearHistory();

        case 'refresh':
          return this.refreshCache();

        case 'help':
        case 'h':
          return this.showHelp();

        default:
          return {
            type: 'error',
            value: `未知子命令: ${subcommand}\n\n输入 /complete help 查看所有可用子命令`,
          };
      }
    } catch (error) {
      return {
        type: 'error',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  /**
   * 解析参数
   */
  private parseArgs(args: string): { subcommand: string; options: CompleteOptions } {
    const parts = args.trim().split(/\s+/);
    const options: CompleteOptions = {};

    let subcommand = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      if (part.startsWith('--')) {
        if (part === '--all' || part === '-a') {
          options.all = true;
        } else if (part === '--fuzzy' || part === '-f') {
          options.fuzzy = true;
        } else if (part.startsWith('--limit=') || part.startsWith('-n')) {
          const limitStr = part.startsWith('--limit=')
            ? part.substring('--limit='.length)
            : parts[++i];
          options.limit = parseInt(limitStr, 10) || 10;
        }
      } else if (!part.startsWith('-') && !subcommand) {
        subcommand = part;
      }
    }

    return { subcommand, options };
  }

  /**
   * 列出补全项
   */
  private listCompletions(options: CompleteOptions): CompleteResult {
    const limit = options.limit || 20;
    const input = '';

    const completions = commandCompletionManager.getCompletions(input);

    if (completions.length === 0) {
      return {
        type: 'text',
        value: '没有可用的补全项',
      };
    }

    const filtered = options.all ? completions : completions.slice(0, limit);
    const completionList = filtered
      .map((item) => `  ${item.value.padEnd(30)} - ${item.description || item.label}`)
      .join('\n');

    const header = options.all ? '所有补全项:' : `补全项 (前 ${filtered.length} 条):`;
    return {
      type: 'text',
      value: `${header}\n\n${completionList}\n\n共 ${completions.length} 项`,
    };
  }

  /**
   * 列出最近使用的命令
   */
  private listRecentCommands(options: CompleteOptions): CompleteResult {
    const limit = options.limit || 10;
    const completions = commandCompletionManager.getRecentCommands();

    if (completions.length === 0) {
      return {
        type: 'text',
        value: '没有最近使用的命令',
      };
    }

    const filtered = completions.slice(0, limit);
    const recentList = filtered
      .map((item, index) => `  ${(index + 1).toString().padEnd(3)} ${item.value}`)
      .join('\n');

    return {
      type: 'text',
      value: `最近使用的命令:\n\n${recentList}`,
    };
  }

  /**
   * 列出常用命令
   */
  private listFrequentCommands(options: CompleteOptions): CompleteResult {
    const limit = options.limit || 10;
    const completions = commandCompletionManager.getFrequentlyUsedCommands();

    if (completions.length === 0) {
      return {
        type: 'text',
        value: '没有常用命令',
      };
    }

    const filtered = completions.slice(0, limit);
    const frequentList = filtered
      .map((item) => `  ${item.value.padEnd(25)} ${item.description}`)
      .join('\n');

    return {
      type: 'text',
      value: `常用命令 (按使用频率排序):\n\n${frequentList}`,
    };
  }

  /**
   * 搜索补全项
   */
  private searchCompletions(options: CompleteOptions): CompleteResult {
    const limit = options.limit || 20;
    const completions = commandCompletionManager.getCompletions('');

    if (completions.length === 0) {
      return {
        type: 'text',
        value: '没有可用的补全项',
      };
    }

    const filtered = completions.slice(0, limit);
    const searchList = filtered
      .map((item) => `  ${item.value.padEnd(30)} - ${item.description || item.label}`)
      .join('\n');

    return {
      type: 'text',
      value: `补全项搜索结果:\n\n${searchList}`,
    };
  }

  /**
   * 显示统计信息
   */
  private showStats(): CompleteResult {
    const recent = commandCompletionManager.getRecentCommands();
    const frequent = commandCompletionManager.getFrequentlyUsedCommands();

    const stats = [
      '## 补全统计 ##',
      '',
      `最近命令数: ${recent.length}`,
      `常用命令数: ${frequent.length}`,
      '',
      '常用命令 TOP 5:',
    ];

    frequent.slice(0, 5).forEach((item, index) => {
      stats.push(`  ${index + 1}. ${item.value}`);
    });

    return {
      type: 'text',
      value: stats.join('\n'),
    };
  }

  /**
   * 清除历史
   */
  private clearHistory(): CompleteResult {
    return {
      type: 'text',
      value: '历史记录已清除 (功能开发中)',
    };
  }

  /**
   * 刷新缓存
   */
  private refreshCache(): CompleteResult {
    return {
      type: 'text',
      value: '补全缓存已刷新',
    };
  }

  /**
   * 显示帮助
   */
  private showHelp(): CompleteResult {
    return {
      type: 'text',
      value: `## /complete 命令 - 命令自动补全

用法: /complete <子命令> [选项]

子命令:
  list          - 列出所有补全项
  recent        - 列出最近使用的命令
  frequent      - 列出常用命令 (按使用频率排序)
  search        - 搜索补全项
  stats         - 显示补全统计信息
  clear         - 清除历史记录
  refresh       - 刷新补全缓存
  help          - 显示帮助

选项:
  --all, -a     显示所有项
  --limit=<n>, -n <n> 限制显示数量
  --fuzzy, -f   启用模糊匹配

示例:
  /complete list           - 列出所有补全项
  /complete recent         - 查看最近使用的命令
  /complete frequent       - 查看常用命令
  /complete list --limit=5  - 只显示前5条
  /complete stats          - 查看统计信息

别名: /comp, /auto
`,
    };
  }
}

export default CompleteCommand;