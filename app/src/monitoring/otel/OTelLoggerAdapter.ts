/**
 * OTel 日志适配器
 * 自动感知 OTel Span 上下文，将 traceId/spanId 注入到日志条目中
 * 消除手动调用 startTrace() / nextSpan() 的负担
 */

import { trace } from '@opentelemetry/api';
import { LogLevel } from '../logs/Logger.js';
import { StructuredLogger } from '../logs/StructuredLogger.js';
import type { StructuredLogEntry } from '../logs/LogMemory.js';
import { logConfigManager } from '../logs/config/LogConfig.js';
import { OTelTracing } from './OTelTracing.js';

/** Span 计数器追踪映射（traceId → counter） */
const spanCounters = new Map<string, number>();

export interface OTelLoggerAdapterConfig {
  module: string;
  traceEnabled?: boolean;
  jsonOutput?: boolean;
}

export class OTelLoggerAdapter {
  private logger: StructuredLogger;
  private otelTracing: OTelTracing;
  private lastOTelTraceId: string | null = null;

  constructor(otelTracing: OTelTracing, config: OTelLoggerAdapterConfig) {
    this.otelTracing = otelTracing;
    this.logger = new StructuredLogger({
      module: config.module,
      traceEnabled: config.traceEnabled ?? true,
      jsonOutput: config.jsonOutput ?? true,
    });
  }

  get innerLogger(): StructuredLogger {
    return this.logger;
  }

  get otel(): OTelTracing {
    return this.otelTracing;
  }

  /** 获取当前活跃 Span 的上下文信息 */
  private getActiveSpanContext(): { traceId: string; spanId: string } | null {
    try {
      const activeSpan = this.otelTracing.getActiveSpan();
      if (activeSpan) {
        const ctx = activeSpan.spanContext();
        return { traceId: ctx.traceId, spanId: ctx.spanId };
      }

      const spanFromCtx = trace.getActiveSpan();
      if (spanFromCtx) {
        const ctx = spanFromCtx.spanContext();
        return { traceId: ctx.traceId, spanId: ctx.spanId };
      }

      return null;
    } catch {
      return null;
    }
  }

  /** 确保 logger 已激活指定 trace */
  private ensureTrace(traceId: string): void {
    if (this.logger.getTraceId() !== traceId) {
      this.logger.startTrace(traceId);
      this.lastOTelTraceId = traceId;
    }
  }

  /**
   * 记录结构化日志，自动注入 OTel 上下文
   * 根据 LogConfig 配置决定是否输出 trace 前缀和 token/cost 数据
   * @param level   日志级别
   * @param message 日志消息
   * @param data    附加数据
   * @param error   错误对象
   */
  structured(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    const logConfig = logConfigManager.get();

    // 根据配置决定是否注入 trace 上下文
    if (logConfig.otelTraceEnabled) {
      const spanCtx = this.getActiveSpanContext();
      if (spanCtx) {
        this.ensureTrace(spanCtx.traceId);
      } else if (
        this.lastOTelTraceId !== null &&
        this.logger.getTraceId() === this.lastOTelTraceId
      ) {
        this.resetTrace();
        this.lastOTelTraceId = null;
      }
    }

    // 根据配置决定是否过滤 token/cost 字段
    let filteredData = data;
    if (!logConfig.showTokenCost && data) {
      const {
        inputTokens, outputTokens, costUSD, costUsd,
        cacheReadTokens, cacheCreationTokens, cacheCreateTokens,
        reasoningTokens, totalCostUSD, totalCostUsd, totalInputTokens,
        totalOutputTokens, totalCachedInputTokens, totalReasoningTokens,
        totalCost, ...rest
      } = data as Record<string, unknown>;
      filteredData = rest;
    }

    this.logger.structured(level, message, filteredData, error);
  }

  /** 重置日志器的 trace 状态 */
  private resetTrace(): void {
    (this.logger as unknown as { traceId: string | null }).traceId = null;
    (this.logger as unknown as { spanCounter: number }).spanCounter = 0;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.structured(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.structured(LogLevel.INFO, message, data);
  }

  warning(message: string, data?: Record<string, unknown>): void {
    this.structured(LogLevel.WARNING, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.warning(message, data);
  }

  error(message: string, err?: Error, data?: Record<string, unknown>): void {
    this.structured(LogLevel.ERROR, message, data, err);
  }

  fatal(message: string, err?: Error, data?: Record<string, unknown>): void {
    this.structured(LogLevel.FATAL, message, data, err);
  }

  /** 手动触发下一 Span 计数（用于非 OTel 场景） */
  nextSpan(): string {
    return this.logger.nextSpan();
  }

  /** 手动设置 traceId（用于非 OTel 场景） */
  startTrace(id?: string): string {
    this.lastOTelTraceId = null;
    return this.logger.startTrace(id);
  }

  /** 获取当前 traceId */
  getTraceId(): string | null {
    return this.logger.getTraceId();
  }

  /** 查询日志 */
  static queryLogs(
    filter?: Parameters<typeof StructuredLogger.queryLogs>[0]
  ): StructuredLogEntry[] {
    return StructuredLogger.queryLogs(filter);
  }

  /** 清空内存日志 */
  static clearMemory(): void {
    StructuredLogger.clearMemory();
  }

  /** 重置所有 Span 计数器 */
  static resetAllSpanCounters(): void {
    spanCounters.clear();
  }
}

/** 模块级 OTelLoggerAdapter 实例 */
let otelLoggerAdapter: OTelLoggerAdapter | null = null;

/**
 * 获取或创建 OTelLoggerAdapter 单例
 * 未初始化时返回 null，调用方自行降级处理
 */
export function getOTelLoggerAdapter(
  otelTracing?: OTelTracing,
  config?: OTelLoggerAdapterConfig
): OTelLoggerAdapter | null {
  if (!otelLoggerAdapter) {
    if (!otelTracing || !config) {
      return null;
    }
    otelLoggerAdapter = new OTelLoggerAdapter(otelTracing, config);
  }
  return otelLoggerAdapter;
}

/**
 * 创建 OTelLoggerAdapter（仅在启动流程中调用）
 */
export function createOTelLoggerAdapter(
  otelTracing: OTelTracing,
  config: OTelLoggerAdapterConfig
): OTelLoggerAdapter {
  otelLoggerAdapter = new OTelLoggerAdapter(otelTracing, config);
  return otelLoggerAdapter;
}
