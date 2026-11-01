/**
 * API 日志增强服务
 *
 * 增强 API 调用的日志记录，追踪请求/响应元数据、
 * 延迟、Token 使用量和错误信息。
 */

export interface ApiLogEntry {
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  tokenUsage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  provider: string;
  model: string;
  error?: string;
  retryCount?: number;
  timestamp: Date;
}

export interface ApiLogStats {
  totalRequests: number;
  totalErrors: number;
  totalLatencyMs: number;
  totalTokens: { input: number; output: number };
  byProvider: Record<string, number>;
  byStatus: Record<string, number>;
}

export class ApiLoggingService {
  private entries: ApiLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  logRequest(entry: ApiLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getRecentEntries(limit: number = 100): ApiLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  getStats(): ApiLogStats {
    const stats: ApiLogStats = {
      totalRequests: 0,
      totalErrors: 0,
      totalLatencyMs: 0,
      totalTokens: { input: 0, output: 0 },
      byProvider: {},
      byStatus: {},
    };

    for (const entry of this.entries) {
      stats.totalRequests++;
      stats.totalLatencyMs += entry.latencyMs;
      stats.totalTokens.input += entry.tokenUsage?.input || 0;
      stats.totalTokens.output += entry.tokenUsage?.output || 0;

      stats.byProvider[entry.provider] =
        (stats.byProvider[entry.provider] || 0) + 1;

      const statusGroup = `${Math.floor(entry.statusCode / 100)}xx`;
      stats.byStatus[statusGroup] = (stats.byStatus[statusGroup] || 0) + 1;

      if (entry.error) {
        stats.totalErrors++;
      }
    }

    return stats;
  }

  getErrors(limit: number = 50): ApiLogEntry[] {
    return this.entries
      .filter((e) => e.error)
      .slice(-limit)
      .reverse();
  }

  getAvgLatency(): number {
    if (this.entries.length === 0) return 0;
    return (
      this.entries.reduce((sum, e) => sum + e.latencyMs, 0) /
      this.entries.length
    );
  }

  clear(): void {
    this.entries = [];
  }
}

export const apiLoggingService = new ApiLoggingService();
