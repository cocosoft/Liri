/**
 * 增强的命令历史管理器
 * 支持历史导航、搜索和智能建议
 */

import {
  CommandHistoryManager,
  CommandHistoryItem,
} from './CommandHistoryManager.js';

/**
 * 历史导航状态
 */
export interface HistoryNavigationState {
  currentIndex: number;
  searchQuery: string;
  filteredHistory: CommandHistoryItem[];
}

/**
 * 增强的命令历史管理器
 */
export class EnhancedCommandHistory extends CommandHistoryManager {
  private navigationState: HistoryNavigationState = {
    currentIndex: -1,
    searchQuery: '',
    filteredHistory: [],
  };

  /**
   * 开始历史导航
   * @param query 搜索查询（可选）
   */
  startNavigation(query: string = ''): void {
    this.navigationState.searchQuery = query;
    this.navigationState.currentIndex = -1;

    if (query) {
      // 搜索模式
      this.navigationState.filteredHistory = this.searchHistory(query, 100);
    } else {
      // 全部历史模式
      this.navigationState.filteredHistory = this.getHistory(100);
    }
  }

  /**
   * 获取上一条命令
   * @returns 上一条命令或undefined
   */
  getPreviousCommand(): string | undefined {
    const { currentIndex, filteredHistory } = this.navigationState;

    if (currentIndex < filteredHistory.length - 1) {
      this.navigationState.currentIndex++;
      const item =
        filteredHistory[
          filteredHistory.length - 1 - this.navigationState.currentIndex
        ];
      return `${item.command} ${item.args}`.trim();
    }

    return undefined;
  }

  /**
   * 获取下一条命令
   * @returns 下一条命令或undefined
   */
  getNextCommand(): string | undefined {
    const { currentIndex } = this.navigationState;

    if (currentIndex > 0) {
      this.navigationState.currentIndex--;
      const { filteredHistory } = this.navigationState;
      const item =
        filteredHistory[
          filteredHistory.length - 1 - this.navigationState.currentIndex
        ];
      return `${item.command} ${item.args}`.trim();
    } else if (currentIndex === 0) {
      this.navigationState.currentIndex = -1;
      return '';
    }

    return undefined;
  }

  /**
   * 获取智能建议
   * @param prefix 命令前缀
   * @param limit 建议数量限制
   * @returns 建议列表
   */
  getSuggestions(prefix: string, limit: number = 10): string[] {
    const history = this.getHistory(1000);
    const suggestions = new Set<string>();

    for (const item of history) {
      const command = `${item.command} ${item.args}`.trim();

      // 检查是否匹配前缀
      if (command.toLowerCase().startsWith(prefix.toLowerCase())) {
        suggestions.add(command);

        if (suggestions.size >= limit) {
          break;
        }
      }
    }

    return Array.from(suggestions);
  }

  /**
   * 获取常用命令
   * @param limit 限制数量
   * @returns 常用命令列表
   */
  getFrequentCommands(
    limit: number = 10
  ): Array<{ command: string; count: number }> {
    const frequency = this.getCommandFrequency();
    const sorted = Object.entries(frequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([command, count]) => ({ command, count }));

    return sorted;
  }

  /**
   * 获取命令统计信息
   * @returns 统计信息
   */
  getStatistics(): {
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    mostUsedCommand: string;
    averageCommandsPerDay: number;
  } {
    const history = this.getHistory();
    const totalCommands = history.length;
    const successfulCommands = history.filter((item) => item.success).length;
    const failedCommands = totalCommands - successfulCommands;

    const frequency = this.getCommandFrequency();
    const mostUsedCommand =
      Object.entries(frequency).sort(([, a], [, b]) => b - a)[0]?.[0] || '';

    // 计算平均每天命令数
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;
    const firstCommand = history[0];
    const daysSinceFirst = firstCommand
      ? Math.max(1, Math.floor((now - firstCommand.timestamp) / dayInMs))
      : 1;
    const averageCommandsPerDay = totalCommands / daysSinceFirst;

    return {
      totalCommands,
      successfulCommands,
      failedCommands,
      mostUsedCommand,
      averageCommandsPerDay,
    };
  }

  /**
   * 结束历史导航
   */
  endNavigation(): void {
    this.navigationState = {
      currentIndex: -1,
      searchQuery: '',
      filteredHistory: [],
    };
  }

  /**
   * 获取当前导航状态
   * @returns 导航状态
   */
  getNavigationState(): HistoryNavigationState {
    return { ...this.navigationState };
  }
}

/**
 * 全局增强命令历史管理器实例
 */
export const enhancedCommandHistory = new EnhancedCommandHistory();

/**
 * 获取增强命令历史管理器
 * @returns 增强命令历史管理器实例
 */
export function getEnhancedCommandHistory(): EnhancedCommandHistory {
  return enhancedCommandHistory;
}
