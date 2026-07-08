/**
 * Session-level Span 属性
 * 对标平安科技：增加自定义 Span 属性（model/agent/strategy），便于按代理策略分析性能
 */
import { createHash } from 'crypto';

/**
 * Span 属性键常量
 */
export const SPAN_ATTRIBUTE_KEYS = {
  MODEL: 'Liri.model',
  AGENT: 'Liri.agent',
  STRATEGY: 'Liri.strategy',
  SESSION_ID: 'Liri.session_id',
  REQUEST_ID: 'Liri.request_id',
  TOOL_COUNT: 'Liri.tool_count',
  INPUT_TOKENS: 'Liri.input_tokens',
  OUTPUT_TOKENS: 'Liri.output_tokens',
  CACHE_HIT: 'Liri.cache_hit',
  LATENCY_MS: 'Liri.latency_ms',
  CHANNEL: 'Liri.channel',
  PLATFORM: 'Liri.platform',
} as const;

/**
 * Span 上下文
 */
export interface SessionSpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  isSampled: boolean;
}

/**
 * Span 属性集
 */
export interface SessionSpanAttributes {
  model?: string;
  agent?: string;
  strategy?: string;
  sessionId?: string;
  requestId?: string;
  toolCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheHit?: boolean;
  latencyMs?: number;
  channel?: string;
  platform?: string;
}

/**
 * Span 记录
 */
export interface SpanRecord {
  context: SessionSpanContext;
  name: string;
  attributes: SessionSpanAttributes;
  startTime: number;
  endTime: number | null;
  status: 'ok' | 'error' | 'unset';
  statusMessage?: string;
  events: SpanEvent[];
}

/**
 * Span 事件
 */
export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number>;
}

/**
 * OTel Span 追踪器
 */
export class SessionSpanTracer {
  private spans: SpanRecord[] = [];
  private maxSpans: number;
  private activeSpans: Map<string, SpanRecord> = new Map();
  private spanCounter: number = 0;

  /**
   * 构造函数
   * @param maxSpans 最大 Span 数
   */
  constructor(maxSpans: number = 500) {
    this.maxSpans = maxSpans;
  }

  /**
   * 创建新的根 Span
   * @param name Span 名称
   * @param attributes 属性集
   * @returns Span 上下文
   */
  startSpan(
    name: string,
    attributes?: SessionSpanAttributes
  ): SessionSpanContext {
    this.spanCounter++;
    const traceId = this.generateId(32);
    const spanId = this.generateId(16);

    const context: SessionSpanContext = {
      traceId,
      spanId,
      isSampled: true,
    };

    const record: SpanRecord = {
      context,
      name,
      attributes: attributes || {},
      startTime: Date.now(),
      endTime: null,
      status: 'unset',
      events: [],
    };

    this.spans.push(record);
    this.activeSpans.set(spanId, record);
    this.trimSpans();

    return context;
  }

  /**
   * 创建子 Span
   * @param name Span 名称
   * @param parentContext 父上下文
   * @param attributes 属性集
   * @returns Span 上下文
   */
  startChildSpan(
    name: string,
    parentContext: SessionSpanContext,
    attributes?: SessionSpanAttributes
  ): SessionSpanContext {
    if (!parentContext.isSampled) {
      return { ...parentContext, spanId: 'unsampled', isSampled: false };
    }

    const context: SessionSpanContext = {
      traceId: parentContext.traceId,
      spanId: this.generateId(16),
      parentSpanId: parentContext.spanId,
      isSampled: true,
    };

    const record: SpanRecord = {
      context,
      name,
      attributes: attributes || {},
      startTime: Date.now(),
      endTime: null,
      status: 'unset',
      events: [],
    };

    this.spans.push(record);
    this.activeSpans.set(context.spanId, record);
    this.trimSpans();

    return context;
  }

  /**
   * 结束 Span
   * @param context Span 上下文
   * @param status 状态
   * @param message 状态消息
   */
  endSpan(
    context: SessionSpanContext,
    status: SpanRecord['status'] = 'ok',
    message?: string
  ): void {
    const span = this.activeSpans.get(context.spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = status;
    span.statusMessage = message;
    this.activeSpans.delete(context.spanId);
  }

  /**
   * 添加 Span 属性
   * @param context Span 上下文
   * @param key 属性键
   * @param value 属性值
   */
  setAttribute(
    context: SessionSpanContext,
    key: string,
    value: string | number | boolean
  ): void {
    const span = this.activeSpans.get(context.spanId);
    if (!span) return;

    (span.attributes as Record<string, string | number | boolean>)[key] = value;
  }

  /**
   * 添加 Span 事件
   * @param context Span 上下文
   * @param name 事件名
   * @param attributes 属性
   */
  addEvent(
    context: SessionSpanContext,
    name: string,
    attributes?: Record<string, string | number>
  ): void {
    const span = this.activeSpans.get(context.spanId);
    if (!span) return;

    span.events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * 获取所有 Span
   */
  getAllSpans(): SpanRecord[] {
    return [...this.spans];
  }

  /**
   * 按 traceId 获取相关 Span
   * @param traceId 追踪 ID
   */
  getTraceSpans(traceId: string): SpanRecord[] {
    return this.spans.filter((s) => s.context.traceId === traceId);
  }

  /**
   * 获取所有活跃 Span
   */
  getActiveSpans(): SpanRecord[] {
    return Array.from(this.activeSpans.values());
  }

  /**
   * 获取统计
   */
  getStats(): { total: number; active: number; ok: number; error: number } {
    const ok = this.spans.filter((s) => s.status === 'ok').length;
    const error = this.spans.filter((s) => s.status === 'error').length;

    return {
      total: this.spans.length,
      active: this.activeSpans.size,
      ok,
      error,
    };
  }

  /**
   * 裁剪 Span 数量
   */
  private trimSpans(): void {
    if (this.spans.length > this.maxSpans) {
      this.spans = this.spans.slice(-this.maxSpans);
    }
  }

  /**
   * 生成 ID
   * @param length 长度
   * @returns 十六进制 ID
   */
  private generateId(length: number): string {
    const hash = createHash('sha256');

    hash.update(`${Date.now()}_${Math.random()}_${this.spanCounter}`);

    return hash.digest('hex').slice(0, length);
  }

  /**
   * 清除所有 Span
   */
  clear(): void {
    this.spans = [];
    this.activeSpans.clear();
  }
}

/**
 * 全局 Span 追踪器
 */
let globalTracer: SessionSpanTracer | null = null;

/**
 * 获取全局 Session Span 追踪器
 */
export function getSessionSpanTracer(): SessionSpanTracer {
  if (!globalTracer) {
    globalTracer = new SessionSpanTracer();
  }

  return globalTracer;
}
