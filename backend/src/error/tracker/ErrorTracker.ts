import { AppError, ErrorCategory, ErrorSeverity } from '../types';
import { errorMonitor, ErrorStats } from '../monitor/ErrorMonitor';

export interface TrackedError {
  id: string;
  error: AppError;
  timestamp: number;
  context?: Record<string, any>;
  resolvedAt?: number;
  resolution?: string;
}

export interface ErrorSearchQuery {
  categories?: ErrorCategory[];
  severities?: ErrorSeverity[];
  timeRange?: { start: number; end: number };
  code?: string;
  resolved?: boolean;
  text?: string;
  limit?: number;
  offset?: number;
}

export interface ErrorTrend {
  period: string;
  count: number;
  categories: Record<string, number>;
  severities: Record<string, number>;
}

export interface ErrorAnalysis {
  totalTracked: number;
  resolved: number;
  unresolved: number;
  resolutionRate: number;
  topCategories: Array<{ category: string; count: number }>;
  topCodes: Array<{ code: string; count: number }>;
  trends: ErrorTrend[];
  avgResolutionTime: number;
}

export class ErrorTracker {
  private errors: Map<string, TrackedError> = new Map();
  private maxStorage: number = 10000;

  setMaxStorage(max: number): void {
    this.maxStorage = max;
  }

  track(error: AppError, context?: Record<string, any>): string {
    const id = `track_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tracked: TrackedError = {
      id,
      error,
      timestamp: Date.now(),
      context,
    };
    this.errors.set(id, tracked);
    errorMonitor.recordError(error);

    if (this.errors.size > this.maxStorage) {
      const oldest = [...this.errors.entries()]
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)
        .slice(0, this.errors.size - this.maxStorage);
      for (const [key] of oldest) {
        this.errors.delete(key);
      }
    }

    return id;
  }

  resolve(id: string, resolution: string): boolean {
    const tracked = this.errors.get(id);
    if (!tracked || tracked.resolvedAt) return false;
    tracked.resolvedAt = Date.now();
    tracked.resolution = resolution;
    return true;
  }

  get(id: string): TrackedError | undefined {
    return this.errors.get(id);
  }

  search(query: ErrorSearchQuery): TrackedError[] {
    let results = [...this.errors.values()];

    if (query.categories?.length) {
      results = results.filter((e) =>
        query.categories!.includes(e.error.category)
      );
    }
    if (query.severities?.length) {
      results = results.filter((e) =>
        query.severities!.includes(e.error.severity)
      );
    }
    if (query.timeRange) {
      results = results.filter(
        (e) =>
          e.timestamp >= query.timeRange!.start &&
          e.timestamp <= query.timeRange!.end
      );
    }
    if (query.code) {
      results = results.filter((e) => e.error.code === query.code);
    }
    if (query.resolved !== undefined) {
      results = results.filter((e) =>
        query.resolved ? e.resolvedAt !== undefined : e.resolvedAt === undefined
      );
    }
    if (query.text) {
      const lower = query.text.toLowerCase();
      results = results.filter(
        (e) =>
          e.error.message.toLowerCase().includes(lower) ||
          (e.error.code && e.error.code.toLowerCase().includes(lower))
      );
    }

    results.sort((a, b) => b.timestamp - a.timestamp);

    const offset = query.offset || 0;
    const limit = query.limit || 50;
    return results.slice(offset, offset + limit);
  }

  analyze(timeRange?: { start: number; end: number }): ErrorAnalysis {
    let relevant = [...this.errors.values()];
    if (timeRange) {
      relevant = relevant.filter(
        (e) => e.timestamp >= timeRange.start && e.timestamp <= timeRange.end
      );
    }

    const resolved = relevant.filter((e) => e.resolvedAt !== undefined);
    const categoryMap = new Map<string, number>();
    const codeMap = new Map<string, number>();
    let totalResolutionTime = 0;
    let resolutionCount = 0;

    for (const e of relevant) {
      const cat = e.error.category;
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);

      if (e.error.code) {
        codeMap.set(e.error.code, (codeMap.get(e.error.code) || 0) + 1);
      }

      if (e.resolvedAt) {
        totalResolutionTime += e.resolvedAt - e.timestamp;
        resolutionCount++;
      }
    }

    const trends = this.computeTrends(relevant);

    return {
      totalTracked: relevant.length,
      resolved: resolved.length,
      unresolved: relevant.length - resolved.length,
      resolutionRate:
        relevant.length > 0 ? resolved.length / relevant.length : 0,
      topCategories: [...categoryMap.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([category, count]) => ({ category, count })),
      topCodes: [...codeMap.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([code, count]) => ({ code, count })),
      trends,
      avgResolutionTime:
        resolutionCount > 0 ? totalResolutionTime / resolutionCount : 0,
    };
  }

  private computeTrends(errors: TrackedError[]): ErrorTrend[] {
    const periods = new Map<
      string,
      {
        count: number;
        categories: Map<string, number>;
        severities: Map<string, number>;
      }
    >();

    for (const e of errors) {
      const date = new Date(e.timestamp);
      const period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

      if (!periods.has(period)) {
        periods.set(period, {
          count: 0,
          categories: new Map(),
          severities: new Map(),
        });
      }
      const p = periods.get(period)!;
      p.count++;
      p.categories.set(
        e.error.category,
        (p.categories.get(e.error.category) || 0) + 1
      );
      p.severities.set(
        e.error.severity,
        (p.severities.get(e.error.severity) || 0) + 1
      );
    }

    return [...periods.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30)
      .map(([period, data]) => ({
        period,
        count: data.count,
        categories: Object.fromEntries(data.categories),
        severities: Object.fromEntries(data.severities),
      }));
  }

  getUnresolvedCount(): number {
    return [...this.errors.values()].filter((e) => !e.resolvedAt).length;
  }

  clear(): void {
    this.errors.clear();
  }
}

export const errorTracker = new ErrorTracker();
