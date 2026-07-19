/**
 * 会话追踪系统
 */

import {
  trace,
  Span,
  SpanStatusCode,
  context,
  Context,
} from '@opentelemetry/api';
import { AsyncLocalStorage } from 'async_hooks';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'monitoring\tracing\SessionTracing',
  level: LogLevel.INFO,
});

/**
 * Span类型
 */
export type SpanType =
  | 'interaction'
  | 'llm_request'
  | 'tool'
  | 'tool.blocked_on_user'
  | 'tool.execution'
  | 'hook';

/**
 * Span上下文
 */
export interface SpanContext {
  span: Span;
  startTime: number;
  attributes: Record<string, string | number | boolean>;
  ended?: boolean;
}

/**
 * 会话追踪配置
 */
export interface SessionTracingConfig {
  enabled: boolean;
  serviceName: string;
  serviceVersion: string;
  maxSpans: number;
  spanTTL: number; // Span存活时间（毫秒）
}

/**
 * 会话追踪系统
 */
export class SessionTracing {
  private config: SessionTracingConfig;
  private interactionContext: AsyncLocalStorage<SpanContext | undefined>;
  private toolContext: AsyncLocalStorage<SpanContext | undefined>;
  private activeSpans: Map<string, SpanContext>;
  private interactionSequence: number;
  private cleanupInterval: NodeJS.Timeout | null;

  /**
   * 构造函数
   * @param config 配置
   */
  constructor(config?: Partial<SessionTracingConfig>) {
    this.config = {
      enabled: true,
      serviceName: 'py-app',
      serviceVersion: '1.0.0',
      maxSpans: 1000,
      spanTTL: 30 * 60 * 1000, // 30分钟
      ...config,
    };

    this.interactionContext = new AsyncLocalStorage<SpanContext | undefined>();
    this.toolContext = new AsyncLocalStorage<SpanContext | undefined>();
    this.activeSpans = new Map();
    this.interactionSequence = 0;
    this.cleanupInterval = null;

    // 启动清理定时器
    this.startCleanup();
  }

  /**
   * 获取Tracer
   * @returns Tracer
   */
  private getTracer() {
    return trace.getTracer(this.config.serviceName, this.config.serviceVersion);
  }

  /**
   * 获取Span ID
   * @param span Span
   * @returns Span ID
   */
  private getSpanId(span: Span): string {
    return span.spanContext().spanId || '';
  }

  /**
   * 创建Span属性
   * @param spanType Span类型
   * @param customAttributes 自定义属性
   * @returns Span属性
   */
  private createSpanAttributes(
    spanType: SpanType,
    customAttributes: Record<string, string | number | boolean> = {}
  ): Record<string, string | number | boolean> {
    return {
      'span.type': spanType,
      'service.name': this.config.serviceName,
      'service.version': this.config.serviceVersion,
      ...customAttributes,
    };
  }

  /**
   * 启动清理定时器
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleSpans();
    }, 60000); // 每分钟清理一次

    // 防止定时器阻止进程退出
    if (typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  /**
   * 清理过期的Span
   */
  private cleanupStaleSpans(): void {
    const cutoff = Date.now() - this.config.spanTTL;
    for (const [spanId, spanContext] of this.activeSpans) {
      if (spanContext.startTime < cutoff) {
        if (!spanContext.ended) {
          spanContext.span.end();
        }
        this.activeSpans.delete(spanId);
      }
    }
  }

  /**
   * 开始交互Span
   * @param userPrompt 用户提示
   * @returns Span
   */
  startInteractionSpan(userPrompt: string): Span {
    if (!this.config.enabled) {
      return trace.getActiveSpan() || this.getTracer().startSpan('dummy');
    }

    this.interactionSequence++;

    const attributes = this.createSpanAttributes('interaction', {
      user_prompt: userPrompt,
      user_prompt_length: userPrompt.length,
      'interaction.sequence': this.interactionSequence,
    });

    const tracer = this.getTracer();
    const span = tracer.startSpan('Liri.interaction', {
      attributes,
    });

    const spanId = this.getSpanId(span);
    const spanContext: SpanContext = {
      span,
      startTime: Date.now(),
      attributes,
    };

    this.activeSpans.set(spanId, spanContext);
    this.interactionContext.enterWith(spanContext);

    return span;
  }

  /**
   * 结束交互Span
   */
  endInteractionSpan(): void {
    const spanContext = this.interactionContext.getStore();
    if (!spanContext) {
      return;
    }

    if (spanContext.ended) {
      return;
    }

    const duration = Date.now() - spanContext.startTime;
    spanContext.span.setAttributes({
      'interaction.duration_ms': duration,
    });

    spanContext.span.end();
    spanContext.ended = true;

    const spanId = this.getSpanId(spanContext.span);
    this.activeSpans.delete(spanId);
    this.interactionContext.enterWith(undefined);
  }

  /**
   * 开始LLM请求Span
   * @param model 模型名称
   * @param options 选项
   * @returns Span
   */
  startLLMRequestSpan(
    model: string,
    options?: {
      querySource?: string;
      fastMode?: boolean;
    }
  ): Span {
    if (!this.config.enabled) {
      return trace.getActiveSpan() || this.getTracer().startSpan('dummy');
    }

    const parentSpanCtx = this.interactionContext.getStore();

    const attributes = this.createSpanAttributes('llm_request', {
      model: model,
      'llm_request.context': parentSpanCtx ? 'interaction' : 'standalone',
      speed: options?.fastMode ? 'fast' : 'normal',
    });

    if (options?.querySource) {
      attributes['query_source'] = options.querySource;
    }

    const tracer = this.getTracer();
    const ctx = parentSpanCtx
      ? trace.setSpan(context.active(), parentSpanCtx.span)
      : context.active();

    const span = tracer.startSpan('Liri.llm_request', { attributes }, ctx);

    const spanId = this.getSpanId(span);
    const spanContext: SpanContext = {
      span,
      startTime: Date.now(),
      attributes,
    };

    this.activeSpans.set(spanId, spanContext);

    return span;
  }

