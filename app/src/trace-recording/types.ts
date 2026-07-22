// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
  /** 是否启用（默认 true） */
  enabled?: boolean;
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
  dashboard?: {
    recordBatch: (
      dataPoints: {
        metric: string;
        value: number;
        labels?: Record<string, string>;
      }[]
    ) => void;
  };
  tracing?: {
    getActiveSpan?: () =>
      | { spanContext: () => { traceId: string; spanId: string } }
      | undefined;
  };
  alertManager?: {
    sendAlert?: (alert: {
      title: string;
      message: string;
      level: string;
      source: string;
    }) => void;
  };
}

/** 导出格式 */
export type ExportFormat = 'markdown' | 'json' | 'html';

/** P3-2.14: 数据脱敏配置 */
export interface SanitizeConfig {
  /** 脱敏 API Key（默认 true） */
  redactApiKeys: boolean;
  /** 脱敏 PII — 邮箱、手机号（默认 true） */
  redactPII: boolean;
  /** 额外脱敏路径模式 */
  redactPaths: string[];
}
