/**
 * AI遥测类型定义
 */

export interface APIUsageMetrics {
  requestId: string;
  model: string;
  latency: number; // 耗时(ms)
  promptTokens: number; // 输入Token数
  completionTokens: number; // 输出Token数
  totalTokens: number; // 总Token数
  error?: string; // 错误信息
  statusCode?: number; // HTTP状态码
  timestamp: number; // 时间戳
  requestType: string; // 请求类型
}

export interface TelemetryConfig {
  enabled: boolean;
  samplingRate: number; // 采样率 0-1
  exportMetrics: boolean; // 是否导出指标
  exportTraces: boolean; // 是否导出追踪
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  isSampled: boolean;
}

export interface AITraceData {
  spanContext: SpanContext;
  startTime: number;
  endTime?: number;
  attributes: Record<string, any>;
  events: TraceEvent[];
}

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, any>;
}
