/**
 * 命令历史模块
 * 管理CLI命令历史记录
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { resolvePyappHome } from '@modules/core/paths';

export interface HistoryOptions {
  maxItems?: number;
  historyFile?: string;
}

export class CommandHistory {
  private history: string[] = [];
  private options: HistoryOptions;
  private historyFile: string;

  constructor(options?: HistoryOptions) {
    this.options = {
      maxItems: 1000,
      historyFile: join(resolvePyappHome(), 'history'),
      ...options,
    };
    this.historyFile = this.options.historyFile!;
    this.loadHistory();
  }

  /**
   * 加载历史记录
   */
  private loadHistory(): void {
    try {
      if (existsSync(this.historyFile)) {
        const content = readFileSync(this.historyFile, 'utf-8');
        this.history = content
          .split('\n')
          .filter((line) => line.trim())
          .slice(-this.options.maxItems!);
      }
    } catch {
      this.history = [];
    }
  }

  /**
   * 保存历史记录
   */
  private saveHistory(): void {
    try {
      const content = this.history.join('\n');
      writeFileSync(this.historyFile, content, 'utf-8');
    } catch {
      // 忽略保存错误
    }
  }

  /**
   * 添加命令到历史记录
   */
  add(command: string): void {
    if (!command.trim()) return;

    // 避免重复连续命令
    if (this.history[this.history.length - 1] === command) return;

    this.history.push(command);

    // 保持历史记录在最大数量以内
    if (this.history.length > this.options.maxItems!) {
      this.history = this.history.slice(-this.options.maxItems!);
    }

    this.saveHistory();
  }

  /**
   * 获取历史记录
   */
  getHistory(): string[] {
    return [...this.history];
  }

  /**
   * 获取指定索引的历史命令
   */
  get(index: number): string | undefined {
    return this.history[index];
  }

  /**
   * 获取最近的命令
   */
  getRecent(count: number): string[] {
    return this.history.slice(-count);
  }

  /**
   * 搜索历史记录
   */
  search(pattern: string): string[] {
    const regex = new RegExp(pattern, 'i');
    return this.history.filter((command) => regex.test(command));
  }

  /**
   * 清除历史记录
   */
  clear(): void {
    this.history = [];
    this.saveHistory();
  }

  /**
   * 获取历史记录数量
   */
  getLength(): number {
    return this.history.length;
  }

  /**
   * 获取历史记录中的唯一命令
   */
  getUniqueCommands(): string[] {
    return [...new Set(this.history)].reverse();
  }

  /**
   * 生成命令建议
   */
  getSuggestions(prefix: string): string[] {
    const unique = this.getUniqueCommands();
    return unique.filter((cmd) => cmd.startsWith(prefix)).slice(0, 10);
  }
}

/**
 * 创建命令历史实例
 */
export function createCommandHistory(options?: HistoryOptions): CommandHistory {
  return new CommandHistory(options);
}

/**
 * 全局命令历史实例
 */
export const commandHistory = createCommandHistory();
