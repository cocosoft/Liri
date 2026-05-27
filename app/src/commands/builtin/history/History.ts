/**
 * 历史命令
 * 管理命令历史记录：查看、搜索和清空
 */

import type { CommandContext } from '@modules/commands/types';
import { historyManager } from '@modules/utils/history.js';

/**
 * 显示历史记录
 * @param limit 显示条数
 */
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

/**
 * 清空历史记录
 */
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

/**
 * 搜索历史记录
 * @param query 搜索关键词
 */
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

/**
 * 获取帮助文本
 */
const getHelpText = (): string => {
  return [
    '历史命令用法:',
    '',
    '  /history              显示最近10条历史记录',
    '  /history show [数量]  显示指定数量的历史记录（默认10条）',
    '  /history clear        清空所有历史记录',
    '  /history search <词>  搜索包含关键词的历史记录',
    '',
    '示例:',
    '  /history              - 显示最近10条记录',
    '  /history show 50      - 显示最近50条记录',
    '  /history search git   - 搜索包含"git"的记录',
    '  /history clear        - 清空所有记录',
    '',
    '别名: /hist, /hst',
  ].join('\n');
};

/**
 * 命令入口
 * @param args 命令参数
 * @param _context 命令上下文
 */
const call = async (
  args: string,
  _context: CommandContext
): Promise<{ type: 'text'; value: string }> => {
  const trimmed = args.trim();

  if (!trimmed) {
    return await showHistory(10);
  }

  const parts = trimmed.split(/\s+/);
  const subCommand = parts[0];
  const subArgs = parts.slice(1).join(' ');

  switch (subCommand) {
    case 'show':
      return await showHistory(subArgs ? parseInt(subArgs) : 10);
    case 'clear':
      return await clearHistory();
    case 'search':
      return await searchHistory(subArgs);
    case 'help':
    case '--help':
    case '-h':
      return { type: 'text', value: getHelpText() };
    default:
      return { type: 'text', value: getHelpText() };
  }
};

export default {
  call,
};
