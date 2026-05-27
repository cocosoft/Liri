//
/**
 * 日志输出管理器
 */

import { writeFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { LogEntry } from './LogFilter.js';
import { LogLevel } from './LogFilter.js';
import { LogFormatter, LogFormat } from './LogFormatter.js';

export interface FileSinkOptions {
  directory: string;
  filename?: string;
  maxSize?: number;
  maxFiles?: number;
  flushInterval?: number;
}

export interface ConsoleSinkOptions {
  colorize?: boolean;
  stderr?: boolean;
}

export type SinkType = 'console' | 'file' | 'memory' | 'custom';

export interface SinkConfig {
  type: SinkType;
  level?: LogLevel;
  filters?: string[];
}

export class LogSink {
  private sinks: Map<string, LogSinkInstance> = new Map();
  private formatter: LogFormatter;

  constructor(formatter?: LogFormatter) {
    this.formatter = formatter || new LogFormatter();
  }

  addSink(id: string, sink: LogSinkInstance): void {
    this.sinks.set(id, sink);
  }

  removeSink(id: string): void {
    this.sinks.delete(id);
  }

  getSink(id: string): LogSinkInstance | undefined {
    return this.sinks.get(id);
  }

  hasSink(id: string): boolean {
    return this.sinks.has(id);
  }

  listSinks(): string[] {
    return Array.from(this.sinks.keys());
  }

  async write(entry: LogEntry): Promise<void> {
    const formatted = this.formatter.format(entry);

    await Promise.all(
      Array.from(this.sinks.values()).map((sink) =>
        sink.write(entry, formatted)
      )
    );
  }

  async flush(): Promise<void> {
    await Promise.all(
      Array.from(this.sinks.values()).map((sink) => sink.flush())
    );
  }

  async close(): Promise<void> {
    await Promise.all(
      Array.from(this.sinks.values()).map((sink) => sink.close())
    );
    this.sinks.clear();
  }
}

export interface LogSinkInstance {
  write(entry: LogEntry, formatted: string): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export class ConsoleSink implements LogSinkInstance {
  private options: ConsoleSinkOptions;

  constructor(options: ConsoleSinkOptions = {}) {
    this.options = {
      colorize: options.colorize ?? false,
      stderr: options.stderr ?? false,
    };
  }

  async write(entry: LogEntry, formatted: string): Promise<void> {
    const stream = this.options.stderr ? process.stderr : process.stdout;
    stream.write(formatted + '\n');
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}
}

export class FileSink implements LogSinkInstance {
  private options: Required<FileSinkOptions>;
  private buffer: string[] = [];
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(options: FileSinkOptions) {
    this.options = {
      directory: options.directory,
      filename: options.filename ?? 'app.log',
      maxSize: options.maxSize ?? 10 * 1024 * 1024,
      maxFiles: options.maxFiles ?? 5,
      flushInterval: options.flushInterval ?? 1000,
    };

    this.startFlushTimer();
  }

  private getFilePath(): string {
    return join(this.options.directory, this.options.filename);
  }

  async write(entry: LogEntry, formatted: string): Promise<void> {
    this.buffer.push(formatted);

    if (
      this.buffer.length >= 100 ||
      entry.level === LogLevel.ERROR ||
      entry.level === LogLevel.FATAL
    ) {
      await this.flushBuffer();
    }
  }

  async flush(): Promise<void> {
    await this.flushBuffer();
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;

    const content = this.buffer.join('\n') + '\n';
    this.buffer = [];

    try {
      await mkdir(this.options.directory, { recursive: true });
      await appendFile(this.getFilePath(), content, 'utf8');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private startFlushTimer(): void {
    if (typeof setInterval !== 'undefined') {
      this.flushTimer = setInterval(() => {
        if (this.buffer.length > 0) {
          this.flushBuffer();
        }
      }, this.options.flushInterval);
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    await this.flushBuffer();
  }
}

export class MemorySink implements LogSinkInstance {
  private logs: LogEntry[] = [];
  private maxLogs: number;
  private formatter: LogFormatter;

  constructor(maxLogs: number = 1000, formatter?: LogFormatter) {
    this.maxLogs = maxLogs;
    this.formatter = formatter || new LogFormatter({ format: LogFormat.JSON });
  }

  async write(entry: LogEntry, _formatted: string): Promise<void> {
    this.logs.push(entry);

    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }

  async flush(): Promise<void> {}

  async close(): Promise<void> {}

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logs.filter((log) => log.level === level);
  }

  getLogsBySource(source: string): LogEntry[] {
    return this.logs.filter((log) => log.source === source);
  }

  clearLogs(): void {
    this.logs = [];
  }

  getLogCount(): number {
    return this.logs.length;
  }

  getRecentLogs(count: number): LogEntry[] {
    return this.logs.slice(-count);
  }
}

export function createConsoleSink(options?: ConsoleSinkOptions): ConsoleSink {
  return new ConsoleSink(options);
}

export function createFileSink(options: FileSinkOptions): FileSink {
  return new FileSink(options);
}

export function createMemorySink(
  maxLogs?: number,
  formatter?: LogFormatter
): MemorySink {
  return new MemorySink(maxLogs, formatter);
}

let globalSink: LogSink | null = null;

export function getGlobalLogSink(): LogSink {
  if (!globalSink) {
    globalSink = new LogSink();
  }
  return globalSink;
}

export function setGlobalLogSink(sink: LogSink): void {
  globalSink = sink;
}

export function resetGlobalLogSink(): void {
  globalSink = null;
}
