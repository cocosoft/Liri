/**
 * Vim视觉模式模块
 * 支持字符级、行级和块级选择
 */

export type VisualModeType = 'char' | 'line' | 'block';

export interface VisualSelection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  mode: VisualModeType;
}

export class VisualModeManager {
  private isActive: boolean = false;
  private selection: VisualSelection | null = null;
  private mode: VisualModeType = 'char';

  /**
   * 进入视觉模式
   */
  enter(line: number, column: number, mode: VisualModeType = 'char'): void {
    this.isActive = true;
    this.mode = mode;
    this.selection = {
      startLine: line,
      startColumn: column,
      endLine: line,
      endColumn: column,
      mode,
    };
  }

  /**
   * 退出视觉模式
   */
  exit(): void {
    this.isActive = false;
    this.selection = null;
  }

  /**
   * 更新选择范围
   */
  update(endLine: number, endColumn: number): void {
    if (!this.selection) return;
    
    this.selection.endLine = endLine;
    this.selection.endColumn = endColumn;
  }

  /**
   * 设置模式类型
   */
  setMode(mode: VisualModeType): void {
    this.mode = mode;
    if (this.selection) {
      this.selection.mode = mode;
    }
  }

  /**
   * 获取当前选择
   */
  getSelection(): VisualSelection | null {
    return this.selection;
  }

  /**
   * 获取模式类型
   */
  getMode(): VisualModeType {
    return this.mode;
  }

  /**
   * 检查是否处于视觉模式
   */
  isVisualMode(): boolean {
    return this.isActive;
  }

  /**
   * 切换模式类型
   */
  toggleMode(): void {
    const modes: VisualModeType[] = ['char', 'line', 'block'];
    const currentIndex = modes.indexOf(this.mode);
    this.mode = modes[(currentIndex + 1) % modes.length];
    if (this.selection) {
      this.selection.mode = this.mode;
    }
  }

  /**
   * 获取选择的行数范围
   */
  getLineRange(): [number, number] | null {
    if (!this.selection) return null;
    
    const start = Math.min(this.selection.startLine, this.selection.endLine);
    const end = Math.max(this.selection.startLine, this.selection.endLine);
    
    return [start, end];
  }

  /**
   * 获取选择的列数范围
   */
  getColumnRange(): [number, number] | null {
    if (!this.selection) return null;
    
    const start = Math.min(this.selection.startColumn, this.selection.endColumn);
    const end = Math.max(this.selection.startColumn, this.selection.endColumn);
    
    return [start, end];
  }
}

/**
 * 创建视觉模式管理器实例
 */
export function createVisualModeManager(): VisualModeManager {
  return new VisualModeManager();
}

/**
 * 全局视觉模式管理器实例
 */
export const visualModeManager = createVisualModeManager();
