/**
 * 前端 OpenTelemetry 追踪系统
 *
 * 基于 @opentelemetry/sdk-trace-web，提供：
 * - TracerProvider 自动初始化
 * - Span 创建/关闭/事件记录
 * - 错误自动追踪
 * - OTLP HTTP 导出（可选，默认 console 导出）
 */

import { trace, Span, SpanStatusCode, context } from "@opentelemetry/api";
import {
  WebTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-web";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-web";
import { SpanCollector } from "./SpanCollector";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

/** 简易日志器类型 */
interface SimpleLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface OTelTracingConfig {
  serviceName: string;
  serviceVersion: string;
  otlpEndpoint?: string;
  enabled?: boolean;
}

/** 简易日志器，避免循环依赖 */
let _logger: SimpleLogger = {
  info: (...args: unknown[]) => console.info("[otel]", ...args),
  warn: (...args: unknown[]) => console.warn("[otel]", ...args),
  error: (...args: unknown[]) => console.error("[otel]", ...args),
};

export function setOTelLogger(logger: SimpleLogger): void {
  _logger = logger;
}

/**
 * OpenTelemetry 前端追踪系统
 */
export class OTelTracing {
  private config: OTelTracingConfig;
  private initialized = false;
  private activeSpans: Map<string, Span> = new Map();

  constructor(config: OTelTracingConfig) {
    this.config = { enabled: true, ...config };
  }

  /** 初始化 TracerProvider */
  init(): void {
    if (this.initialized) return;
    if (!this.config.enabled) {
      _logger.info("OTel Tracing disabled");
      return;
    }

    try {
      const resource = resourceFromAttributes({
        [ATTR_SERVICE_NAME]: this.config.serviceName,
        [ATTR_SERVICE_VERSION]: this.config.serviceVersion,
      });

      const spanProcessors: SpanProcessor[] = [
        // 内存收集器：将 Span 存入环形缓冲区，供前端 UI 展示
        new SimpleSpanProcessor(new SpanCollector()),
      ];

      // OTLP HTTP exporter（可选）
      if (this.config.otlpEndpoint) {
        spanProcessors.push(
          new BatchSpanProcessor(
            new OTLPTraceExporter({ url: this.config.otlpEndpoint }),
          ),
        );
        _logger.info(`OTel OTLP exporter: ${this.config.otlpEndpoint}`);
      }

      const provider = new WebTracerProvider({
        resource,
        spanProcessors,
      });

      provider.register({
        contextManager: new ZoneContextManager(),
      });

      this.initialized = true;
      _logger.info("OTel Tracing initialized");
    } catch (err) {
      _logger.error("OTel Tracing init failed", err);
    }
  }

  /** 获取 Tracer */
  getTracer() {
    return trace.getTracer(this.config.serviceName, this.config.serviceVersion);
  }

  /** 开始一个 Span */
  startSpan(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): Span {
    const tracer = this.getTracer();
    const span = tracer.startSpan(name, { attributes });

    this.activeSpans.set(name, span);
    return span;
  }

  /** 结束一个 Span */
  endSpan(span: Span): void {
    try {
      span.end();
    } catch {
      // 忽略
    }
    for (const [key, s] of this.activeSpans) {
      if (s === span) {
        this.activeSpans.delete(key);
        break;
      }
    }
  }

  /** 在 Span 上记录错误 */
  recordError(span: Span, error: unknown): void {
    span.setStatus({ code: SpanStatusCode.ERROR });

    if (error instanceof Error) {
      span.recordException(error);
      span.setAttribute("error.message", error.message);
      span.setAttribute("error.type", error.name);
    } else if (typeof error === "string") {
      span.setAttribute("error.message", error);
    }
  }

  /** 包装异步函数：自动创建 Span 并结束 */
  async asyncWrap<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      return await context.with(trace.setSpan(context.active(), span), fn);
    } catch (err) {
      this.recordError(span, err);
      throw err;
    } finally {
      this.endSpan(span);
    }
  }

  /** 获取当前活跃的 Span */
  getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /** 获取全局 TraceId（用于关联日志） */
  getCurrentTraceId(): string | undefined {
    const span = trace.getActiveSpan();
    return span?.spanContext().traceId;
  }
}

/** 全局单例 */
let _instance: OTelTracing | null = null;

export function getOTelTracing(
  config?: Partial<OTelTracingConfig>,
): OTelTracing {
  if (!_instance) {
    _instance = new OTelTracing({
      serviceName: "liri-client",
      // 版本号唯一事实来源 /v1/app/info（后端 app/package.json），main.tsx 启动时注入
      serviceVersion: config?.serviceVersion || "0.0.0",
    });
  }
  return _instance;
}

export type { Span } from "@opentelemetry/api";
export { SpanStatusCode } from "@opentelemetry/api";
