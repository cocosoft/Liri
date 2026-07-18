/**
 * OTelAwareLogger — OTel 上下文感知的日志包装器
 *
 * 包装基础 Logger，在每次写日志时自动从 trace.getActiveSpan()
 * 获取 traceId/spanId 并注入到日志输出中。
 * 不破坏现有 Logger，作为增强层使用。
 */

import { trace } from '@opentelemetry/api';
import { Logger, LogLevel } from './Logger.js';
import type { LoggerConfig } from './Logger.js';
import { getLogConfigManager } from './config/LogConfig.js';

export class OTelAwareLogger {
  private logger: Logger;

  constructor(config: LoggerConfig = {}) {
    this.logger = new Logger(config);
  }

  /** 获取当前 OTel Span 上下文 */
  private getOtelContext(): { traceId?: string; spanId?: string } {
    try {
      const config = getLogConfigManager().get();
      if (!config.otelTraceEnabled) return {};

      const span = trace.getActiveSpan();
      if (span) {
        const ctx = span.spanContext();
        if (ctx.traceId && ctx.spanId) {
          return { traceId: ctx.traceId, spanId: ctx.spanId };
        }
      }
    } catch (err) {

      // OTel 未初始化或 Span 不可用时静默降级

      console.debug("OTel context unavailable, silent degrade", { context: "OTel 未初始化或 Span 不可用时静默降级", error: err instanceof Error ? err.message : String(err) });

    }
    return {};
  }

  /** 将 OTel 上下文注入到 meta 数据中 */
  private injectContext(meta?: unknown): Record<string, unknown> | undefined {
    const ctx = this.getOtelContext();
    if (!ctx.traceId) return meta as Record<string, unknown> | undefined;

    if (meta === undefined) {
      return { traceId: ctx.traceId, spanId: ctx.spanId };
    }

    if (typeof meta === 'object' && meta !== null) {
      return {
        ...(meta as Record<string, unknown>),
        traceId: ctx.traceId,
        spanId: ctx.spanId,
      };
    }

    return { _meta: meta, traceId: ctx.traceId, spanId: ctx.spanId };
  }

  debug(message: string, meta?: unknown): void {
    this.logger.debug(message, this.injectContext(meta));
  }

  info(message: string, meta?: unknown): void {
    this.logger.info(message, this.injectContext(meta));
  }

  warn(message: string, meta?: unknown): void {
    this.logger.warn(message, this.injectContext(meta));
  }

  warning(message: string, meta?: unknown): void {
    this.logger.warning(message, this.injectContext(meta));
  }

  error(message: string, meta?: unknown): void {
    this.logger.error(message, this.injectContext(meta));
  }

  fatal(message: string, meta?: unknown): void {
    this.logger.fatal(message, this.injectContext(meta));
  }
}
