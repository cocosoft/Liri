/**
 * doc 模块可观测性指标
 * 暴露文档操作量、延迟、崩溃次数等 Counter/Histogram
 * 接入现有 MonitorTool 接口
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('doc:observability');

/** 轻量级 Counter（不依赖外部 metrics 库） */
class Counter {
  private count = 0;

  inc(label?: Record<string, string>): void {
    this.count++;
    if (label) {
      logger.debug('metrics counter inc', { ...label, count: this.count });
    }
  }

  get(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

/** 轻量级 Histogram（记录分布） */
class Histogram {
  private values: number[] = [];
  private sum = 0;
  private max = 0;
  private min = Infinity;

  record(value: number, label?: Record<string, string>): void {
    this.values.push(value);
    this.sum += value;
    this.max = Math.max(this.max, value);
    this.min = Math.min(this.min, value);
    if (label) {
      logger.debug('metrics histogram record', { ...label, value });
    }
  }

  /** 计算百分位 */
  percentile(p: number): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getStats() {
    return {
      count: this.values.length,
      sum: this.sum,
      max: this.max,
      min: this.min === Infinity ? 0 : this.min,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
    };
  }

  reset(): void {
    this.values = [];
    this.sum = 0;
    this.max = 0;
    this.min = Infinity;
  }
}

/**
 * doc 模块指标收集器
 */
export const docMetrics = {
  /** OfficeCLI 检测耗时 (ms) */
  cliDetectDuration: new Histogram(),

  /** MCP 连接耗时 (ms) */
  mcpConnectDuration: new Histogram(),

  /** 文档操作总量（按 type, format） */
  documentOpsTotal: new Counter(),

  /** 文档操作耗时 (ms)（按 type, format） */
  documentOpDuration: new Histogram(),

  /** OfficeCLI 崩溃次数 */
  cliCrashTotal: new Counter(),

  /** 资源拒绝次数（按 reason） */
  resourceRejectedTotal: new Counter(),

  /**
   * 重置所有指标（测试用）
   */
  resetAll(): void {
    this.cliDetectDuration.reset();
    this.mcpConnectDuration.reset();
    this.documentOpsTotal.reset();
    this.documentOpDuration.reset();
    this.cliCrashTotal.reset();
    this.resourceRejectedTotal.reset();
  },

  /**
   * 获取所有指标快照（供 MonitorTool 接口）
   */
  snapshot() {
    return {
      cliDetect: this.cliDetectDuration.getStats(),
      mcpConnect: this.mcpConnectDuration.getStats(),
      opsCount: this.documentOpsTotal.get(),
      opDuration: this.documentOpDuration.getStats(),
      crashes: this.cliCrashTotal.get(),
      resourceRejections: this.resourceRejectedTotal.get(),
    };
  },
};
