import { appendFile } from 'fs/promises';
import { logRedact } from './redact/LogRedact.js';
import { appendLogEntry } from './LogMemory.js';
import { LogLevel, type StructuredLogEntry, type LogSource } from './types.js';
import { logFilter } from './filter/LogFilter.js';

export { LogLevel } from './types.js';
export type { StructuredLogEntry, LogSource } from './types.js';

// ========== LogHandler 机制（方案 11：OTLP 日志导出） ==========

/**
 * 日志处理器
 * Logger 每次写入日志时回调所有已注册的处理器。
 * 用于将日志桥接到 OTel、外部存储等服务。
 */
export type LogHandler = (entry: StructuredLogEntry) => void;

/** 全局日志处理器列表 */
const logHandlers: LogHandler[] = [];

/**
 * 注册日志处理器
 * @param handler 处理器回调
 * @returns 取消注册的函数
 */
export function addLogHandler(handler: LogHandler): () => void {
  logHandlers.push(handler);
  return () => {
    const idx = logHandlers.indexOf(handler);
    if (idx >= 0) logHandlers.splice(idx, 1);
  };
}

/**
 * 移除日志处理器
 */
export function removeLogHandler(handler: LogHandler): void {
  const idx = logHandlers.indexOf(handler);
  if (idx >= 0) logHandlers.splice(idx, 1);
}

const LOG_LEVEL_PRIORITY: Record<string, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.WARNING]: 2,
  [LogLevel.ERROR]: 3,
  [LogLevel.FATAL]: 4,
};

/** ANSI 颜色码，用于控制台着色输出 */
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
} as const;

/** 按日志级别获取对应颜色码 */
function getLevelColor(level: LogLevel): string {
  switch (level) {
    case LogLevel.DEBUG:
      return ANSI.dim;
    case LogLevel.INFO:
      return ANSI.green;
    case LogLevel.WARN:
    case LogLevel.WARNING:
      return ANSI.yellow;
    case LogLevel.ERROR:
    case LogLevel.FATAL:
      return ANSI.red;
    default:
      return ANSI.reset;
  }
}

/** 异步文件写入队列配置（可通过 setGlobalBufferConfig 覆盖） */
let globalFlushIntervalMs = 5000;
let globalMaxBufferSize = 1000;

/** 按文件路径分组的异步写入缓冲区 */
const fileWriteBuffers = new Map<string, string[]>();
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动定时 flush（惰性初始化，首次写入时触发）
 */
function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushAllBuffers, globalFlushIntervalMs);
  flushTimer.unref(); // 不阻止进程退出
}

/**
 * 将日志行加入异步写入队列
 */
function enqueueFileWrite(filePath: string, line: string): void {
  ensureFlushTimer();

  if (!fileWriteBuffers.has(filePath)) {
    fileWriteBuffers.set(filePath, []);
  }
  const buffer = fileWriteBuffers.get(filePath)!;
  buffer.push(line);

  // 缓冲区满时立即 flush
  if (buffer.length >= globalMaxBufferSize) {
    flushFileBuffer(filePath);
  }
}

/**
 * 刷新指定文件的缓冲区
 */
