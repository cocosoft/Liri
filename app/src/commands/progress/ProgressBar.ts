/**
 * 进度显示工具
 * 用于在命令执行过程中显示进度条
 */

export interface ProgressOptions {
  total: number;
  width?: number;
  title?: string;
  showPercentage?: boolean;
  showETA?: boolean;
  char?: string;
  color?: string;
}

export class ProgressBar {
  private total: number;
  private width: number;
  private title: string;
  private showPercentage: boolean;
  private showETA: boolean;
  private char: string;
  private color: string;
  private current: number;
  private startTime: number;
  private lastUpdateTime: number;

  constructor(options: ProgressOptions) {
    this.total = options.total;
    this.width = options.width || 40;
    this.title = options.title || 'Progress';
    this.showPercentage = options.showPercentage !== false;
    this.showETA = options.showETA !== false;
    this.char = options.char || '█';
    this.color = options.color || 'green';
    this.current = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = 0;
  }

  /**
   * 更新进度
   */
  update(current: number): void {
    this.current = Math.min(current, this.total);

    // 限制更新频率，避免过于频繁的输出
    const now = Date.now();
    if (now - this.lastUpdateTime < 50) {
      // 每50ms更新一次
      return;
    }
    this.lastUpdateTime = now;

    this.render();
  }

  /**
   * 增加进度
   */
  increment(amount: number = 1): void {
    this.update(this.current + amount);
  }

  /**
   * 完成进度
   */
  complete(): void {
    this.update(this.total);
    console.log(); // 换行
  }

  /**
   * 渲染进度条
   */
  private render(): void {
    const percentage = (this.current / this.total) * 100;
    const filledWidth = Math.floor((percentage / 100) * this.width);
    const emptyWidth = this.width - filledWidth;

    const filled = this.char.repeat(filledWidth);
    const empty = ' '.repeat(emptyWidth);

    let bar = `[${filled}${empty}]`;

    // 添加百分比
    if (this.showPercentage) {
      bar += ` ${percentage.toFixed(1)}%`;
    }

    // 添加ETA
    if (this.showETA && this.current > 0) {
      const elapsed = Date.now() - this.startTime;
      const eta = (elapsed / this.current) * (this.total - this.current);
      bar += ` ETA: ${this.formatTime(eta)}`;
    }

    // 清除当前行并输出新的进度条
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`${this.title}: ${bar}`);
  }

  /**
   * 格式化时间
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${remainingSeconds}s`;
  }

  /**
   * 检查终端是否支持进度条
   */
  static supportsProgress(): boolean {
    return process.stdout.isTTY;
  }

  /**
   * 创建一个安全的进度条实例
   */
  static create(options: ProgressOptions): ProgressBar | null {
    if (ProgressBar.supportsProgress()) {
      return new ProgressBar(options);
    }
    return null;
  }
}
