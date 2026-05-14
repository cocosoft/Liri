/**
 * ai-trace 模块共享类型定义
 */

/** 录制记录 - 一次完整的 API 调用追踪 */
export interface TraceRecord {
  /** 记录ID */
  id: string;
  /** 时间戳 ISO-8601 */
  timestamp: string;
  /** 轮次序号 */
  turn: number;
  /** 调用耗时（毫秒） */
  durationMs: number;
  /** 上游API基础URL */
  upstreamBaseUrl: string;
  /** 请求信息 */
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
  };
  /** 响应信息 */
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    /** SSE流式事件（仅流式请求） */
    sseEvents?: SSERawEvent[];
  };
  /** 错误信息（如有） */
  error?: string;
  /** 关联的 OpenTelemetry trace ID（集成模式） */
  traceId?: string;
  /** 关联的 OpenTelemetry span ID（集成模式） */
  spanId?: string;
}

/** SSE原始事件 */
export interface SSERawEvent {
  event: string;
  data: unknown;
}

/** 录制配置 */
export interface TraceConfig {
  /** 录制存储目录 */
  traceDir: string;
  /** 实时查看端口（0=禁用） */
  liveViewPort: number;
  /** 录制模式 */
  mode: 'all' | 'error-only' | 'slow-only';
  /** 慢查询阈值（ms） */
  slowThresholdMs: number;
}

/** 统计快照 */
export interface StatsSnapshot {
  /** 调用总次数 */
  totalCalls: number;
  /** 错误总数 */
  totalErrors: number;
  /** 各模型调用次数 */
  callsByModel: Record<string, number>;
  /** 各模型错误数 */
  errorsByModel: Record<string, number>;
  /** 各模型平均延迟（ms） */
  avgLatencyByModel: Record<string, number>;
  /** 总输入Token */
  totalInputTokens: number;
  /** 总输出Token */
  totalOutputTokens: number;
  /** 总缓存读取Token */
  totalCacheReadTokens: number;
  /** 总缓存创建Token */
  totalCacheCreateTokens: number;
  /** P50 延迟（ms） */
  latencyP50: number;
  /** P99 延迟（ms） */
  latencyP99: number;
}

/** 插件状态 */
export interface PluginStatus {
  /** 是否已启动 */
  running: boolean;
  /** 录制模式 */
  mode: TraceConfig['mode'];
  /** 已录制数 */
  recordedCount: number;
  /** 存储路径 */
  traceDir: string;
  /** 实时查看URL（如有） */
  liveViewUrl?: string;
}

/** 监控系统依赖（松耦合注入） */
export interface MonitoringDeps {
  dashboard?: { recordBatch: (dataPoints: { metric: string; value: number; labels?: Record<string, string> }[]) => void };
  tracing?: { getActiveSpan?: () => { spanContext: () => { traceId: string; spanId: string } } | undefined };
  alertManager?: { sendAlert?: (alert: { title: string; message: string; level: string; source: string }) => void };
}

/** 导出格式 */
export type ExportFormat = 'markdown' | 'json' | 'html';
