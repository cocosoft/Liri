import type { CommandContext } from '../../types/index.js';
import { historyManager } from '../../../utils/history.js';

const showHistory = async (
  limit: number
): Promise<{ type: 'text'; value: string }> => {
  try {
    const history = historyManager.getHistory(limit);

    if (history.length === 0) {
      return {
        type: 'text',
        value: '没有历史记录',
      };
    }

    const historyList = history
      .map((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        return `  ${(index + 1).toString().padEnd(3)}: ${item.command} (${date})`;
      })
      .join('\n');

    return {
      type: 'text',
      value: `最近的历史记录:\n\n${historyList}`,
    };
  } catch (error) {
    return {
      type: 'text',
      value: `获取历史记录失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const clearHistory = async (): Promise<{ type: 'text'; value: string }> => {
  try {
    await historyManager.clear();
    return {
      type: 'text',
      value: '历史记录已清空',
    };
  } catch (error) {
    return {
      type: 'text',
      value: `清空历史记录失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const searchHistory = async (
  query: string
): Promise<{ type: 'text'; value: string }> => {
  if (!query) {
    return {
      type: 'text',
      value: '请提供搜索关键词: /history search <关键词>',
    };
  }

  try {
    const results = historyManager.searchHistory(query);

    if (results.length === 0) {
      return {
        type: 'text',
        value: `未找到包含 "${query}" 的历史记录`,
      };
    }

    const resultList = results
      .map((item, index) => {
        const date = new Date(item.timestamp).toLocaleString();
        return `  ${(index + 1).toString().padEnd(3)}: ${item.command} (${date})`;
      })
      .join('\n');

    return {
      type: 'text',
      value: `搜索结果:\n\n${resultList}`,
    };
  } catch (error) {
    return {
      type: 'text',
      value: `搜索历史记录失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
};

const call = async (
  args: string,
  _context: CommandContext
): Promise<{ type: 'text'; value: string }> => {
  const parts = args.split(' ');
  const subCommand = parts[0];
  const limit = parts[1] ? parseInt(parts[1]) : 10;

  switch (subCommand) {
    case 'show':
      return await showHistory(limit);
    case 'clear':
      return await clearHistory();
    case 'search':
      return await searchHistory(parts.slice(1).join(' '));
    default:
      return {
        type: 'text',
        value: `历史命令用法:\n\n/history show [数量] - 显示历史记录\n/history clear - 清空历史记录\n/history search <关键词> - 搜索历史记录`,
      };
  }
};

export default {
  call,
};
