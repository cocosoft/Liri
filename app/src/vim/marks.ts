/**
 * Vim标记模块
 * 支持设置和管理文本标记
 */

export interface Mark {
  name: string;
  line: number;
  column: number;
  timestamp: number;
}

export class MarkManager {
  private marks: Record<string, Mark> = {};

  /**
   * 设置标记
   */
  setMark(name: string, line: number, column: number): void {
    this.marks[name] = {
      name,
      line,
      column,
      timestamp: Date.now(),
    };
  }

  /**
   * 获取标记
   */
  getMark(name: string): Mark | undefined {
    return this.marks[name];
  }

  /**
   * 删除标记
   */
  deleteMark(name: string): boolean {
    if (this.marks[name]) {
      delete this.marks[name];
      return true;
    }
    return false;
  }

  /**
   * 获取所有标记
   */
  getAllMarks(): Mark[] {
    return Object.values(this.marks);
  }

  /**
   * 清除所有标记
   */
  clearAll(): void {
    this.marks = {};
  }

  /**
   * 检查标记是否存在
   */
  hasMark(name: string): boolean {
    return !!this.marks[name];
  }

  /**
   * 获取标记数量
   */
  getCount(): number {
    return Object.keys(this.marks).length;
  }

  /**
   * 跳转到标记位置
   */
  jumpToMark(name: string): { line: number; column: number } | null {
    const mark = this.marks[name];
    if (!mark) return null;
    return { line: mark.line, column: mark.column };
  }
}

/**
 * 创建标记管理器实例
 */
export function createMarkManager(): MarkManager {
  return new MarkManager();
}

/**
 * 全局标记管理器实例
 */
export const markManager = createMarkManager();
