import type { CommandContext } from '../../types/index.js';
import { toolCacheManager } from '../../../tools/cache/ToolCacheManager.js';

const cacheCommand = {
  async call(args: string, context: CommandContext) {
    // 解析参数
    const params = args.trim().split(' ');
    const command = params[0];
    const toolName = params[1];

    switch (command) {
      case 'clear':
        return this.clearCache(toolName);
      case 'stats':
        return this.showStats();
      case 'size':
        return this.showSize();
      default:
        return {
          type: 'text' as const,
          value:
            '用法: /cache <命令> [工具名称]\n\n命令列表:\n  clear - 清除缓存（可选指定工具名称）\n  stats - 显示缓存统计信息\n  size - 显示缓存大小\n\n示例: /cache clear bash',
        };
    }
  },

  async clearCache(toolName?: string) {
    if (toolName) {
      toolCacheManager.clearToolCache(toolName);
      return {
        type: 'text' as const,
        value: `已清除工具 ${toolName} 的缓存`,
      };
    } else {
      toolCacheManager.clearCache();
      return {
        type: 'text' as const,
        value: '已清除所有工具缓存',
      };
    }
  },

  async showStats() {
    const stats = toolCacheManager.getCacheStats();

    let statsText = `缓存统计信息:\n\n`;
    statsText += `总缓存项: ${stats.total}\n\n`;

    if (Object.keys(stats.tools).length > 0) {
      statsText += `工具缓存分布:\n`;
      for (const [tool, count] of Object.entries(stats.tools)) {
        statsText += `  ${tool.padEnd(20)}: ${count}\n`;
      }
      statsText += `\n`;
    }

    if (stats.oldest) {
      statsText += `最旧缓存: ${new Date(stats.oldest).toLocaleString()}\n`;
    }

    if (stats.newest) {
      statsText += `最新缓存: ${new Date(stats.newest).toLocaleString()}\n`;
    }

    return {
      type: 'text' as const,
      value: statsText,
    };
  },

  async showSize() {
    const size = toolCacheManager.getCacheSize();
    return {
      type: 'text' as const,
      value: `缓存大小: ${size} 项`,
    };
  },
};

export default cacheCommand;
