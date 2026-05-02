/**
 * 指标系统
 * 实现性能指标记录和监控
 */

/**
 * 指标类型
 */
export enum MetricType {
  /**
   * 计数器
   */
  COUNTER = 'counter',
  /**
   *  gauge
   */
  GAUGE = 'gauge',
  /**
   * 直方图
   */
  HISTOGRAM = 'histogram',
  /**
   * 摘要
   */
  SUMMARY = 'summary',
}

/**
 * 指标配置
 */
export interface MetricConfig {
  /**
   * 指标名称
   */
  name: string;
  /**
   * 指标类型
   */
  type: MetricType;
  /**
   * 指标描述
   */
  description?: string;
  /**
   * 指标标签
   */
  labels?: Record<string, string>;
}

/**
 * 计数器指标
 */
export interface CounterMetric {
  /**
   * 当前值
   */
  value: number;
  /**
   * 增加计数
   * @param value 增加的值
   */
  inc(value?: number): void;
  /**
   * 获取当前值
   * @returns 当前值
   */
  get(): number;
}

/**
 * Gauge指标
 */
export interface GaugeMetric {
  /**
   * 当前值
   */
  value: number;
  /**
   * 设置值
   * @param value 值
   */
  set(value: number): void;
  /**
   * 增加值
   * @param value 增加的值
   */
  inc(value?: number): void;
  /**
   * 减少值
   * @param value 减少的值
   */
  dec(value?: number): void;
  /**
   * 获取当前值
   * @returns 当前值
   */
  get(): number;
}

/**
 * 直方图指标
 */
export interface HistogramMetric {
  /**
   * 计数
   */
  count: number;
  /**
   * 总和
   */
  sum: number;
  /**
   * 桶
   */
  buckets: Record<string, number>;
  /**
   * 记录值
   * @param value 值
   */
  observe(value: number): void;
  /**
   * 获取统计数据
   * @returns 统计数据
   */
  get(): {
    count: number;
    sum: number;
    buckets: Record<string, number>;
  };
}

/**
 * 摘要指标
 */
export interface SummaryMetric {
  /**
   * 计数
   */
  count: number;
  /**
   * 总和
   */
  sum: number;
  /**
   * 分位数
   */
  quantiles: Record<string, number>;
  /**
   * 记录值
   * @param value 值
   */
  observe(value: number): void;
  /**
   * 获取统计数据
   * @returns 统计数据
   */
  get(): {
    count: number;
    sum: number;
    quantiles: Record<string, number>;
  };
}

/**
 * 指标服务类
 */
export class MetricsService {
  /**
   * 指标存储
   */
  private metrics: Map<string, any> = new Map();

  /**
   * 创建计数器指标
   * @param config 指标配置
   * @returns 计数器指标
   */
  createCounter(config: Omit<MetricConfig, 'type'>): CounterMetric {
    const key = this.generateMetricKey(config);
    const metric: CounterMetric = {
      value: 0,
      inc: (value = 1) => {
        metric.value += value;
      },
      get: () => metric.value,
    };

    this.metrics.set(key, metric);
    return metric;
  }

  /**
   * 创建Gauge指标
   * @param config 指标配置
   * @returns Gauge指标
   */
  createGauge(config: Omit<MetricConfig, 'type'>): GaugeMetric {
    const key = this.generateMetricKey(config);
    const metric: GaugeMetric = {
      value: 0,
      set: (value) => {
        metric.value = value;
      },
      inc: (value = 1) => {
        metric.value += value;
      },
      dec: (value = 1) => {
        metric.value -= value;
      },
      get: () => metric.value,
    };

    this.metrics.set(key, metric);
    return metric;
  }

  /**
   * 创建直方图指标
   * @param config 指标配置
   * @returns 直方图指标
   */
  createHistogram(config: Omit<MetricConfig, 'type'>): HistogramMetric {
    const key = this.generateMetricKey(config);
    const metric: HistogramMetric = {
      count: 0,
      sum: 0,
      buckets: {
        '0.1': 0,
        '0.5': 0,
        '1': 0,
        '5': 0,
        '10': 0,
        '30': 0,
        '60': 0,
        '300': 0,
        '600': 0,
      },
      observe: (value) => {
        metric.count++;
        metric.sum += value;

        // 更新 buckets
        for (const [bucket, count] of Object.entries(metric.buckets)) {
          if (value <= parseFloat(bucket)) {
            metric.buckets[bucket] = count + 1;
          }
        }
      },
      get: () => ({
        count: metric.count,
        sum: metric.sum,
        buckets: { ...metric.buckets },
      }),
    };

    this.metrics.set(key, metric);
    return metric;
  }

