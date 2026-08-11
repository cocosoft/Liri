/**
 * OTel Metrics 成本数据接入桥
 * 将成本追踪数据转换为 OTel Metrics 格式，生成 Dashboard 数据
 */
import type { TokenUsage } from './types';
import { metrics } from '@opentelemetry/api';
import type { ObservableGauge } from '@opentelemetry/api';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { recordBackgroundTask } from '@modules/monitoring/BackgroundTaskEvent';

const logger = new Logger({
  module: 'cost:metrics-bridge',
  level: LogLevel.WARN,
});

/**
 * Metrics 数据类型
 */
export interface CostMetricsDataPoint {
  name: string;
  value: number;
  unit: string;
  labels: Record<string, string>;
  timestamp: number;
}

/**
 * Dashboard 数据
 */
export interface CostDashboardData {
  totalCost: number;
  costByModel: Array<{ model: string; cost: number }>;
  costByHour: Array<{ hour: string; cost: number }>;
  costByDay: Array<{ day: string; cost: number }>;
  tokenUsage: {
    inputTotal: number;
    outputTotal: number;
    cacheTotal: number;
    reasoningTotal: number;
  };
  requestCount: number;
  avgCostPerRequest: number;
  generatedAt: number;
}

/**
 * Metrics 桥配置
 */
export interface MetricsBridgeConfig {
  enabled: boolean;
  flushIntervalMs: number;
  maxDataPoints: number;
  exportFormat: 'json' | 'prometheus' | 'otlp';
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: MetricsBridgeConfig = {
  enabled: true,
  flushIntervalMs: 30_000,
  maxDataPoints: 1000,
  exportFormat: 'json',
};

/**
 * 成本记录（用于桥接）
 */
interface CostRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  costUSD: number;
  timestamp: number;
}

/**
 * OTel Metrics 成本数据桥
 */
export class CostMetricsBridge {
  private records: CostRecord[] = [];
  private dataPoints: CostMetricsDataPoint[] = [];
  private config: MetricsBridgeConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private onFlushCallback: ((data: CostDashboardData) => void) | null = null;
  private otelInitialized = false;
  private costGauge: ObservableGauge | null = null;
  private tokenGauge: ObservableGauge | null = null;

