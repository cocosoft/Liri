/**
 * Vim多光标模块
 * 支持多光标同时编辑
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface CursorPosition {
  line: number;
  column: number;
}

export class MultiCursorManager {
  private cursors: CursorPosition[] = [];
  private isActive: boolean = false;

  /**
   * 启用多光标模式
   */
  activate(): void {
    this.isActive = true;
  }

  /**
   * 禁用多光标模式
   */
  deactivate(): void {
    this.isActive = false;
    this.clearCursors();
  }

  /**
   * 检查是否处于多光标模式
   */
  isMultiCursorMode(): boolean {
    return this.isActive;
  }

  /**
   * 添加光标
   */
  addCursor(line: number, column: number): void {
    if (!this.isActive) return;

    const exists = this.cursors.some(
      (c) => c.line === line && c.column === column
    );

    if (!exists) {
      this.cursors.push({ line, column });
    }
  }

  /**
   * 移除光标
   */
  removeCursor(line: number, column: number): void {
    this.cursors = this.cursors.filter(
      (c) => !(c.line === line && c.column === column)
    );
  }

  /**
   * 设置光标列表
   */
  setCursors(cursors: CursorPosition[]): void {
    if (!this.isActive) return;
    this.cursors = [...cursors];
  }

  /**
   * 获取所有光标
   */
  getCursors(): CursorPosition[] {
    return [...this.cursors];
  }

  /**
   * 获取主光标（第一个）
   */
  getPrimaryCursor(): CursorPosition | null {
    return this.cursors[0] || null;
  }

  /**
   * 清除所有光标
   */
  clearCursors(): void {
    this.cursors = [];
  }

  /**
   * 获取光标数量
   */
  getCursorCount(): number {
    return this.cursors.length;
  }

  /**
   * 移动所有光标
   */
  moveCursors(
    direction: 'up' | 'down' | 'left' | 'right',
    steps: number = 1
  ): void {
    this.cursors = this.cursors.map((cursor) => {
      switch (direction) {
        case 'up':
          return { ...cursor, line: Math.max(0, cursor.line - steps) };
        case 'down':
          return { ...cursor, line: cursor.line + steps };
        case 'left':
          return { ...cursor, column: Math.max(0, cursor.column - steps) };
        case 'right':
          return { ...cursor, column: cursor.column + steps };
        default:
          return cursor;
      }
    });
  }

  /**
   * 在每个光标位置插入文本
   */
  insertText(text: string): void {
    // 在实际实现中，这里会在每个光标位置插入文本
    // 为了简化，我们只记录操作
    logger.debug(`Inserting "${text}" at ${this.cursors.length} cursors`);
  }

  /**
   * 删除每个光标位置的字符
   */
  deleteChar(direction: 'left' | 'right'): void {
    // 在实际实现中，这里会删除每个光标位置的字符
    logger.debug(
      `Deleting char ${direction} at ${this.cursors.length} cursors`
    );
  }

  /**
   * 选择所有光标之间的区域
   */
  selectBetweenCursors(): void {
    if (this.cursors.length < 2) return;

    const minLine = Math.min(...this.cursors.map((c) => c.line));
    const maxLine = Math.max(...this.cursors.map((c) => c.line));
    const minCol = Math.min(...this.cursors.map((c) => c.column));
    const maxCol = Math.max(...this.cursors.map((c) => c.column));

    // 在实际实现中，这里会创建选择区域
    logger.debug(
      `Selecting area from (${minLine}, ${minCol}) to (${maxLine}, ${maxCol})`
    );
  }

  /**
   * 添加光标到匹配项
   */
  addCursorsToMatches(pattern: string): void {
    // 在实际实现中，这里会搜索匹配项并添加光标
    logger.debug(`Adding cursors to matches for pattern: ${pattern}`);
  }

  /**
   * 添加光标到所有出现的单词
   */
  addCursorsToWord(word: string): void {
    // 在实际实现中，这里会查找所有出现的单词并添加光标
    logger.debug(`Adding cursors to all occurrences of: ${word}`);
  }

  /**
   * 切换当前行的光标
   */
  toggleCursor(line: number, column: number): void {
    const exists = this.cursors.some(
      (c) => c.line === line && c.column === column
    );

    if (exists) {
      this.removeCursor(line, column);
    } else {
      this.addCursor(line, column);
    }
  }

  /**
   * 获取光标范围
   */
  getCursorRange(): { start: CursorPosition; end: CursorPosition } | null {
    if (this.cursors.length === 0) return null;

    const minLine = Math.min(...this.cursors.map((c) => c.line));
    const maxLine = Math.max(...this.cursors.map((c) => c.line));
    const minCol = Math.min(...this.cursors.map((c) => c.column));
    const maxCol = Math.max(...this.cursors.map((c) => c.column));

    return {
      start: { line: minLine, column: minCol },
      end: { line: maxLine, column: maxCol },
    };
  }
}

/**
 * 创建多光标管理器实例
 */
export function createMultiCursorManager(): MultiCursorManager {
  return new MultiCursorManager();
}

/**
 * 全局多光标管理器实例
 */
export const multiCursorManager = createMultiCursorManager();