  /**
   * 创建摘要指标
   * @param config 指标配置
   * @returns 摘要指标
   */
  createSummary(config: Omit<MetricConfig, 'type'>): SummaryMetric {
    const key = this.generateMetricKey(config);
    const values: number[] = [];
    const metric: SummaryMetric = {
      count: 0,
      sum: 0,
      quantiles: {},
      observe: (value) => {
        values.push(value);
        metric.count = values.length;
        metric.sum = values.reduce((acc, val) => acc + val, 0);
        // 更新分位数
        if (metric.count > 0) {
          const sortedValues = [...values].sort((a, b) => a - b);
          metric.quantiles = {
            '0.5': sortedValues[Math.floor(metric.count * 0.5)],
            '0.9': sortedValues[Math.floor(metric.count * 0.9)],
            '0.99': sortedValues[Math.floor(metric.count * 0.99)],
          };
        }
      },
      get: () => {
        if (values.length === 0) {
          return {
            count: 0,
            sum: 0,
            quantiles: {
              '0.5': 0,
              '0.9': 0,
              '0.99': 0,
            },
          };
        }

        const sortedValues = [...values].sort((a, b) => a - b);
        const count = sortedValues.length;
        const sum = sortedValues.reduce((acc, val) => acc + val, 0);

        return {
          count,
          sum,
          quantiles: {
            '0.5': sortedValues[Math.floor(count * 0.5)],
            '0.9': sortedValues[Math.floor(count * 0.9)],
            '0.99': sortedValues[Math.floor(count * 0.99)],
          },
        };
      },
    };

    this.metrics.set(key, metric);
    return metric;
  }

  /**
   * 获取所有指标
   * @returns 所有指标
   */
  getAllMetrics(): Map<string, any> {
    return new Map(this.metrics);
  }

  /**
   * 获取指标
   * @param name 指标名称
   * @param labels 指标标签
   * @returns 指标
   */
  getMetric(name: string, labels?: Record<string, string>): any {
    const key = this.generateMetricKey({ name, labels: labels || {} });
    return this.metrics.get(key);
  }

  /**
   * 删除指标
   * @param name 指标名称
   * @param labels 指标标签
   * @returns 是否删除成功
   */
  deleteMetric(name: string, labels?: Record<string, string>): boolean {
    const key = this.generateMetricKey({ name, labels: labels || {} });
    return this.metrics.delete(key);
  }

  /**
   * 清空所有指标
   */
  clearMetrics(): void {
    this.metrics.clear();
  }

  /**
   * 生成指标键
   * @param config 指标配置
   * @returns 指标键
   */
  private generateMetricKey(config: {
    name: string;
    labels?: Record<string, string>;
  }): string {
    const labels = config.labels || {};
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    return `${config.name}${labelStr ? `{${labelStr}}` : ''}`;
  }

  /**
   * 导出指标
   * @returns 指标导出字符串
   */
  exportMetrics(): string {
    let output = '';

    for (const [key, metric] of this.metrics.entries()) {
      if (metric.get) {
        const value = metric.get();
        if (typeof value === 'number') {
          output += `${key} ${value}\n`;
        } else if (typeof value === 'object') {
          if (value.count !== undefined && value.sum !== undefined) {
            output += `${key}_count ${value.count}\n`;
            output += `${key}_sum ${value.sum}\n`;

            if (value.buckets) {
              for (const [bucket, count] of Object.entries(value.buckets)) {
                output += `${key}_bucket{le="${bucket}"} ${count}\n`;
              }
            }

            if (value.quantiles) {
              for (const [quantile, qValue] of Object.entries(
                value.quantiles
              )) {
                output += `${key}{quantile="${quantile}"} ${qValue}\n`;
              }
            }
          }
        }
      }
    }

    return output;
  }
}

/**
 * 指标服务实例
 */
let metricsService: MetricsService | undefined;

/**
 * 获取指标服务实例
 * @returns 指标服务实例
 */
export function getMetricsService(): MetricsService {
  if (!metricsService) {
    metricsService = new MetricsService();
  }
  return metricsService;
}

/**
 * 创建指标服务实例
 * @returns 指标服务实例
 */
export function createMetricsService(): MetricsService {
  return new MetricsService();
}
