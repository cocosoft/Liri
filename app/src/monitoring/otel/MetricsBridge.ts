/**
 * 指标桥接器
 * 将自建 MetricsService 的指标同步映射到 OTel 标准指标的桥接层
 */

import { MetricsService } from '../metrics/MetricsService.js';
import { OTelMetrics } from './OTelMetrics.js';
import { errorMessage } from '@modules/error/utils';

export interface MetricsBridgeConfig {
  syncIntervalMs: number;
  enabled: boolean;
}

export interface MetricsBridgeStats {
  totalMetrics: number;
  bridgedMetrics: number;
  lastSyncTime: number;
  errors: string[];
}

export class MetricsBridge {
  private metricsService: MetricsService;
  private otelMetrics: OTelMetrics;
  private config: MetricsBridgeConfig;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private lastSyncTime = 0;
  private errors: string[] = [];

  constructor(
    metricsService: MetricsService,
    otelMetrics: OTelMetrics,
    config?: Partial<MetricsBridgeConfig>
  ) {
    this.metricsService = metricsService;
    this.otelMetrics = otelMetrics;
    this.config = {
      syncIntervalMs: 30000,
      enabled: true,
      ...config,
    };
  }

  start(): void {
    if (this.syncTimer || !this.config.enabled) return;

    this.syncOnce();
    this.syncTimer = setInterval(
      () => this.syncOnce(),
      this.config.syncIntervalMs
    );
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  getStats(): MetricsBridgeStats {
    const allMetrics = this.metricsService.getAllMetrics();
    return {
      totalMetrics: allMetrics.size,
      bridgedMetrics: this.countBridgedInstruments(),
      lastSyncTime: this.lastSyncTime,
      errors: [...this.errors],
    };
  }

  syncOnce(): void {
    try {
      const allMetrics = this.metricsService.getAllMetrics();
      for (const [key, metric] of allMetrics.entries()) {
        try {
          this.bridgeMetric(key, metric);
        } catch (err) {
          this.errors.push(`bridge metric ${key}: ${errorMessage(err)}`);
        }
      }
      this.lastSyncTime = Date.now();
    } catch (err) {
      this.errors.push(`syncOnce: ${errorMessage(err)}`);
    }
  }

  private countBridgedInstruments(): number {
    const allMetrics = this.metricsService.getAllMetrics();
    let count = 0;
    for (const [key, metric] of allMetrics.entries()) {
      if (this.hasInstrumentFor(key, metric)) count++;
    }
    return count;
  }

  private hasInstrumentFor(key: string, metric: unknown): boolean {
    const name = this.toOtelName(key);
    if (this.isSummary(metric)) {
      return false;
    }
    if (this.isCounter(metric)) {
      return this.otelMetrics.getCounters().has(name);
    }
    if (this.isGauge(metric)) {
      return this.otelMetrics.getUpDownCounters().has(name);
    }
    if (this.isHistogram(metric)) {
      return this.otelMetrics.getHistograms().has(name);
    }
    return false;
  }

  private bridgeMetric(key: string, metric: unknown): void {
    const name = this.toOtelName(key);

    if (this.isSummary(metric)) {
      return;
    }
    if (this.isCounter(metric)) {
      this.bridgeCounter(name, metric);
    } else if (this.isGauge(metric)) {
      this.bridgeGauge(name, metric);
    } else if (this.isHistogram(metric)) {
      this.bridgeHistogram(name, metric);
    }
  }

  private bridgeCounter(name: string, metric: { value: number }): void {
    const counters = this.otelMetrics.getCounters();
    if (!counters.has(name)) {
      counters.set(name, this.otelMetrics.createCounter(name));
    }
  }

  private bridgeGauge(name: string, metric: { value: number }): void {
    const gauges = this.otelMetrics.getUpDownCounters();
    if (!gauges.has(name)) {
      gauges.set(name, this.otelMetrics.createUpDownCounter(name));
    }
  }

  private bridgeHistogram(
    name: string,
    metric: { count: number; sum: number }
  ): void {
    const histograms = this.otelMetrics.getHistograms();
    if (!histograms.has(name)) {
      histograms.set(name, this.otelMetrics.createHistogram(name));
    }
  }

  private isCounter(m: unknown): m is { value: number } {
    return (
      typeof m === 'object' &&
      m !== null &&
      'value' in m &&
      typeof (m as Record<string, unknown>).value === 'number' &&
      'inc' in m
    );
  }

  private isSummary(m: unknown): boolean {
    return (
      typeof m === 'object' &&
      m !== null &&
      'observe' in m &&
      'quantiles' in m &&
      typeof (m as Record<string, unknown>).observe === 'function'
    );
  }

  private isGauge(m: unknown): m is { value: number } {
    return (
      typeof m === 'object' &&
      m !== null &&
      'value' in m &&
      typeof (m as Record<string, unknown>).value === 'number' &&
      'set' in m &&
      'dec' in m
    );
  }

  private isHistogram(m: unknown): m is { count: number; sum: number } {
    return (
      typeof m === 'object' &&
      m !== null &&
      'count' in m &&
      'sum' in m &&
      typeof (m as Record<string, unknown>).count === 'number'
    );
  }

  private toOtelName(key: string): string {
    return key.replace(/[{}]/g, '_').replace(/[=,]/g, '_').toLowerCase();
  }
}

export function createMetricsBridge(
  metricsService: MetricsService,
  otelMetrics: OTelMetrics,
  config?: Partial<MetricsBridgeConfig>
): MetricsBridge {
  return new MetricsBridge(metricsService, otelMetrics, config);
}
