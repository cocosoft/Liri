/**
 * AI调用追踪
 * 集成OpenTelemetry进行API调用追踪和指标采集
 */

import { TelemetryConfig, APIUsageMetrics, AITraceData, SpanContext, TraceEvent } from './types';

const DEFAULT_CONFIG: TelemetryConfig = {
  enabled: true,
  samplingRate: 0.1,      // 10%采样率
  exportMetrics: true,
  exportTraces: true,
};

export class AITelemetry {
  private config: TelemetryConfig;
  private metrics: APIUsageMetrics[] = [];
  private traces: AITraceData[] = [];
  private isInitialized = false;

  constructor(config: Partial<TelemetryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化遥测系统
   */
  initialize(): void {
    if (this.isInitialized) {
      return;
    }

    // 尝试加载OpenTelemetry
    try {
      // 这里可以添加OpenTelemetry的初始化逻辑
      // 由于不使用第三方库，我们使用内置的追踪机制
      this.isInitialized = true;
      console.debug('AITelemetry initialized');
    } catch (error) {
      console.warn('Failed to initialize OpenTelemetry:', error);
      this.config.enabled = false;
    }
  }

  /**
   * 检查是否应该采样
   */
  private shouldSample(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return Math.random() < this.config.samplingRate;
  }

  /**
   * 生成追踪ID
   */
  private generateTraceId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  /**
   * 生成Span ID
   */
  private generateSpanId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  /**
   * 创建新的追踪Span
   */
  createSpan(requestType: string, model: string): AITraceData {
    if (!this.shouldSample()) {
      return {
        spanContext: {
          traceId: 'unsampled',
          spanId: 'unsampled',
          isSampled: false,
        },
        startTime: Date.now(),
        attributes: { requestType, model },
        events: [],
      };
    }

    const spanContext: SpanContext = {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      isSampled: true,
    };

    const traceData: AITraceData = {
      spanContext,
      startTime: Date.now(),
      attributes: {
        requestType,
        model,
        timestamp: Date.now(),
      },
      events: [],
    };

    this.traces.push(traceData);
    return traceData;
  }

  /**
   * 向Span添加事件
   */
  addEvent(spanContext: SpanContext, eventName: string, attributes?: Record<string, any>): void {
    if (!spanContext.isSampled) {
      return;
    }

    const trace = this.traces.find(t => 
      t.spanContext.traceId === spanContext.traceId && 
      t.spanContext.spanId === spanContext.spanId
    );

    if (trace) {
      const event: TraceEvent = {
        name: eventName,
        timestamp: Date.now(),
        attributes,
      };
      trace.events.push(event);
    }
  }

  /**
   * 结束Span并记录指标
   */
  endSpan(
    spanContext: SpanContext,
    metrics: Omit<APIUsageMetrics, 'requestId' | 'timestamp'>
  ): void {
    if (!spanContext.isSampled) {
      return;
    }

    const trace = this.traces.find(t => 
      t.spanContext.traceId === spanContext.traceId && 
      t.spanContext.spanId === spanContext.spanId
    );

    if (trace) {
      trace.endTime = Date.now();
      
      // 计算延迟
      const latency = trace.endTime - trace.startTime;

      // 记录指标
      const apiMetrics: APIUsageMetrics = {
        ...metrics,
        requestId: spanContext.traceId,
        latency,
        timestamp: Date.now(),
      };

      this.metrics.push(apiMetrics);
    }
  }

  /**
   * 记录API调用指标
   */
  recordMetrics(metrics: APIUsageMetrics): void {
    if (!this.config.enabled || !this.config.exportMetrics) {
      return;
    }

    this.metrics.push(metrics);
  }

  /**
   * 获取最近的指标数据
   */
  getRecentMetrics(count: number = 100): APIUsageMetrics[] {
    return this.metrics.slice(-count);
  }

  /**
   * 导出指标数据（Prometheus格式）
   */
  exportMetrics(): string {
    const lines: string[] = [];

    // 按模型分组统计
    const modelStats = this.metrics.reduce((acc, m) => {
      if (!acc[m.model]) {
        acc[m.model] = {
          count: 0,
          totalLatency: 0,
          totalTokens: 0,
          errorCount: 0,
        };
      }
      acc[m.model].count++;
      acc[m.model].totalLatency += m.latency;
      acc[m.model].totalTokens += m.totalTokens;
      if (m.error) {
        acc[m.model].errorCount++;
      }
      return acc;
    }, {} as Record<string, { count: number; totalLatency: number; totalTokens: number; errorCount: number }>);

    for (const [model, stats] of Object.entries(modelStats)) {
      const modelLabel = `model="${model}"`;
      lines.push(`ai_requests_total{${modelLabel}} ${stats.count}`);
      lines.push(`ai_latency_seconds{${modelLabel}} ${stats.totalLatency / 1000}`);
      lines.push(`ai_tokens_total{${modelLabel}} ${stats.totalTokens}`);
      lines.push(`ai_errors_total{${modelLabel}} ${stats.errorCount}`);
    }

    return lines.join('\n');
  }

  /**
   * 导出追踪数据
   */
  exportTraces(): AITraceData[] {
    if (!this.config.exportTraces) {
      return [];
    }
    return [...this.traces];
  }

  /**
   * 清除历史数据
   */
  clear(): void {
    this.metrics = [];
    this.traces = [];
  }

  /**
   * 获取配置
   */
  getConfig(): TelemetryConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TelemetryConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 创建全局遥测实例
 */
export const aiTelemetry = new AITelemetry();