/**
 * OTel Metrics 成本数据接入桥
 * 将成本追踪数据转换为 OTel Metrics 格式，生成 Dashboard 数据
 */
import type { TokenUsage } from './types';

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

  constructor(config?: Partial<MetricsBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
      name: 'py_app.cost.total',
      value: totalCost,
      unit: 'USD',
      labels: { type: 'cumulative' },
      timestamp: now,
    });

    points.push({
      name: 'py_app.tokens.input',
      value: totalInput,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'py_app.tokens.output',
      value: totalOutput,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'py_app.tokens.cache',
      value: totalCache,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'py_app.tokens.reasoning',
      value: totalReasoning,
      unit: 'tokens',
      labels: {},
      timestamp: now,
    });

    points.push({
      name: 'py_app.requests.total',
      value: this.records.length,
      unit: 'requests',
      labels: {},
      timestamp: now,
    });

    for (const [model, cost] of Object.entries(costByModel)) {
      points.push({
        name: 'py_app.cost.by_model',
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

    lines.push(`# HELP py_app_cost_total Total API cost in USD`);
    lines.push(`# TYPE py_app_cost_total gauge`);
    lines.push(`py_app_cost_total ${data.totalCost.toFixed(6)}`);

    lines.push(`# HELP py_app_token_input_total Total input tokens`);
    lines.push(`# TYPE py_app_token_input_total counter`);
    lines.push(`py_app_token_input_total ${data.tokenUsage.inputTotal}`);

    lines.push(`# HELP py_app_token_output_total Total output tokens`);
    lines.push(`# TYPE py_app_token_output_total counter`);
    lines.push(`py_app_token_output_total ${data.tokenUsage.outputTotal}`);

    lines.push(`# HELP py_app_requests_total Total API requests`);
    lines.push(`# TYPE py_app_requests_total counter`);
    lines.push(`py_app_requests_total ${data.requestCount}`);

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
   */
  startAutoFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      const data = this.generateDashboard();

      if (this.onFlushCallback) {
        this.onFlushCallback(data);
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
