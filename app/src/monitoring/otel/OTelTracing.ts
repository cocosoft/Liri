//
/**
 * OpenTelemetry 追踪系统
 */

import {
  trace,
  Tracer,
  Span,
  SpanStatusCode,
  context,
  Context,
} from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { logForDebugging } from '@modules/utils/debug.js';
import { errorMessage } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('monitoring\otel\OTelTracing');

/**
 * 追踪配置
 */
export interface OTelTracingConfig {
  serviceName: string;
  serviceVersion: string;
  enabled?: boolean;
}

/**
 * 追踪包装器选项
 */
export interface TraceWrapperOptions {
  name: string;
  attributes?: Record<string, string | number | boolean>;
  parentSpan?: Span;
}

/**
 * OpenTelemetry追踪系统
 */
export class OTelTracing {
  private tracer: Tracer;
  private config: OTelTracingConfig;
  private activeSpans: Map<string, Span> = new Map();

  /**
   * 构造函数
   * @param config 追踪配置
   */
  constructor(config: OTelTracingConfig) {
    this.config = {
      enabled: true,
      ...config,
    };

    this.tracer = trace.getTracer(
      this.config.serviceName,
      this.config.serviceVersion
    );
  }

  /**
   * 开始一个Span
   * @param name Span名称
   * @param attributes Span属性
   * @param parentSpan 父Span（可选，用于建立父子关系）
   * @returns Span
   */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
    parentSpan?: Span
  ): Span {
    let span: Span;

    if (parentSpan) {
      // 通过 Context 建立父子关系
      const parentCtx = trace.setSpan(context.active(), parentSpan);
      span = this.tracer.startSpan(name, { attributes }, parentCtx);
    } else {
      span = this.tracer.startSpan(name, { attributes });
    }

    const spanId = span.spanContext().spanId;
    this.activeSpans.set(spanId, span);

    return span;
  }

  /**
   * 结束一个Span
   * @param span Span
   * @param status 状态
   * @param message 消息
   */
  endSpan(
    span: Span,
    status: SpanStatusCode = SpanStatusCode.OK,
    message?: string
  ): void {
    if (status === SpanStatusCode.ERROR && message) {
      span.setStatus({ code: status, message });
    } else {
      span.setStatus({ code: status });
    }

    span.end();

    const spanId = span.spanContext().spanId;
    this.activeSpans.delete(spanId);
  }

  /**
   * 记录Span事件
   * @param span Span
   * @param name 事件名称
   * @param attributes 事件属性
   */
  recordEvent(
    span: Span,
    name: string,
    attributes?: Record<string, string | number | boolean>
  ): void {
    span.addEvent(name, attributes);
  }

  /**
   * 记录Span错误
   * @param span Span
   * @param error 错误
   */
  recordError(span: Span, error: Error): void {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  /**
   * 获取当前活跃的Span
   * @returns 活跃的Span
   */
  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * 获取Tracer
   * @returns Tracer
   */
  getTracer(): Tracer {
    return this.tracer;
  }

  /**
   * 获取所有活跃的Span
   * @returns 活跃的Span映射
   */
  getActiveSpans(): Map<string, Span> {
    return new Map(this.activeSpans);
  }

  /**
   * 包装函数，自动创建和结束Span
   * @param options 选项
   * @param fn 要包装的函数
   * @returns 包装后的函数
   */
  wrap<T extends (...args: any[]) => any>(
    options: TraceWrapperOptions,
    fn: T
  ): (...args: Parameters<T>) => ReturnType<T> {
    return (...args: Parameters<T>): ReturnType<T> => {
      const span = this.startSpan(options.name, options.attributes);

      try {
        const result = fn(...args);

        if (result instanceof Promise) {
          return result
            .then((value) => {
              this.endSpan(span, SpanStatusCode.OK);
              return value;
            })
            .catch((error) => {
              this.recordError(
                span,
                error instanceof Error ? error : new Error(String(error))
              );
              this.endSpan(span, SpanStatusCode.ERROR);
              throw error;
            }) as ReturnType<T>;
        }

        this.endSpan(span, SpanStatusCode.OK);
        return result as Awaited<ReturnType<T>>;
      } catch (error) {
        this.recordError(
          span,
          error instanceof Error ? error : new Error(String(error))
        );
        this.endSpan(span, SpanStatusCode.ERROR);
        throw error;
      }
    };
  }

  /**
   * 异步包装函数，自动创建和结束Span
   * @param options 选项
   * @param fn 要包装的异步函数
   * @returns 包装后的异步函数
   */
  asyncWrap<T extends (...args: any[]) => Promise<unknown>>(
    options: TraceWrapperOptions,
    fn: T
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
      const span = this.startSpan(options.name, options.attributes);

      try {
        const result = await fn(...args);
        this.endSpan(span, SpanStatusCode.OK);
        return result as Awaited<ReturnType<T>>;
      } catch (error) {
        this.recordError(
          span,
          error instanceof Error ? error : new Error(String(error))
        );
        this.endSpan(span, SpanStatusCode.ERROR);
        throw error;
      }
    };
  }
}

/**
 * 全局追踪实例
 */
let otelTracing: OTelTracing | null = null;

/**
 * 获取追踪实例
 * @param config 追踪配置
 * @returns 追踪实例
 */
export function getOTelTracing(config?: OTelTracingConfig): OTelTracing {
  if (!otelTracing) {
    otelTracing = new OTelTracing(
      config || {
        serviceName: 'py-app',
        serviceVersion: '1.0.0',
      }
    );
  }
  return otelTracing;
}

/**
 * 创建追踪实例
 * @param config 追踪配置
 * @returns 追踪实例
 */
export function createOTelTracing(config: OTelTracingConfig): OTelTracing {
  return new OTelTracing(config);
}
