import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
const logger = getLogger('cache:performance:CachePerformanceOptimizer');

export interface MemoryPool {
  id: string;
  maxSize: number;
  usedSize: number;
  itemCount: number;
}

export interface BatchOperation {
  type: 'get' | 'set' | 'delete';
  key: string;
  value?: unknown;
  ttl?: number;
}

export interface BatchResult {
  success: boolean;
  results: Array<{
    key: string;
    success: boolean;
    value?: unknown;
    error?: string;
  }>;
  totalDuration: number;
}

export interface OptimizationTargets {
  maxMemoryUsage: number;
  targetHitRate: number;
  maxAvgLatency: number;
}

export interface OptimizationResult {
  performed: boolean;
  actions: string[];
  freedBytes: number;
  duration: number;
}

export interface MemoryUsageReport {
  totalItems: number;
  totalSizeBytes: number;
  avgItemSizeBytes: number;
  poolCount: number;
  pools: MemoryPool[];
  estimatedBytesByStrategy: Record<string, number>;
  fragmentationRatio: number;
  recommendations: string[];
}

export interface ICachePerformanceOptimizer {
  getBatch(keys: string[]): Promise<Map<string, unknown>>;
  setBatch(
    entries: Array<{ key: string; value: unknown; ttl?: number }>
  ): Promise<number>;
  deleteBatch(keys: string[]): Promise<number>;
  executeBatch(operations: BatchOperation[]): Promise<BatchResult>;
  analyzeMemoryUsage(): MemoryUsageReport;
  optimize(force?: boolean): Promise<OptimizationResult>;
  getPerformanceMetrics(): PerformanceMetrics;
  setTargets(targets: Partial<OptimizationTargets>): void;
}

export interface PerformanceMetrics {
  hitRate: number;
  missRate: number;
  avgLatency: number;
  p99Latency: number;
  memoryUsage: number;
  throughput: number;
  itemCount: number;
  totalOperations: number;
}

interface OperationRecord {
  duration: number;
  success: boolean;
  timestamp: number;
}

export class CachePerformanceOptimizer implements ICachePerformanceOptimizer {
  private storage: Map<
    string,
    { value: unknown; timestamp: number; ttl?: number; size: number }
  > = new Map();
  private operationLog: OperationRecord[] = [];
  private maxOperationLogSize = 10000;
  private totalOperations = 0;
  private totalHits = 0;
  private totalMisses = 0;
  private totalLatency = 0;
  private latencies: number[] = [];
  private targets: OptimizationTargets = {
    maxMemoryUsage: 100 * 1024 * 1024,
    targetHitRate: 0.95,
    maxAvgLatency: 10,
  };
  private lastOptimizationTime = 0;
  private minOptimizationInterval = 60000;

  async getBatch(keys: string[]): Promise<Map<string, unknown>> {
    const start = Date.now();
    const results = new Map<string, unknown>();
    const latencies: number[] = [];

    for (const key of keys) {
      const opStart = Date.now();
      const entry = this.storage.get(key);
      if (entry && (!entry.ttl || entry.timestamp + entry.ttl > Date.now())) {
        results.set(key, entry.value);
        this.totalHits++;
      } else {
        if (entry) this.storage.delete(key);
        this.totalMisses++;
      }
      latencies.push(Date.now() - opStart);
    }

    this.totalLatency += Date.now() - start;
    this.latencies.push(...latencies);
    if (this.latencies.length > 10000)
      this.latencies = this.latencies.slice(-5000);

    return results;
  }

  async setBatch(
    entries: Array<{ key: string; value: unknown; ttl?: number }>
  ): Promise<number> {
    const start = Date.now();
    let successCount = 0;

    for (const entry of entries) {
      this.storage.set(entry.key, {
        value: entry.value,
        timestamp: Date.now(),
        ttl: entry.ttl,
        size: JSON.stringify(entry.value).length,
      });
      successCount++;
    }

    this.recordOperation(Date.now() - start, true);
    return successCount;
  }

