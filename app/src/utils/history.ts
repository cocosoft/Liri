/**
 * 命令历史记录管理
 */

import fs from 'fs/promises';
import path from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import { resolvePyappHome } from '@modules/core';

const logger = new Logger({ module: 'utils:history', level: LogLevel.INFO });

/**
 * 历史记录项
 */
export interface HistoryItem {
  command: string;
  timestamp: number;
  sessionId: string;
}

/**
 * 历史记录管理器
 */
export class HistoryManager {
  private history: HistoryItem[] = [];
  private maxHistorySize = 1000;
  private historyFile: string;

  constructor() {
    const configDir = resolvePyappHome();
    this.historyFile = path.join(configDir, 'history.json');

    // 确保配置目录存在
    this.ensureConfigDir();
  }

  /**
   * 确保配置目录存在
   */
  private async ensureConfigDir(): Promise<void> {
    const dir = path.dirname(this.historyFile);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // EEXIST: 目录已存在，忽略
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        handleError(error, {
          module: 'utils:history',
          action: 'ensureConfigDir',
        });
      }
    }
  }

  /**
   * 加载历史记录
   */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.historyFile, 'utf8');
      this.history = JSON.parse(data);
      this.history = this.history.slice(-this.maxHistorySize);
    } catch (error) {
      // ENOENT: 首次运行文件不存在，使用空历史
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        this.history = [];
        return;
      }
      // 解析失败等其他错误
      handleError(error, { module: 'utils:history', action: 'loadHistory' });
      this.history = [];
    }
  }

  /**
   * 保存历史记录
   */
  async save(): Promise<void> {
    try {
      // 限制历史记录大小
      const trimmedHistory = this.history.slice(-this.maxHistorySize);
      await fs.writeFile(
        this.historyFile,
        JSON.stringify(trimmedHistory, null, 2)
      );
    } catch (error) {
      // 保存失败，忽略错误
      handleError(error, { module: 'utils:history', action: 'saveHistory' });
      logger.warning('Failed to save history:', { error });
    }
  }

  /**
   * 添加命令到历史记录
   * @param command 命令
   * @param sessionId 会话ID
   */
  async add(command: string, sessionId: string): Promise<void> {
    // 跳过空命令和重复的连续命令
    if (
      !command.trim() ||
      (this.history.length > 0 &&
        this.history[this.history.length - 1].command === command)
    ) {
      return;
    }

    this.history.push({
      command,
      timestamp: Date.now(),
      sessionId,
    });

    // 限制历史记录大小
    this.history = this.history.slice(-this.maxHistorySize);

    // 异步保存
    await this.save();
  }

  /**
   * 获取历史记录
   * @param limit 限制数量
   */
  getHistory(limit: number = 10): HistoryItem[] {
    return this.history.slice(-limit).reverse();
  }

  /**
   * 清空历史记录
   */
  async clear(): Promise<void> {
    this.history = [];
    await this.save();
  }

  /**
   * 搜索历史记录
   * @param query 搜索关键词
   */
  searchHistory(query: string): HistoryItem[] {
    return this.history.filter((item) => item.command.includes(query));
  }

  /**
   * 获取历史记录数量
   */
  getHistoryCount(): number {
    return this.history.length;
  }
}

/**
 * 历史记录管理器实例（使用全局符号确保单例）
 */
const HISTORY_MANAGER_SYMBOL = Symbol.for('Liri_HISTORY_MANAGER');

export const historyManager: HistoryManager = (() => {
  const globalObj = globalThis as unknown as Record<symbol, HistoryManager>;
  if (!globalObj[HISTORY_MANAGER_SYMBOL]) {
    globalObj[HISTORY_MANAGER_SYMBOL] = new HistoryManager();
  }
  return globalObj[HISTORY_MANAGER_SYMBOL];
})();