  constructor(config?: Partial<MetricsBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * P1-2.5: 注册 OTel ObservableGauge，将成本数据纳入 OTel 导出
   * 在 MeterProvider 初始化后调用（失败时不抛异常）
   */
  init(): void {
    if (this.otelInitialized) return;

    try {
      const meter = metrics.getMeter('liri-cost');

      this.costGauge = meter.createObservableGauge('Liri.cost.total', {
        description: '累计成本 (USD)',
        unit: 'USD',
      });
      this.costGauge.addCallback((result) => {
        try {
          const totalCost = this.records.reduce((sum, r) => sum + r.costUSD, 0);
          result.observe(totalCost, { currency: 'USD' });
        } catch {
          // @ignore-catch: metric observe fallback
          result.observe(0, { currency: 'USD' });
        }
      });

      this.tokenGauge = meter.createObservableGauge('Liri.tokens.total', {
        description: '累计 Token 消耗',
        unit: 'tokens',
      });
      this.tokenGauge.addCallback((result) => {
        try {
          const totalInput = this.records.reduce(
            (sum, r) => sum + r.inputTokens,
            0
          );
          const totalOutput = this.records.reduce(
            (sum, r) => sum + r.outputTokens,
            0
          );
          result.observe(totalInput, { type: 'input' });
          result.observe(totalOutput, { type: 'output' });
        } catch {
          // @ignore-catch: metric observe fallback
          result.observe(0, { type: 'input' });
          result.observe(0, { type: 'output' });
        }
      });

      this.otelInitialized = true;
      logger.info('CostMetricsBridge OTel 指标注册完成');
    } catch (err) {
      void handleError(err, { module: 'cost:metrics', action: 'register' });
    }
  }

  /**
   * 记录单次 API 调用
   * @param model 模型名
   * @param usage Token 使用量
   * @param costUSD 成本
   */
  record(model: string, usage: TokenUsage, costUSD: number): void {
    const record: CostRecord = {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadInputTokens || 0,
      cacheCreationTokens: usage.cacheCreationInputTokens || 0,
      reasoningTokens: usage.reasoningTokens || 0,
      costUSD,
      timestamp: Date.now(),
    };

    this.records.push(record);

    if (this.records.length > this.config.maxDataPoints) {
      this.records = this.records.slice(-this.config.maxDataPoints);
    }
  }

  /**
   * 生成 Metrics 数据点列表（OTel 兼容格式）
   */
  generateMetrics(): CostMetricsDataPoint[] {
    const now = Date.now();
    const points: CostMetricsDataPoint[] = [];

    const totalCost = this.records.reduce((sum, r) => sum + r.costUSD, 0);
    const totalInput = this.records.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutput = this.records.reduce(
      (sum, r) => sum + r.outputTokens,
      0
    );
    const totalCache = this.records.reduce(
      (sum, r) => sum + r.cacheReadTokens + r.cacheCreationTokens,
      0
    );
    const totalReasoning = this.records.reduce(
      (sum, r) => sum + r.reasoningTokens,
      0
    );

    const costByModel: Record<string, number> = {};
    for (const r of this.records) {
      costByModel[r.model] = (costByModel[r.model] || 0) + r.costUSD;
    }

    points.push({
      name: 'Liri.cost.total',
      value: totalCost,
      unit: 'USD',
      labels: { type: 'cumulative' },
      timestamp: now,
    });

    points.push({
      name: 'Liri.tokens.input',
      value: totalInput,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'Liri.tokens.output',
      value: totalOutput,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'Liri.tokens.cache',
      value: totalCache,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'Liri.tokens.reasoning',
      value: totalReasoning,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'Liri.requests.total',
      value: this.records.length,
      unit: 'requests',
      labels: {},
      timestamp: now,
    });

    for (const [model, cost] of Object.entries(costByModel)) {
      points.push({
        name: 'Liri.cost.by_model',
        value: cost,
        unit: 'USD',
        labels: { model },
        timestamp: now,
      });
    }

    this.dataPoints = points;

    return points;
  }

  /**
   * 生成 Dashboard 数据
   */
  generateDashboard(): CostDashboardData {
    const totalCost = this.records.reduce((sum, r) => sum + r.costUSD, 0);
    const requestCount = this.records.length;

    const costByModel: Record<string, number> = {};
    const costByHour: Record<string, number> = {};
    const costByDay: Record<string, number> = {};

    for (const r of this.records) {
      costByModel[r.model] = (costByModel[r.model] || 0) + r.costUSD;

      const hourKey = new Date(r.timestamp).toISOString().slice(0, 13) + ':00';
      costByHour[hourKey] = (costByHour[hourKey] || 0) + r.costUSD;

      const dayKey = new Date(r.timestamp).toISOString().slice(0, 10);
      costByDay[dayKey] = (costByDay[dayKey] || 0) + r.costUSD;
    }

    return {
      totalCost,
      costByModel: Object.entries(costByModel)
        .map(([model, cost]) => ({ model, cost }))
        .sort((a, b) => b.cost - a.cost),
      costByHour: Object.entries(costByHour)
        .map(([hour, cost]) => ({ hour, cost }))
        .sort((a, b) => a.hour.localeCompare(b.hour)),
      costByDay: Object.entries(costByDay)
        .map(([day, cost]) => ({ day, cost }))
        .sort((a, b) => b.day.localeCompare(a.day)),
      tokenUsage: {
        inputTotal: this.records.reduce((s, r) => s + r.inputTokens, 0),
        outputTotal: this.records.reduce((s, r) => s + r.outputTokens, 0),
        cacheTotal: this.records.reduce(
          (s, r) => s + r.cacheReadTokens + r.cacheCreationTokens,
          0
        ),
        reasoningTotal: this.records.reduce((s, r) => s + r.reasoningTokens, 0),
      },
      requestCount,
      avgCostPerRequest: requestCount > 0 ? totalCost / requestCount : 0,
      generatedAt: Date.now(),
    };
  }

  /**
   * 获取 Prometheus 格式的 Metrics
   */
  exportPrometheus(): string {
    const data = this.generateDashboard();
    const lines: string[] = [];

    lines.push(`# HELP Liri_cost_total Total API cost in USD`);
    lines.push(`# TYPE Liri_cost_total gauge`);
    lines.push(`Liri_cost_total ${data.totalCost.toFixed(6)}`);

    lines.push(`# HELP Liri_token_input_total Total input tokens`);
    lines.push(`# TYPE Liri_token_input_total counter`);
    lines.push(`Liri_token_input_total ${data.tokenUsage.inputTotal}`);

    lines.push(`# HELP Liri_token_output_total Total output tokens`);
    lines.push(`# TYPE Liri_token_output_total counter`);
    lines.push(`Liri_token_output_total ${data.tokenUsage.outputTotal}`);

    lines.push(`# HELP Liri_requests_total Total API requests`);
    lines.push(`# TYPE Liri_requests_total counter`);
    lines.push(`Liri_requests_total ${data.requestCount}`);

    return lines.join('\n');
  }

  /**
   * 设置数据刷新回调
   * @param callback 回调函数
   */
  onFlush(callback: (data: CostDashboardData) => void): void {
    this.onFlushCallback = callback;
  }

  /**
   * 启动定时刷新
   * §9.3 统一后台任务事件：每次 flush 记录 start/complete/fail（R08-002 配套，供运行状况面板聚合）
   */
  startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      const startedAt = Date.now();
      recordBackgroundTask({
        task: 'cost-flush',
        phase: 'start',
        startedAt,
      });
      try {
        const data = this.generateDashboard();

        if (this.onFlushCallback) {
          this.onFlushCallback(data);
        }
        recordBackgroundTask({
          task: 'cost-flush',
          phase: 'complete',
          startedAt,
          endedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          status: `records:${this.getRecordCount()}`,
          metadata: { recordCount: this.getRecordCount() },
        });
      } catch (err) {
        recordBackgroundTask({
          task: 'cost-flush',
          phase: 'fail',
          startedAt,
          endedAt: Date.now(),
          durationMs: Date.now() - startedAt,
          status: err instanceof Error ? err.message : String(err),
        });
      }
    }, this.config.flushIntervalMs);
  }

  /**
   * 停止定时刷新
   */
  stopAutoFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * 获取记录总数
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.records = [];
    this.dataPoints = [];
  }
}

/**
 * 全局 Metrics 桥实例
 */
let globalBridge: CostMetricsBridge | null = null;

/**
 * 获取全局成本 Metrics 桥
 */
export function getCostMetricsBridge(): CostMetricsBridge {
  if (!globalBridge) {
    globalBridge = new CostMetricsBridge();
  }

  return globalBridge;
}