  async deleteBatch(keys: string[]): Promise<number> {
    const start = Date.now();
    let count = 0;
    for (const key of keys) {
      if (this.storage.delete(key)) count++;
    }
    this.recordOperation(Date.now() - start, true);
    return count;
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult> {
    const start = Date.now();
    const results: BatchResult['results'] = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case 'get': {
            const entry = this.storage.get(op.key);
            const hit =
              entry && (!entry.ttl || entry.timestamp + entry.ttl > Date.now());
            results.push({
              key: op.key,
              success: !!hit,
              value: hit ? entry!.value : undefined,
            });
            if (hit) this.totalHits++;
            else this.totalMisses++;
            break;
          }
          case 'set':
            this.storage.set(op.key, {
              value: op.value,
              timestamp: Date.now(),
              ttl: op.ttl,
              size: JSON.stringify(op.value).length,
            });
            results.push({ key: op.key, success: true });
            break;
          case 'delete':
            results.push({ key: op.key, success: this.storage.delete(op.key) });
            break;
        }
      } catch (error) {
        void handleError(error, {
          module: 'cache:performance',
          action: 'executeBatch',
        });
        results.push({
          key: op.key,
          success: false,
          error: (error as Error).message,
        });
      }
    }

    return {
      success: results.every((r) => r.success),
      results,
      totalDuration: Date.now() - start,
    };
  }

  analyzeMemoryUsage(): MemoryUsageReport {
    let totalSize = 0;
    const strategySizes: Record<string, number> = {};
    let maxItemSize = 0;
    let minItemSize = Infinity;

    for (const [, entry] of this.storage) {
      totalSize += entry.size;
      maxItemSize = Math.max(maxItemSize, entry.size);
      minItemSize = Math.min(minItemSize, entry.size);
      const strategy = entry.ttl ? 'ttl' : 'permanent';
      strategySizes[strategy] = (strategySizes[strategy] || 0) + entry.size;
    }

    const avgItemSize =
      this.storage.size > 0 ? totalSize / this.storage.size : 0;
    const fragmentationRatio =
      maxItemSize > 0 && minItemSize < Infinity
        ? 1 - minItemSize / maxItemSize
        : 0;

    const recommendations: string[] = [];
    if (totalSize > this.targets.maxMemoryUsage * 0.8) {
      recommendations.push(
        'Memory usage exceeds 80% of target, consider increasing maxMemoryUsage or enabling stricter eviction'
      );
    }
    if (fragmentationRatio > 0.5) {
      recommendations.push(
        'High memory fragmentation detected, consider defragmentation'
      );
    }
    if (this.storage.size > 0 && avgItemSize < 50) {
      recommendations.push(
        'Many small items detected, consider batching for efficiency'
      );
    }

    const pool: MemoryPool = {
      id: 'default',
      maxSize: this.targets.maxMemoryUsage,
      usedSize: totalSize,
      itemCount: this.storage.size,
    };

    return {
      totalItems: this.storage.size,
      totalSizeBytes: totalSize,
      avgItemSizeBytes: Math.round(avgItemSize),
      poolCount: 1,
      pools: [pool],
      estimatedBytesByStrategy: strategySizes,
      fragmentationRatio: Math.round(fragmentationRatio * 100) / 100,
      recommendations,
    };
  }

  async optimize(force: boolean = false): Promise<OptimizationResult> {
    const now = Date.now();
    if (
      !force &&
      now - this.lastOptimizationTime < this.minOptimizationInterval
    ) {
      return { performed: false, actions: [], freedBytes: 0, duration: 0 };
    }

    const start = Date.now();
    const actions: string[] = [];
    let freedBytes = 0;

    const expiredKeys: string[] = [];
    for (const [key, entry] of this.storage) {
      if (entry.ttl && entry.timestamp + entry.ttl < now) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      const entry = this.storage.get(key);
      if (entry) freedBytes += entry.size;
      this.storage.delete(key);
    }
    if (expiredKeys.length > 0) {
      actions.push(
        `Removed ${expiredKeys.length} expired entries (freed ${freedBytes} bytes)`
      );
    }

    const opLogCount = this.operationLog.length;
    if (opLogCount > this.maxOperationLogSize) {
      this.operationLog = this.operationLog.slice(
        -Math.floor(this.maxOperationLogSize * 0.5)
      );
      actions.push(
        `Trimmed operation log: ${opLogCount} → ${this.operationLog.length}`
      );
    }

    const latCount = this.latencies.length;
    if (latCount > 5000) {
      this.latencies = this.latencies.slice(-2500);
      actions.push(
        `Trimmed latency samples: ${latCount} → ${this.latencies.length}`
      );
    }

    const report = this.analyzeMemoryUsage();
    if (report.totalSizeBytes > this.targets.maxMemoryUsage * 0.9) {
      const toRemove = Math.floor(this.storage.size * 0.2);
      const keys = [...this.storage.keys()].slice(0, toRemove);
      for (const key of keys) {
        const entry = this.storage.get(key);
        if (entry) freedBytes += entry.size;
        this.storage.delete(key);
      }
      actions.push(
        `Emergency eviction: removed ${toRemove} entries (freed ${report.totalSizeBytes > 0 ? freedBytes : 0} bytes)`
      );
    }

    this.lastOptimizationTime = now;
    return {
      performed: actions.length > 0,
      actions,
      freedBytes,
      duration: Date.now() - start,
    };
  }

  getPerformanceMetrics(): PerformanceMetrics {
    const totalOps = this.totalHits + this.totalMisses;
    const hitRate = totalOps > 0 ? this.totalHits / totalOps : 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p99 =
      sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;
    const avgLat =
      this.totalOperations > 0 ? this.totalLatency / this.totalOperations : 0;

    return {
      hitRate,
      missRate: 1 - hitRate,
      avgLatency: Math.round(avgLat * 100) / 100,
      p99Latency: p99,
      memoryUsage: this.analyzeMemoryUsage().totalSizeBytes,
      throughput: 0,
      itemCount: this.storage.size,
      totalOperations: this.totalOperations,
    };
  }

  setTargets(targets: Partial<OptimizationTargets>): void {
    this.targets = { ...this.targets, ...targets };
  }

  private recordOperation(duration: number, success: boolean): void {
    this.totalOperations++;
    this.totalLatency += duration;
    this.latencies.push(duration);
    this.operationLog.push({ duration, success, timestamp: Date.now() });
    if (this.operationLog.length > this.maxOperationLogSize) {
      this.operationLog = this.operationLog.slice(
        -Math.floor(this.maxOperationLogSize * 0.5)
      );
    }
  }
}

export const cachePerformanceOptimizer = new CachePerformanceOptimizer();