  /**
   * 结束LLM请求Span
   * @param span Span
   * @param metadata 元数据
   */
  endLLMRequestSpan(
    span: Span,
    metadata?: {
      inputTokens?: number;
      outputTokens?: number;
      success?: boolean;
      error?: string;
      ttftMs?: number;
    }
  ): void {
    const spanId = this.getSpanId(span);
    const spanContext = this.activeSpans.get(spanId);

    if (!spanContext) {
      return;
    }

    if (spanContext.ended) {
      return;
    }

    const duration = Date.now() - spanContext.startTime;
    span.setAttributes({
      'llm_request.duration_ms': duration,
    });

    if (metadata) {
      if (metadata.inputTokens !== undefined) {
        span.setAttribute('llm_request.input_tokens', metadata.inputTokens);
      }
      if (metadata.outputTokens !== undefined) {
        span.setAttribute('llm_request.output_tokens', metadata.outputTokens);
      }
      if (metadata.success !== undefined) {
        span.setAttribute('llm_request.success', metadata.success);
      }
      if (metadata.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: metadata.error,
        });
      }
      if (metadata.ttftMs !== undefined) {
        span.setAttribute('llm_request.ttft_ms', metadata.ttftMs);
      }
    }

    span.end();
    spanContext.ended = true;
    this.activeSpans.delete(spanId);
  }

  /**
   * 开始工具Span
   * @param toolName 工具名称
   * @param options 选项
   * @returns Span
   */
  startToolSpan(
    toolName: string,
    options?: {
      blockedOnUser?: boolean;
      execution?: boolean;
    }
  ): Span {
    if (!this.config.enabled) {
      return trace.getActiveSpan() || this.getTracer().startSpan('dummy');
    }

    const spanType: SpanType = options?.blockedOnUser
      ? 'tool.blocked_on_user'
      : options?.execution
        ? 'tool.execution'
        : 'tool';

    const parentSpanCtx = this.interactionContext.getStore();

    const attributes = this.createSpanAttributes(spanType, {
      tool_name: toolName,
    });

    const tracer = this.getTracer();
    const ctx = parentSpanCtx
      ? trace.setSpan(context.active(), parentSpanCtx.span)
      : context.active();

    const span = tracer.startSpan('Liri.tool', { attributes }, ctx);

    const spanId = this.getSpanId(span);
    const spanContext: SpanContext = {
      span,
      startTime: Date.now(),
      attributes,
    };

    this.activeSpans.set(spanId, spanContext);
    this.toolContext.enterWith(spanContext);

    return span;
  }

  /**
   * 结束工具Span
   * @param span Span
   * @param metadata 元数据
   */
  endToolSpan(
    span: Span,
    metadata?: {
      success?: boolean;
      error?: string;
    }
  ): void {
    const spanId = this.getSpanId(span);
    const spanContext = this.activeSpans.get(spanId);

    if (!spanContext) {
      return;
    }

    if (spanContext.ended) {
      return;
    }

    const duration = Date.now() - spanContext.startTime;
    span.setAttributes({
      'tool.duration_ms': duration,
    });

    if (metadata) {
      if (metadata.success !== undefined) {
        span.setAttribute('tool.success', metadata.success);
      }
      if (metadata.error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: metadata.error,
        });
      }
    }

    span.end();
    spanContext.ended = true;
    this.activeSpans.delete(spanId);
    this.toolContext.enterWith(undefined);
  }

  /**
   * 获取活跃的Span
   * @returns 活跃的Span映射
   */
  getActiveSpans(): Map<string, SpanContext> {
    return new Map(this.activeSpans);
  }

  /**
   * 获取活跃的交互Span
   * @returns 活跃的交互Span
   */
  getActiveInteractionSpan(): Span | undefined {
    return this.interactionContext.getStore()?.span;
  }

  /**
   * 获取活跃的工具Span
   * @returns 活跃的工具Span
   */
  getActiveToolSpan(): Span | undefined {
    return this.toolContext.getStore()?.span;
  }

  /**
   * 停止追踪系统
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // 结束所有活跃的Span
    for (const [spanId, spanContext] of this.activeSpans) {
      if (!spanContext.ended) {
        spanContext.span.end();
      }
    }
    this.activeSpans.clear();
  }
}

/**
 * 全局会话追踪实例
 */
let sessionTracing: SessionTracing | null = null;

/**
 * 获取会话追踪实例
 * @param config 配置
 * @returns 会话追踪实例
 */
export function getSessionTracing(
  config?: Partial<SessionTracingConfig>
): SessionTracing {
  if (!sessionTracing) {
    sessionTracing = new SessionTracing(config);
  }
  return sessionTracing;
}

/**
 * 创建会话追踪实例
 * @param config 配置
 * @returns 会话追踪实例
 */
export function createSessionTracing(
  config?: Partial<SessionTracingConfig>
): SessionTracing {
  return new SessionTracing(config);
}
