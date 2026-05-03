// @ts-nocheck
/**
 * OpenTelemetry 指标系统
 * 基于CC源码实现，提供OTel指标支持
 */

import { metrics, Meter, Counter, Histogram, UpDownCounter, ObservableGauge } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter, View, Aggregation } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { logForDebugging } from '../../utils/debug.js';
import { errorMessage } from '../../utils/errors.js';
import { getPlatform, getWslVersion } from '../../utils/platform.js';

/**
 * 指标配置
 */
export interface OTelMetricsConfig {
  serviceName: string;
  serviceVersion: string;
  exportInterval?: number;
  enabled?: boolean;
}

/**
 * 指标记录器
 */
export class OTelMetrics {
  private meter: Meter;
  private counters: Map<string, Counter> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private upDownCounters: Map<string, UpDownCounter> = new Map();
  private observableGauges: Map<string, ObservableGauge> = new Map();
  private config: OTelMetricsConfig;

  /**
   * 构造函数
   * @param config 指标配置
   */
  constructor(config: OTelMetricsConfig) {
    this.config = {
      serviceName: 'py-app',
      serviceVersion: '1.0.0',
      exportInterval: 60000,
      enabled: true,
      ...config,
    };

    this.meter = metrics.getMeter(this.config.serviceName, this.config.serviceVersion);
  }

  /**
   * 创建计数器
   * @param name 计数器名称
   * @param description 描述
   * @returns 计数器
   */
  createCounter(name: string, description?: string): Counter {
    const key = `${name}_counter`;
    if (this.counters.has(key)) {
      return this.counters.get(key)!;
    }

    const counter = this.meter.createCounter(name, {
      description: description || `Counter for ${name}`,
    });

    this.counters.set(key, counter);
    return counter;
  }

  /**
   * 增加计数器
   * @param name 计数器名称
   * @param value 增加值
   * @param attributes 属性
   */
  incrementCounter(name: string, value: number = 1, attributes?: Record<string, string | number | boolean>): void {
    const counter = this.createCounter(name);
    counter.add(value, attributes);
  }

  /**
   * 创建直方图
   * @param name 直方图名称
   * @param description 描述
   * @returns 直方图
   */
  createHistogram(name: string, description?: string): Histogram {
    const key = `${name}_histogram`;
    if (this.histograms.has(key)) {
      return this.histograms.get(key)!;
    }

    const histogram = this.meter.createHistogram(name, {
      description: description || `Histogram for ${name}`,
    });

    this.histograms.set(key, histogram);
    return histogram;
  }

  /**
   * 记录直方图值
   * @param name 直方图名称
   * @param value 值
   * @param attributes 属性
   */
  recordHistogram(name: string, value: number, attributes?: Record<string, string | number | boolean>): void {
    const histogram = this.createHistogram(name);
    histogram.record(value, attributes);
  }

  /**
   * 创建可上下调整的计数器
   * @param name 计数器名称
   * @param description 描述
   * @returns 计数器
   */
  createUpDownCounter(name: string, description?: string): UpDownCounter {
    const key = `${name}_updowncounter`;
    if (this.upDownCounters.has(key)) {
      return this.upDownCounters.get(key)!;
    }

    const counter = this.meter.createUpDownCounter(name, {
      description: description || `UpDownCounter for ${name}`,
    });

    this.upDownCounters.set(key, counter);
    return counter;
  }

  /**
   * 增加可上下调整的计数器
   * @param name 计数器名称
   * @param value 增加值
   * @param attributes 属性
   */
  addUpDownCounter(name: string, value: number, attributes?: Record<string, string | number | boolean>): void {
    const counter = this.createUpDownCounter(name);
    counter.add(value, attributes);
  }

  /**
   * 创建可观察的Gauge
   * @param name Gauge名称
   * @param description 描述
   * @param callback 回调函数
   * @returns Gauge
   */
  createObservableGauge(
    name: string,
    description?: string,
    callback?: (observableResult: any) => void
  ): ObservableGauge {
    const key = `${name}_gauge`;
    if (this.observableGauges.has(key)) {
      return this.observableGauges.get(key)!;
    }

    const gauge = this.meter.createObservableGauge(name, {
      description: description || `ObservableGauge for ${name}`,
    }, callback);

    this.observableGauges.set(key, gauge);
    return gauge;
  }

  /**
   * 获取所有计数器
   * @returns 计数器映射
   */
  getCounters(): Map<string, Counter> {
    return new Map(this.counters);
  }

  /**
   * 获取所有直方图
   * @returns 直方图映射
   */
  getHistograms(): Map<string, Histogram> {
    return new Map(this.histograms);
  }

  /**
   * 获取所有可上下调整的计数器
   * @returns 计数器映射
   */
  getUpDownCounters(): Map<string, UpDownCounter> {
    return new Map(this.upDownCounters);
  }

  /**
   * 获取所有可观察的Gauge
   * @returns Gauge映射
   */
  getObservableGauges(): Map<string, ObservableGauge> {
    return new Map(this.observableGauges);
  }
}

/**
 * 全局指标记录器实例
 */
let otelMetrics: OTelMetrics | null = null;

/**
 * 获取指标记录器实例
 * @param config 指标配置
 * @returns 指标记录器实例
 */
export function getOTelMetrics(config?: OTelMetricsConfig): OTelMetrics {
  if (!otelMetrics) {
    otelMetrics = new OTelMetrics(config || {
      serviceName: 'py-app',
      serviceVersion: '1.0.0',
    });
  }
  return otelMetrics;
}

/**
 * 创建指标记录器实例
 * @param config 指标配置
 * @returns 指标记录器实例
 */
export function createOTelMetrics(config: OTelMetricsConfig): OTelMetrics {
  return new OTelMetrics(config);
}
