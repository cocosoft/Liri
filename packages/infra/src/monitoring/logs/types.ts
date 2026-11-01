/**
 * 监控日志共享类型定义
 *
 * 从 Logger.ts 和 LogMemory.ts 中提取，解决两者间的循环依赖问题。
 * Logger.ts 会 re-export 这些类型以保持向后兼容。
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  WARNING = 'warning',
  ERROR = 'error',
  FATAL = 'fatal',
}

export type LogSource = 'logger' | 'structured' | 'otel' | 'llm';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  traceId?: string;
  spanId?: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  source: LogSource;
}
