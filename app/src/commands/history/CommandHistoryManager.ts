/**
 * 命令历史记录管理器
 * 负责存储和管理命令历史
 */

import fs from 'fs';
import path from 'path';
import { resolvePyappHome } from '@modules/core';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('CommandHistoryManager');

/**
 * 命令历史记录项
 */
export interface CommandHistoryItem {
  command: string;
  args: string;
  timestamp: number;
  success: boolean;
}

/**
 * 命令历史记录管理器
 */
export class CommandHistoryManager {
  private history: CommandHistoryItem[] = [];
  private historyPath: string;
  private maxHistorySize: number;

  /**
   * 构造函数
   * @param historyPath 历史记录文件路径
   * @param maxHistorySize 最大历史记录数量
   */
  constructor(
    historyPath: string = path.join(resolvePyappHome(), 'command_history.json'),
    maxHistorySize: number = 1000
  ) {
    this.historyPath = historyPath;
    this.maxHistorySize = maxHistorySize;
    this.loadHistory();
  }

  /**
   * 加载历史记录
   */
  private loadHistory(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.historyPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(this.historyPath)) {
        const content = fs.readFileSync(this.historyPath, 'utf8');
        this.history = JSON.parse(content);
      }
    } catch (error) {
      logger.warning('Failed to load command history:', { error });
      this.history = [];
    }
  }

  /**
   * 保存历史记录
   */
  private saveHistory(): void {
    try {
      // 确保目录存在
      const dir = path.dirname(this.historyPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 限制历史记录数量
      if (this.history.length > this.maxHistorySize) {
        this.history = this.history.slice(-this.maxHistorySize);
      }

      fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2));
    } catch (error) {
      logger.warning('Failed to save command history:', { error });
    }
  }

  /**
   * 添加命令历史
   * @param command 命令名称
   * @param args 命令参数
   * @param success 是否成功
   */
  addHistory(command: string, args: string, success: boolean = true): void {
    const item: CommandHistoryItem = {
      command,
      args,
      timestamp: Date.now(),
      success,
    };

    this.history.push(item);
    this.saveHistory();
  }

  /**
   * 获取命令历史
   * @param limit 限制数量
   * @returns 命令历史记录
   */
  getHistory(limit: number = 100): CommandHistoryItem[] {
    return this.history.slice(-limit);
  }

  /**
   * 搜索命令历史
   * @param query 搜索关键词
   * @param limit 限制数量
   * @returns 搜索结果
   */
  searchHistory(query: string, limit: number = 20): CommandHistoryItem[] {
    const lowerQuery = query.toLowerCase();
    return this.history
      .filter(
        (item) =>
          item.command.toLowerCase().includes(lowerQuery) ||
          item.args.toLowerCase().includes(lowerQuery)
      )
      .slice(-limit);
  }

  /**
   * 清除命令历史
   */
  clearHistory(): void {
    this.history = [];
    this.saveHistory();
  }

  /**
   * 获取最近的命令
   * @returns 最近的命令历史记录
   */
  getRecentCommand(): CommandHistoryItem | undefined {
    return this.history[this.history.length - 1];
  }

  /**
   * 获取命令使用频率
   * @returns 命令使用频率统计
   */
  getCommandFrequency(): Record<string, number> {
    const frequency: Record<string, number> = {};

    for (const item of this.history) {
      if (frequency[item.command]) {
        frequency[item.command]++;
      } else {
        frequency[item.command] = 1;
      }
    }

    return frequency;
  }
}

/**
 * 全局命令历史记录管理器实例
 */
export const commandHistoryManager = new CommandHistoryManager();
