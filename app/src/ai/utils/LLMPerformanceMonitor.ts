/**
 * LLM性能监控工具
 * 提供性能指标收集、统计分析和优化建议
 */

export interface PerformanceMetrics {
  requestCount: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  averageLatency: number;
  minLatency: number;
  maxLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
}

export interface RequestRecord {
  timestamp: Date;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latency: number;
  success: boolean;
  error?: string;
  cost: number;
}

export class LLMPerformanceMonitor {
  private records: RequestRecord[] = [];
  private static instance: LLMPerformanceMonitor;
  private readonly maxRecords = 10000;

  private constructor() {}

  static getInstance(): LLMPerformanceMonitor {
    if (!LLMPerformanceMonitor.instance) {
      LLMPerformanceMonitor.instance = new LLMPerformanceMonitor();
    }
    return LLMPerformanceMonitor.instance;
  }

  recordRequest(record: Omit<RequestRecord, 'timestamp'>): void {
    const fullRecord: RequestRecord = { ...record, timestamp: new Date() };

    this.records.push(fullRecord);

    if (this.records.length > this.maxRecords) {
      this.records.shift();
    }
  }

  getMetrics(timeWindowMs?: number): PerformanceMetrics {
    let filteredRecords = this.records;

    if (timeWindowMs) {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      filteredRecords = this.records.filter((r) => r.timestamp >= cutoffTime);
    }

    if (filteredRecords.length === 0) {
      return {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCost: 0,
        averageLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
      };
    }

    const latencies = filteredRecords
      .map((r) => r.latency)
      .sort((a, b) => a - b);
    const totalTokens = filteredRecords.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0
    );
    const totalCost = filteredRecords.reduce((sum, r) => sum + r.cost, 0);
    const totalLatency = latencies.reduce((sum, l) => sum + l, 0);

    return {
      requestCount: filteredRecords.length,
      successCount: filteredRecords.filter((r) => r.success).length,
      failureCount: filteredRecords.filter((r) => !r.success).length,
      totalTokens,
      totalCost,
      averageLatency: totalLatency / filteredRecords.length,
      minLatency: latencies[0],
      maxLatency: latencies[latencies.length - 1],
      p50Latency: this.percentile(latencies, 50),
      p95Latency: this.percentile(latencies, 95),
      p99Latency: this.percentile(latencies, 99),
    };
  }

  private percentile(sortedArray: number[], p: number): number {
    const index = Math.ceil((sortedArray.length * p) / 100) - 1;
    return sortedArray[Math.max(0, index)];
  }

  getRecentRecords(count: number = 100): RequestRecord[] {
    return this.records.slice(-count);
  }

  getMetricsByModel(timeWindowMs?: number): Record<string, PerformanceMetrics> {
    let filteredRecords = this.records;

    if (timeWindowMs) {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      filteredRecords = this.records.filter((r) => r.timestamp >= cutoffTime);
    }

    const byModel: Record<string, RequestRecord[]> = {};
    for (const record of filteredRecords) {
      if (!byModel[record.model]) {
        byModel[record.model] = [];
      }
      byModel[record.model].push(record);
    }

    const result: Record<string, PerformanceMetrics> = {};
    for (const [model, records] of Object.entries(byModel)) {
      result[model] = this.calculateMetrics(records);
    }

    return result;
  }

  private calculateMetrics(records: RequestRecord[]): PerformanceMetrics {
    if (records.length === 0) {
      return {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        totalTokens: 0,
        totalCost: 0,
        averageLatency: 0,
        minLatency: 0,
        maxLatency: 0,
        p50Latency: 0,
        p95Latency: 0,
        p99Latency: 0,
      };
    }

    const latencies = records.map((r) => r.latency).sort((a, b) => a - b);
    const totalTokens = records.reduce(
      (sum, r) => sum + r.inputTokens + r.outputTokens,
      0
    );
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const totalLatency = latencies.reduce((sum, l) => sum + l, 0);

    return {
      requestCount: records.length,
      successCount: records.filter((r) => r.success).length,
      failureCount: records.filter((r) => !r.success).length,
      totalTokens,
      totalCost,
      averageLatency: totalLatency / records.length,
      minLatency: latencies[0],
      maxLatency: latencies[latencies.length - 1],
      p50Latency: this.percentile(latencies, 50),
      p95Latency: this.percentile(latencies, 95),
      p99Latency: this.percentile(latencies, 99),
    };
  }

  clear(): void {
    this.records = [];
  }

  getOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];
    const metrics = this.getMetrics(3600000);

    if (metrics.requestCount === 0) {
      return suggestions;
    }

    const failureRate = metrics.failureCount / metrics.requestCount;
    if (failureRate > 0.1) {
      suggestions.push(
        `失败率较高 (${(failureRate * 100).toFixed(1)}%)，建议检查API稳定性`
      );
    }

    if (metrics.p95Latency > 30000) {
      suggestions.push(
        `P95延迟较高 (${metrics.p95Latency}ms)，建议优化请求或增加超时时间`
      );
    }

    if (metrics.averageLatency > 10000) {
      suggestions.push(
        `平均延迟较高 (${metrics.averageLatency}ms)，可能需要缓存或批处理`
      );
    }

    if (metrics.totalCost > 100) {
      suggestions.push(
        `成本较高 ($${metrics.totalCost.toFixed(2)})，建议优化token使用`
      );
    }

    return suggestions;
  }
}
