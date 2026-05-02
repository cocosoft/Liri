/**
 * Memory性能监控工具
 * 提供记忆存储性能指标收集、统计分析
 */

export interface MemoryStoreMetrics {
  totalMemories: number;
  totalSize: number;
  averageMemorySize: number;
  byType: Record<string, number>;
  byTags: Record<string, number>;
  lastOperation: Date | null;
  operationsCount: number;
  averageOperationTime: number;
}

export interface MemoryOperationRecord {
  timestamp: Date;
  operation: 'create' | 'read' | 'update' | 'delete' | 'search';
  memoryId?: string;
  success: boolean;
  duration: number;
  error?: string;
  resultCount?: number;
}

/**
 * Memory性能监控器
 */
export class MemoryPerformanceMonitor {
  private operationRecords: MemoryOperationRecord[] = [];
  private static instance: MemoryPerformanceMonitor;
  private readonly maxRecords = 10000;
  private lastOperationTime: number = Date.now();

  private constructor() {}

  static getInstance(): MemoryPerformanceMonitor {
    if (!MemoryPerformanceMonitor.instance) {
      MemoryPerformanceMonitor.instance = new MemoryPerformanceMonitor();
    }
    return MemoryPerformanceMonitor.instance;
  }

  /**
   * 记录操作
   */
  recordOperation(record: Omit<MemoryOperationRecord, 'timestamp'>): void {
    const fullRecord: MemoryOperationRecord = {
      ...record,
      timestamp: new Date(),
    };

    this.operationRecords.push(fullRecord);
    this.lastOperationTime = Date.now();

    if (this.operationRecords.length > this.maxRecords) {
      this.operationRecords.shift();
    }
  }

  /**
   * 获取操作记录
   */
  getOperationRecords(
    timeWindowMs?: number,
    limit?: number
  ): MemoryOperationRecord[] {
    let records = this.operationRecords;

    if (timeWindowMs) {
      const cutoffTime = new Date(Date.now() - timeWindowMs);
      records = records.filter((r) => r.timestamp >= cutoffTime);
    }

    if (limit) {
      return records.slice(-limit);
    }

    return records;
  }

  /**
   * 获取操作统计
   */
  getOperationStats(timeWindowMs?: number): {
    totalOperations: number;
    byOperation: Record<string, number>;
    successRate: number;
    averageOperationTime: number;
    operationsPerSecond: number;
  } {
    const records = timeWindowMs
      ? this.getOperationRecords(timeWindowMs)
      : this.operationRecords;

    if (records.length === 0) {
      return {
        totalOperations: 0,
        byOperation: {},
        successRate: 0,
        averageOperationTime: 0,
        operationsPerSecond: 0,
      };
    }

    const byOperation: Record<string, number> = {};
    let successCount = 0;
    let totalDuration = 0;

    for (const record of records) {
      byOperation[record.operation] = (byOperation[record.operation] || 0) + 1;
      if (record.success) successCount++;
      totalDuration += record.duration;
    }

    const timeRange =
      records.length > 1
        ? records[records.length - 1].timestamp.getTime() -
          records[0].timestamp.getTime()
        : 1;
    const operationsPerSecond = (records.length / timeRange) * 1000;

    return {
      totalOperations: records.length,
      byOperation,
      successRate: successCount / records.length,
      averageOperationTime: totalDuration / records.length,
      operationsPerSecond,
    };
  }

  /**
   * 获取搜索效率统计
   */
  getSearchStats(timeWindowMs?: number): {
    totalSearches: number;
    averageResults: number;
    averageSearchTime: number;
    searchesWithNoResults: number;
  } {
    const records = this.getOperationRecords(timeWindowMs).filter(
      (r) => r.operation === 'search'
    );

    if (records.length === 0) {
      return {
        totalSearches: 0,
        averageResults: 0,
        averageSearchTime: 0,
        searchesWithNoResults: 0,
      };
    }

    let totalResults = 0;
    let totalDuration = 0;
    let noResultsCount = 0;

    for (const record of records) {
      totalResults += record.resultCount || 0;
      totalDuration += record.duration;
      if (!record.resultCount || record.resultCount === 0) {
        noResultsCount++;
      }
    }

    return {
      totalSearches: records.length,
      averageResults: totalResults / records.length,
      averageSearchTime: totalDuration / records.length,
      searchesWithNoResults: noResultsCount,
    };
  }

  /**
   * 获取慢操作
   */
  getSlowOperations(
    count: number = 10,
    thresholdMs: number = 100
  ): MemoryOperationRecord[] {
    return this.operationRecords
      .filter((r) => r.duration >= thresholdMs)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, count);
  }

  /**
   * 获取操作成功率
   */
  getSuccessRate(timeWindowMs?: number): number {
    const records = this.getOperationRecords(timeWindowMs);
    if (records.length === 0) return 0;

    const successCount = records.filter((r) => r.success).length;
    return successCount / records.length;
  }

  /**
   * 获取最近的操作趋势
   */
  getOperationTrend(
    timeWindowMs: number = 60000,
    bucketCount: number = 10
  ): Array<{
    timestamp: Date;
    operations: number;
    successRate: number;
  }> {
    const now = Date.now();
    const bucketSize = timeWindowMs / bucketCount;
    const buckets: Array<{
      startTime: number;
      operations: number;
      success: number;
    }> = [];

    for (let i = 0; i < bucketCount; i++) {
      buckets.push({
        startTime: now - (bucketCount - i) * bucketSize,
        operations: 0,
        success: 0,
      });
    }

    const cutoffTime = new Date(now - timeWindowMs);
    for (const record of this.operationRecords) {
      if (record.timestamp >= cutoffTime) {
        const bucketIndex = Math.floor(
          (record.timestamp.getTime() - buckets[0].startTime) / bucketSize
        );
        if (bucketIndex >= 0 && bucketIndex < buckets.length) {
          buckets[bucketIndex].operations++;
          if (record.success) {
            buckets[bucketIndex].success++;
          }
        }
      }
    }

    return buckets.map((b) => ({
      timestamp: new Date(b.startTime),
      operations: b.operations,
      successRate: b.operations > 0 ? b.success / b.operations : 0,
    }));
  }

  /**
   * 清空记录
   */
  clear(): void {
    this.operationRecords = [];
  }

  /**
   * 获取性能优化建议
   */
  getOptimizationSuggestions(): string[] {
    const suggestions: string[] = [];
    const recentRecords = this.getOperationRecords(300000);

    if (recentRecords.length === 0) {
      return suggestions;
    }

    const searchRecords = recentRecords.filter((r) => r.operation === 'search');
    if (searchRecords.length > 0) {
      const avgSearchTime =
        searchRecords.reduce((sum, r) => sum + r.duration, 0) /
        searchRecords.length;
      if (avgSearchTime > 100) {
        suggestions.push(
          `搜索平均耗时较高 (${avgSearchTime.toFixed(1)}ms)，建议优化索引`
        );
      }
    }

    const successRate = this.getSuccessRate(300000);
    if (successRate < 0.95) {
      suggestions.push(
        `操作成功率偏低 (${(successRate * 100).toFixed(1)}%)，建议检查存储系统`
      );
    }

    const slowOps = this.getSlowOperations(5, 200);
    if (slowOps.length > 0) {
      const slowest = slowOps[0];
      suggestions.push(
        `发现慢操作: ${slowest.operation} 耗时 ${slowest.duration}ms`
      );
    }

    return suggestions;
  }
}
