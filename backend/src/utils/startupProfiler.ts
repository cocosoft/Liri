/**
 * 启动性能分析工具
 * 用于测量和报告应用启动过程中各个阶段的时间消耗
 */

// 导出新的性能分析实现
export * from '../performance/StartupProfiler.js';

/**
 * 启动性能分析器类
 * 用于测量和报告应用初始化各个阶段的时间消耗
 * @deprecated 请使用新的性能分析系统
 */
export class StartupProfiler {
  private checkpoints: Array<{ name: string; timestamp: number; duration: number }> = [];
  private startTime: number;
  private stopped: boolean = false;

  constructor() {
    this.startTime = performance.now();
  }

  /**
   * 开始性能分析
   */
  start(): void {
    this.startTime = performance.now();
    this.checkpoints = [];
    this.stopped = false;
  }

  /**
   * 停止性能分析
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * 添加检查点
   */
  checkpoint(name: string): void {
    const now = performance.now();
    const duration = now - this.startTime;

    this.checkpoints.push({
      name,
      timestamp: now,
      duration,
    });
  }

  /**
   * 获取所有检查点
   */
  getCheckpoints(): Array<{ name: string; timestamp: number; duration: number }> {
    return [...this.checkpoints];
  }

  /**
   * 生成性能报告
   */
  generateReport(): {
    totalDuration: number;
    checkpoints: Array<{ name: string; timestamp: number; duration: number }>;
  } {
    const endTime = this.stopped
      ? this.checkpoints[this.checkpoints.length - 1]?.timestamp ||
        this.startTime
      : performance.now();
    const totalDuration = endTime - this.startTime;

    return {
      totalDuration,
      checkpoints: [...this.checkpoints],
    };
  }

  /**
   * 打印性能报告
   */
  printReport(): void {
    const report = this.generateReport();

    console.log('Startup Performance Report:');
    console.log(`Total Duration: ${report.totalDuration.toFixed(1)}ms`);
    console.log('Checkpoints:');

    for (const checkpoint of report.checkpoints) {
      console.log(`  ${checkpoint.name}: ${checkpoint.duration.toFixed(1)}ms`);
    }
  }
}

/**
 * 创建启动性能分析器
 * @deprecated 请使用新的性能分析系统
 */
export function createStartupProfiler(): StartupProfiler {
  return new StartupProfiler();
}