async function flushFileBuffer(filePath: string): Promise<void> {
  const buffer = fileWriteBuffers.get(filePath);
  if (!buffer || buffer.length === 0) return;

  const lines = buffer.splice(0);
  fileWriteBuffers.delete(filePath);

  try {
    await appendFile(filePath, lines.join('\n') + '\n', 'utf-8');
  } catch (err) {
    // 文件写入失败时静默处理

    console.warn('Logger file write failed', {
      context: '文件写入失败时静默处理',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 刷新所有文件的缓冲区
 */
async function flushAllBuffers(): Promise<void> {
  const promises: Promise<void>[] = [];
  for (const filePath of fileWriteBuffers.keys()) {
    promises.push(flushFileBuffer(filePath));
  }
  await Promise.allSettled(promises);
}

/**
 * 全局 flush：刷新所有待写入的日志到磁盘
 * 在进程退出前调用，确保日志不丢失
 */
export async function flush(): Promise<void> {
  await flushAllBuffers();
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

/**
 * 设置全局缓冲区配置
 * 由 LogConfigManager 注册，控制异步写入的缓冲区大小和刷新间隔
 */
export function setGlobalBufferConfig(
  maxBufferSize: number,
  flushIntervalMs: number
): void {
  if (maxBufferSize > 0) {
    globalMaxBufferSize = maxBufferSize;
  }
  if (flushIntervalMs > 0) {
    globalFlushIntervalMs = flushIntervalMs;
    // 如果已有定时器，重建以应用新间隔
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
  }
}

export interface LoggerConfig {
  level?: LogLevel;
  logFile?: string;
  consoleOutput?: boolean;
  fileOutput?: boolean;
  module?: string;
  format?: 'text' | 'json';
  /** 控制台输出是否着色（默认 false），仅对 consoleOutput 生效 */
  colorize?: boolean;
  /** 是否在日志中附带 OTEL traceId/spanId（默认 false） */
  otelTraceEnabled?: boolean;
}

let defaultLogger: Logger | null = null;

/** 按模块名缓存的 Logger 实例 */
const moduleLoggers = new Map<string, Logger>();

/** 全局配置提供者（由 LogConfigManager 注册） */
type GlobalConfigProvider = () => Partial<LoggerConfig>;
let globalConfigProvider: GlobalConfigProvider | null = null;

/**
 * 设置全局配置提供者
 * 用于 LogConfigManager 等集中配置系统注册默认配置
 */
export function setGlobalConfigProvider(provider: GlobalConfigProvider): void {
  globalConfigProvider = provider;
}

export class Logger {
  private level: LogLevel;
  private module: string;
  private logFile: string | undefined;
  private consoleOutput: boolean;
  private fileOutput: boolean;
  private format: 'text' | 'json';
  private colorize: boolean;
  private otelTraceEnabled: boolean;

  constructor(config: LoggerConfig = {}) {
    // 合并全局配置提供者的默认值
    const globalDefaults = globalConfigProvider ? globalConfigProvider() : {};
    const merged: LoggerConfig = { ...globalDefaults, ...config };

    this.level = merged.level ?? LogLevel.INFO;
    this.module = merged.module ?? 'app';
    this.logFile = merged.logFile;
    this.consoleOutput = merged.consoleOutput !== false;
    this.fileOutput = merged.fileOutput ?? false;
    this.format = merged.format ?? 'text';
    this.colorize = merged.colorize ?? false;
    this.otelTraceEnabled = merged.otelTraceEnabled ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    meta?: unknown
  ): string {
    const timestamp = new Date().toISOString();

    if (this.format === 'json') {
      const entry: Record<string, unknown> = {
        timestamp,
        level,
        module: this.module,
        message,
      };
      if (meta !== undefined) {
        entry.meta = meta;
      }
      return JSON.stringify(entry);
    }

    const metaStr =
      meta !== undefined
        ? ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`
        : '';
    return `[${timestamp}] [${level.toUpperCase()}] [${this.module}] ${message}${metaStr}`;
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) return;

    // LogFilter 子系统过滤
    if (!logFilter.shouldInclude(this.module, level, message)) return;

    const formatted = this.formatMessage(level, message, meta);
    const sanitized = logRedact.redact(formatted);

    // 将日志条目写入内存，供日志查询接口使用
    const logEntry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module: this.module,
      message,
      data:
        meta !== undefined
          ? typeof meta === 'object'
            ? (meta as Record<string, unknown>)
            : { meta }
          : undefined,
      source: 'logger' as LogSource,
    };
    appendLogEntry(logEntry);

    this.writeToOutputs(sanitized, level);

    // 通知全局日志处理器（如 OTelLoggerAdapter）
    for (const handler of logHandlers) {
      try {
        handler(logEntry);
      } catch (err) {
        // 处理器异常不中断主流程

        console.debug('Logger handler exception', {
          context: '处理器异常不中断主流程',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * 仅输出到控制台/文件，不入内存
   * 供 StructuredLogger 等子类复用，避免重复写入内存
   */
  protected writeToOutputs(sanitized: string, level: LogLevel): void {
    if (this.consoleOutput) {
      const output = this.colorize
        ? `${getLevelColor(level)}${sanitized}${ANSI.reset}`
        : sanitized;

      switch (level) {
        case LogLevel.DEBUG:
          console.debug(output);
          break;
        case LogLevel.INFO:
          console.info(output);
          break;
        case LogLevel.WARN:
        case LogLevel.WARNING:
          console.warn(output);
          break;
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(output);
          break;
      }
    }

    if (this.fileOutput && this.logFile) {
      // 文件输出不着色
      enqueueFileWrite(this.logFile, sanitized);
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.write(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.write(LogLevel.WARN, message, meta);
  }

  warning(message: string, meta?: unknown): void {
    this.write(LogLevel.WARNING, message, meta);
  }

  /**
   * 记录错误日志
   * - 传入 Error 对象时，自动提取 name/message/stack
   * - 传入字符串时作为普通日志消息处理
   */
  error(message: string, meta?: unknown): void;
  error(message: string, error: Error): void;
  error(message: string, errorOrMeta?: unknown | Error): void {
    if (errorOrMeta instanceof Error) {
      this.write(LogLevel.ERROR, message, {
        error: errorOrMeta.message,
        stack: errorOrMeta.stack,
        name: errorOrMeta.name,
      });
      return;
    }
    this.write(LogLevel.ERROR, message, errorOrMeta);
  }

  fatal(message: string, meta?: unknown): void {
    this.write(LogLevel.FATAL, message, meta);
  }
}

/**
 * 获取 Logger 实例
 * @param module - 模块名，用于按模块区分日志来源
 *   - 传入模块名时，按模块名缓存实例，同一模块多次调用返回同一实例
 *   - 不传时返回默认的 'app' 单例
 */
export function getLogger(module?: string): Logger {
  if (module) {
    if (!moduleLoggers.has(module)) {
      moduleLoggers.set(
        module,
        new Logger({ module, level: LogLevel.INFO, format: 'json' })
      );
    }
    return moduleLoggers.get(module)!;
  }

  if (!defaultLogger) {
    defaultLogger = new Logger({ level: LogLevel.INFO, format: 'json' });
  }
  return defaultLogger;
}

export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger({ format: 'json', ...config });
}
