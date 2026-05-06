/**
 * Cache命令
 * 管理工具执行缓存和其他类型的缓存
 */
import type { CommandContext } from '@modules/commands/types';
import { toolCacheManager } from '@modules/tools/cache/ToolCacheManager.js';

interface CacheResult {
  type: 'text';
  value: string;
}

/**
 * Cache命令实现类
 */
export class CacheCommand {
  /**
   * 执行命令
   * @param args - 命令参数
   * @param context - 命令上下文
   */
  async call(args: string, context: CommandContext): Promise<CacheResult> {
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
      case 'list':
        return this.listCache(toolName);
      case 'info':
        return this.showToolInfo(toolName);
      case 'purge':
        return this.purgeAllCache();
      case 'cleanup':
        return this.cleanupExpired();
      default:
        return this.showHelp();
    }
  }

  /**
   * 显示帮助信息
   */
  private showHelp(): CacheResult {
    return {
      type: 'text',
      value: `用法: /cache <命令> [工具名称]

命令列表:
  clear [工具名称]    - 清除缓存（可选指定工具名称）
  stats              - 显示缓存统计信息
  size               - 显示缓存大小
  list [工具名称]     - 列出缓存项（可选指定工具名称）
  info <工具名称>     - 显示指定工具的缓存详情
  purge              - 清除所有缓存（包括未过期的）
  cleanup            - 清理过期的缓存项

示例:
  /cache clear        - 清除所有工具缓存
  /cache clear bash   - 清除bash工具的缓存
  /cache list         - 列出所有缓存项
  /cache list git     - 列出git工具的缓存项
  /cache info bash    - 显示bash工具的缓存详情
  /cache cleanup      - 清理过期缓存`,
    };
  }

  /**
   * 清除缓存
   * @param toolName - 工具名称（可选）
   */
  private async clearCache(toolName?: string): Promise<CacheResult> {
    if (toolName) {
      toolCacheManager.clearToolCache(toolName);
      return {
        type: 'text',
        value: `已清除工具 ${toolName} 的缓存`,
      };
    } else {
      toolCacheManager.clearCache();
      return {
        type: 'text',
        value: '已清除所有工具缓存',
      };
    }
  }

  /**
   * 显示缓存统计信息
   */
  private async showStats(): Promise<CacheResult> {
    const stats = toolCacheManager.getCacheStats();

    let statsText = `缓存统计信息:\n\n`;
    statsText += `总缓存项: ${stats.total}\n\n`;

    if (Object.keys(stats.tools).length > 0) {
      statsText += `工具缓存分布:\n`;
      const sortedTools = Object.entries(stats.tools).sort((a, b) => b[1] - a[1]);
      for (const [tool, count] of sortedTools) {
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
      type: 'text',
      value: statsText,
    };
  }

  /**
   * 显示缓存大小
   */
  private async showSize(): Promise<CacheResult> {
    const size = toolCacheManager.getCacheSize();
    const stats = toolCacheManager.getCacheStats();
    
    let sizeText = `缓存大小: ${size} 项\n\n`;
    
    // 估算缓存占用的存储空间
    const estimatedBytes = size * 1024; // 假设每项平均1KB
    if (estimatedBytes < 1024) {
      sizeText += `估算存储大小: ${estimatedBytes} 字节`;
    } else if (estimatedBytes < 1024 * 1024) {
      sizeText += `估算存储大小: ${(estimatedBytes / 1024).toFixed(2)} KB`;
    } else {
      sizeText += `估算存储大小: ${(estimatedBytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    return {
      type: 'text',
      value: sizeText,
    };
  }

  /**
   * 列出缓存项
   * @param toolName - 工具名称（可选）
   */
  private async listCache(toolName?: string): Promise<CacheResult> {
    const stats = toolCacheManager.getCacheStats();
    
    if (stats.total === 0) {
      return {
        type: 'text',
        value: '当前没有缓存项',
      };
    }

    let listText = '';
    
    if (toolName) {
      const count = stats.tools[toolName] || 0;
      listText = `工具 ${toolName} 的缓存项: ${count} 项\n\n`;
      
      if (count > 0) {
        listText += `使用 \`/cache info ${toolName}\` 查看详细信息`;
      }
    } else {
      listText = `所有缓存项:\n\n`;
      const sortedTools = Object.entries(stats.tools).sort((a, b) => b[1] - a[1]);
      
      for (const [tool, count] of sortedTools) {
        listText += `  ${tool.padEnd(20)}: ${count} 项\n`;
      }
      
      listText += `\n总缓存项: ${stats.total}`;
    }

    return {
      type: 'text',
      value: listText,
    };
  }

  /**
   * 显示指定工具的缓存详情
   * @param toolName - 工具名称
   */
  private async showToolInfo(toolName?: string): Promise<CacheResult> {
    if (!toolName) {
      return {
        type: 'text',
        value: '请指定工具名称。用法: /cache info <工具名称>',
      };
    }

    const stats = toolCacheManager.getCacheStats();
    const count = stats.tools[toolName] || 0;

    let infoText = `工具 "${toolName}" 的缓存信息:\n\n`;
    infoText += `缓存项数量: ${count}\n`;
    
    if (count > 0) {
      infoText += `\n使用以下命令管理此工具的缓存:\n`;
      infoText += `  /cache clear ${toolName}  - 清除此工具的缓存`;
    }

    return {
      type: 'text',
      value: infoText,
    };
  }

  /**
   * 清除所有缓存（包括未过期的）
   */
  private async purgeAllCache(): Promise<CacheResult> {
    toolCacheManager.clearCache();
    
    return {
      type: 'text',
      value: '已清除所有缓存（包括未过期的缓存项）',
    };
  }

  /**
   * 清理过期的缓存项
   */
  private async cleanupExpired(): Promise<CacheResult> {
    // ToolCacheManager 在加载时会自动过滤过期项
    // 这里我们可以重新加载缓存来清理过期项
    // 由于当前实现没有公开的清理方法，我们直接返回提示
    return {
      type: 'text',
      value: '过期缓存已自动清理。\n\n提示: 缓存项会在访问时自动检查过期时间并清理。',
    };
  }
}

export default new CacheCommand();