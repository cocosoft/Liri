/**
 * 结构化日志系统
 * JSON 格式输出，含 traceId/spanId
 * 对齐 OpenClaw logging subsystem
 */

import { Logger, LogLevel, type LoggerConfig } from '@modules/monitoring';
import {
  MODULE_LOG_MEMORY,
  appendLogEntry,
  clearLogMemory,
  getLogMemoryCount,
  type StructuredLogEntry,
  type LogSource,
} from './LogMemory.js';
import { logRedact } from './redact/LogRedact.js';

export interface StructuredLoggerConfig extends LoggerConfig {
  module: string;
  traceEnabled: boolean;
  jsonOutput: boolean;
}

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
    this.logSource = 'structured';
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
    error?: Error,
    source?: LogSource
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
      source: source || this.logSource,
    };

    // 统一写入内存一次（通过 writeToOutputs 复用父类输出管线，避免重复）
    appendLogEntry(entry);

    if (this.jsonOutput) {
      const jsonLine = JSON.stringify(entry);
      const sanitized = logRedact.redact(jsonLine);
      this.writeToOutputs(sanitized, level);
    } else {
      const sanitized = logRedact.redact(message);
      this.writeToOutputs(sanitized, level);
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
    return getLogMemoryCount();
  }

  static clearMemory(): void {
    clearLogMemory();
  }
}
