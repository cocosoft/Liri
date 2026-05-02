/**
 * Vim折叠模块
 * 支持代码折叠功能
 */

export interface FoldRange {
  startLine: number;
  endLine: number;
  level: number;
  type: 'indent' | 'syntax' | 'marker' | 'manual';
  isOpen: boolean;
}

export class FoldManager {
  private folds: FoldRange[] = [];
  private text: string = '';
  private foldMethod: 'indent' | 'syntax' | 'marker' | 'manual' = 'indent';
  private foldLevel: number = 0;

  /**
   * 设置文本
   */
  setText(text: string): void {
    this.text = text;
    this.detectFolds();
  }

  /**
   * 设置折叠方法
   */
  setFoldMethod(method: 'indent' | 'syntax' | 'marker' | 'manual'): void {
    this.foldMethod = method;
    this.detectFolds();
  }

  /**
   * 设置折叠级别
   */
  setFoldLevel(level: number): void {
    this.foldLevel = level;
  }

  /**
   * 检测折叠
   */
  private detectFolds(): void {
    this.folds = [];
    
    switch (this.foldMethod) {
      case 'indent':
        this.detectIndentFolds();
        break;
      case 'marker':
        this.detectMarkerFolds();
        break;
      case 'manual':
        // 手动折叠需要用户操作
        break;
    }
  }

  /**
   * 检测缩进折叠
   */
  private detectIndentFolds(): void {
    const lines = this.text.split('\n');
    const folds: FoldRange[] = [];
    let currentFold: FoldRange | null = null;
    let prevIndent = 0;

    lines.forEach((line, index) => {
      const indent = this.getIndentLevel(line);
      
      if (indent > prevIndent && !currentFold) {
        // 开始新折叠
        currentFold = {
          startLine: index,
          endLine: index,
          level: indent,
          type: 'indent',
          isOpen: false,
        };
      } else if (indent < prevIndent && currentFold) {
        // 结束当前折叠
        currentFold.endLine = index - 1;
        folds.push(currentFold);
        currentFold = null;
      } else if (currentFold) {
        // 扩展折叠
        currentFold.endLine = index;
      }
      
      prevIndent = indent;
    });

    // 添加最后一个折叠
    if (currentFold) {
      folds.push(currentFold);
    }

    this.folds = folds;
  }

  /**
   * 检测标记折叠
   */
  private detectMarkerFolds(): void {
    const lines = this.text.split('\n');
    const folds: FoldRange[] = [];
    let currentFold: FoldRange | null = null;

    lines.forEach((line, index) => {
      if (line.includes('{{{')) {
        // 开始折叠
        const level = (line.match(/\{\{\{/g) || []).length;
        currentFold = {
          startLine: index,
          endLine: index,
          level,
          type: 'marker',
          isOpen: false,
        };
      } else if (line.includes('}}}') && currentFold) {
        // 结束折叠
        currentFold.endLine = index;
        folds.push(currentFold);
        currentFold = null;
      } else if (currentFold) {
        // 扩展折叠
        currentFold.endLine = index;
      }
    });

    this.folds = folds;
  }

  /**
   * 获取缩进级别
   */
  private getIndentLevel(line: string): number {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    
    const spaces = match[1].length;
    const tabSize = 4; // 假设tab大小为4
    
    return Math.floor(spaces / tabSize);
  }

  /**
   * 获取所有折叠
   */
  getFolds(): FoldRange[] {
    return [...this.folds];
  }

  /**
   * 获取指定行的折叠
   */
  getFoldAtLine(line: number): FoldRange | undefined {
    return this.folds.find(
      (f) => line >= f.startLine && line <= f.endLine
    );
  }

  /**
   * 切换折叠状态
   */
  toggleFold(line: number): void {
    const fold = this.getFoldAtLine(line);
    if (fold) {
      fold.isOpen = !fold.isOpen;
    }
  }

  /**
   * 打开所有折叠
   */
  openAllFolds(): void {
    this.folds.forEach((f) => (f.isOpen = true));
  }

  /**
   * 关闭所有折叠
   */
  closeAllFolds(): void {
    this.folds.forEach((f) => (f.isOpen = false));
  }

  /**
   * 打开指定级别的折叠
   */
  openFoldsUpTo(level: number): void {
    this.folds.forEach((f) => {
      if (f.level <= level) {
        f.isOpen = true;
      }
    });
  }

  /**
   * 检查行是否被折叠
   */
  isLineFolded(line: number): boolean {
    const fold = this.folds.find(
      (f) => !f.isOpen && line > f.startLine && line <= f.endLine
    );
    return !!fold;
  }

  /**
   * 获取折叠状态（用于显示）
   */
  getFoldDisplay(line: number): { isFolded: boolean; fold?: FoldRange } {
    const fold = this.getFoldAtLine(line);
    if (!fold) {
      return { isFolded: false };
    }
    
    if (line === fold.startLine) {
      return { isFolded: false, fold };
    }
    
    if (!fold.isOpen && line > fold.startLine && line <= fold.endLine) {
      return { isFolded: true, fold };
    }
    
    return { isFolded: false };
  }

  /**
   * 添加手动折叠
   */
  addManualFold(startLine: number, endLine: number): void {
    const fold: FoldRange = {
      startLine,
      endLine,
      level: 1,
      type: 'manual',
      isOpen: false,
    };
    this.folds.push(fold);
  }

  /**
   * 删除折叠
   */
  removeFold(startLine: number): void {
    this.folds = this.folds.filter((f) => f.startLine !== startLine);
  }

  /**
   * 清除所有折叠
   */
  clearFolds(): void {
    this.folds = [];
  }
}

/**
 * 创建折叠管理器实例
 */
export function createFoldManager(): FoldManager {
  return new FoldManager();
}

/**
 * 全局折叠管理器实例
 */
export const foldManager = createFoldManager();
