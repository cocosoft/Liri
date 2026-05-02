/**
 * Mini Agent 性能指标收集器
 */

export interface MiniAgentMetrics {
  totalRequests: number;
  handledRequests: number;
  bypassedRequests: number;
  routeDistribution: {
    rule_engine: number;
    ollama: number;
    cloud: number;
  };
  averageLatencyMs: number;
  totalLatencyMs: number;
  errors: number;
  cacheHitRate: number;
}

export interface MetricEntry {
  timestamp: number;
  routeTarget: string;
  latencyMs: number;
  success: boolean;
  inputLength: number;
  outputLength?: number;
}

export class MetricsCollector {
  private metrics: MiniAgentMetrics = {
    totalRequests: 0,
    handledRequests: 0,
    bypassedRequests: 0,
    routeDistribution: {
      rule_engine: 0,
      ollama: 0,
      cloud: 0,
    },
    averageLatencyMs: 0,
    totalLatencyMs: 0,
    errors: 0,
    cacheHitRate: 0,
  };

  private entries: MetricEntry[] = [];
  private maxEntries: number = 1000;

  recordRequest(
    routeTarget: string,
    latencyMs: number,
    success: boolean,
    inputLength: number,
    outputLength?: number,
    bypassed: boolean = false
  ): void {
    const entry: MetricEntry = {
      timestamp: Date.now(),
      routeTarget,
      latencyMs,
      success,
      inputLength,
      outputLength,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.metrics.totalRequests++;

    if (bypassed) {
      this.metrics.bypassedRequests++;
    } else {
      this.metrics.handledRequests++;
    }

    if (routeTarget in this.metrics.routeDistribution) {
      this.metrics.routeDistribution[routeTarget as keyof typeof this.metrics.routeDistribution]++;
    }

    this.metrics.totalLatencyMs += latencyMs;
    this.metrics.averageLatencyMs = this.metrics.totalLatencyMs / this.metrics.totalRequests;

    if (!success) {
      this.metrics.errors++;
    }
  }

  recordCacheHit(): void {
    const total = this.metrics.handledRequests;
    if (total > 0) {
      const currentHits = this.metrics.cacheHitRate * (total - 1);
      this.metrics.cacheHitRate = (currentHits + 1) / total;
    }
  }

  recordCacheMiss(): void {
    const total = this.metrics.handledRequests;
    if (total > 0) {
      const currentHits = this.metrics.cacheHitRate * (total - 1);
      this.metrics.cacheHitRate = currentHits / total;
    }
  }

  getMetrics(): MiniAgentMetrics {
    return { ...this.metrics };
  }

  getRecentEntries(count: number = 10): MetricEntry[] {
    return this.entries.slice(-count);
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0,
      handledRequests: 0,
      bypassedRequests: 0,
      routeDistribution: {
        rule_engine: 0,
        ollama: 0,
        cloud: 0,
      },
      averageLatencyMs: 0,
      totalLatencyMs: 0,
      errors: 0,
      cacheHitRate: 0,
    };
    this.entries = [];
  }

  getRouteEfficiency(): Record<string, number> {
    const total = this.metrics.totalRequests;
    if (total === 0) return {};

    return {
      ruleEngineRate: this.metrics.routeDistribution.rule_engine / total,
      ollamaRate: this.metrics.routeDistribution.ollama / total,
      cloudRate: this.metrics.routeDistribution.cloud / total,
      bypassRate: this.metrics.bypassedRequests / total,
      errorRate: this.metrics.errors / total,
    };
  }
}

let globalMetricsCollector: MetricsCollector | null = null;

export function getGlobalMetricsCollector(): MetricsCollector {
  if (!globalMetricsCollector) {
    globalMetricsCollector = new MetricsCollector();
  }
  return globalMetricsCollector;
}

export function createMetricsCollector(): MetricsCollector {
  return new MetricsCollector();
}
