/**
 * 结构化日志系统
 * JSON 格式输出，含 traceId/spanId
 * 对齐 OpenClaw logging subsystem
 */

import {
  Logger,
  LogLevel,
  type LoggerConfig,
} from '@modules/monitoring/logs/Logger';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  traceId?: string;
  spanId?: string;
  data?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

export interface StructuredLoggerConfig extends LoggerConfig {
  module: string;
  traceEnabled: boolean;
  jsonOutput: boolean;
}

const MODULE_LOG_MEMORY: StructuredLogEntry[] = [];
const MAX_MEMORY_ENTRIES = 1000;

export class StructuredLogger extends Logger {
  private moduleName: string;
  private traceEnabled: boolean;
  private jsonOutput: boolean;
  private traceId: string | null = null;
  private spanCounter = 0;

  constructor(config: StructuredLoggerConfig) {
    super({
      level: config.level,
      logFile: config.logFile,
      consoleOutput: config.consoleOutput !== false,
      fileOutput: config.fileOutput,
    });
    this.moduleName = config.module;
    this.traceEnabled = config.traceEnabled ?? false;
    this.jsonOutput = config.jsonOutput ?? false;
  }

  startTrace(id?: string): string {
    this.traceId =
      id || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.spanCounter = 0;
    return this.traceId;
  }

  nextSpan(): string {
    this.spanCounter++;
    return this.traceId
      ? `${this.traceId}-span${this.spanCounter}`
      : `span-${this.spanCounter}`;
  }

  getTraceId(): string | null {
    return this.traceId;
  }

  structured(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.moduleName,
      message,
      traceId: this.traceId || undefined,
      spanId:
        this.spanCounter > 0
          ? `${this.traceId || 'default'}-span${this.spanCounter}`
          : undefined,
      data,
      error: error
        ? { name: error.name, message: error.message, stack: error.stack }
        : undefined,
    };

    if (this.jsonOutput) {
      const jsonLine = JSON.stringify(entry);
      switch (level) {
        case LogLevel.DEBUG:
          this.debug(jsonLine);
          break;
        case LogLevel.INFO:
          this.info(jsonLine);
          break;
        case LogLevel.WARNING:
          this.warning(jsonLine);
          break;
        case LogLevel.ERROR:
          this.error(jsonLine);
          break;
        case LogLevel.FATAL:
          this.error(jsonLine);
          break;
      }
    } else {
      switch (level) {
        case LogLevel.DEBUG:
          this.debug(message);
          break;
        case LogLevel.INFO:
          this.info(message);
          break;
        case LogLevel.WARNING:
          this.warning(message);
          break;
        case LogLevel.ERROR:
          this.error(message);
          break;
        case LogLevel.FATAL:
          this.error(message);
          break;
      }
    }

    MODULE_LOG_MEMORY.push(entry);
    if (MODULE_LOG_MEMORY.length > MAX_MEMORY_ENTRIES) {
      MODULE_LOG_MEMORY.shift();
    }
  }

  static queryLogs(filter?: {
    level?: LogLevel;
    module?: string;
    traceId?: string;
    sinceMs?: number;
    limit?: number;
  }): StructuredLogEntry[] {
    let results = [...MODULE_LOG_MEMORY];

    if (filter?.level) {
      results = results.filter((e) => e.level === filter.level);
    }
    if (filter?.module) {
      results = results.filter((e) => e.module === filter.module);
    }
    if (filter?.traceId) {
      results = results.filter((e) => e.traceId === filter.traceId);
    }
    if (filter?.sinceMs) {
      const since = Date.now() - filter.sinceMs;
      results = results.filter((e) => new Date(e.timestamp).getTime() >= since);
    }

    results.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    if (filter?.limit && results.length > filter.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  static getMemoryLogCount(): number {
    return MODULE_LOG_MEMORY.length;
  }

  static clearMemory(): void {
    MODULE_LOG_MEMORY.length = 0;
  }
}
