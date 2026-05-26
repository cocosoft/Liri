/**
 * 日志系统
 * 实现日志分级、文件和控制台输出
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  renameSync,
} from 'fs';

/**
 * 日志级别
 */
export enum LogLevel {
  /**
   * 调试
   */
  DEBUG = 'debug',
  /**
   * 信息
   */
  INFO = 'info',
  /**
   * 警告
   */
  WARNING = 'warning',
  WARN = 'warning',
  /**
   * 错误
   */
  ERROR = 'error',
  /**
   * 致命
   */
  FATAL = 'fatal',
}

/**
 * 日志配置
 */
export interface LoggerConfig {
  /**
   * 日志级别（同时控制文件和终端，可被 consoleLevel/fileLevel 覆盖）
   */
  level?: LogLevel;
  /**
   * 日志文件路径
   */
  logFile?: string;
  /**
   * 是否输出到控制台
   */
  consoleOutput?: boolean;
  /**
   * 是否输出到文件
   */
  fileOutput?: boolean;
  /**
   * 控制台日志级别（独立于 fileLevel），默认 WARNING
   */
  consoleLevel?: LogLevel;
  /**
   * 文件日志级别，默认 INFO
   */
  fileLevel?: LogLevel;
}

/**
 * 文件日志处理器配置
 * 对标 Hermes logging.py FileHandler：支持多文件输出、日志轮转
 */
export interface FileHandlerConfig {
  /** 文件名模式，支持 {date} 占位符 */
  filename: string;
  /** 日志级别过滤，仅 >= 此级别的日志写入 */
  level?: LogLevel;
  /** 最大文件大小（字节），默认 10MB */
  maxSize?: number;
  /** 最大文件数量，默认 5 */
  maxFiles?: number;
}

const DEFAULT_FILE_HANDLER_CONFIG: Required<
  Omit<FileHandlerConfig, 'filename'>
> = {
  level: LogLevel.INFO,
  maxSize: 10 * 1024 * 1024,
  maxFiles: 5,
};

/**
 * 文件日志处理器
 * 对标 Hermes logging.py FileHandler 实现
 * 支持日志级别过滤、自动轮转、多目标文件输出
 */
export class FileHandler {
  private config: Required<FileHandlerConfig>;
  private currentSize: number = 0;

  constructor(config: FileHandlerConfig) {
    this.config = {
      ...DEFAULT_FILE_HANDLER_CONFIG,
      ...config,
      filename: config.filename,
    };

    const logDir = this.config.filename.substring(
      0,
      Math.max(
        this.config.filename.lastIndexOf('/'),
        this.config.filename.lastIndexOf('\\')
      )
    );
    if (logDir && !existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    try {
      if (existsSync(this.config.filename)) {
        const stats = statSync(this.config.filename);
        this.currentSize = stats.size;
      }
    } catch {
      this.currentSize = 0;
    }
  }

  /**
   * 写日志到文件
   * @param message 格式化后的日志消息
   * @param level 日志级别
   */
  write(message: string, level: LogLevel): void {
    if (!this.isLevelEnabled(level)) return;

    try {
      this.rotateIfNeeded();
      appendFileSync(this.config.filename, message + '\n');
      this.currentSize += Buffer.byteLength(message) + 1;
    } catch (error) {
      console.error(`FileHandler 写入失败: ${this.config.filename}`, error);
    }
  }

  /**
   * 检查级别是否启用
   */
  private isLevelEnabled(level: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARNING,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(this.config.level);
  }

  /**
   * 检查并执行日志轮转
   */
  private rotateIfNeeded(): void {
    if (this.currentSize < this.config.maxSize) return;

    for (let i = this.config.maxFiles - 1; i > 0; i--) {
      const oldPath = `${this.config.filename}.${i}`;
      const newPath = `${this.config.filename}.${i + 1}`;
      if (existsSync(oldPath)) {
        try {
          renameSync(oldPath, newPath);
        } catch {
          break;
        }
      }
    }

    if (existsSync(this.config.filename)) {
      try {
        renameSync(this.config.filename, `${this.config.filename}.1`);
      } catch {
        return;
      }
    }

    this.currentSize = 0;
  }
}

/**
 * 从 Logger.ts 模块位置推导项目根目录
 * 解决 process.cwd() 可能因启动方式不同而不一致的问题
 * 编译为独立二进制时，import.meta.url 指向虚拟 Bun 根目录（如 B:\），回退到 process.cwd()
 */
function resolveProjectRoot(): string {
  // 环境变量优先（由 pyapp.ts 启动引导设置）
  const envDir = process.env.PYAPP_PROJECT_DIR?.trim();
  if (envDir) return envDir;

  try {
    const loggerDir = dirname(fileURLToPath(import.meta.url));
    const resolved = join(loggerDir, '..', '..', '..', '..');
    // 编译后 import.meta.url 指向虚拟根目录（如 B:\ 或 /），回退到 process.cwd()
    if (resolved.length <= 3 || !existsSync(resolved)) {
      return process.cwd();
    }
    return resolved;
  } catch {
    return process.cwd();
  }
}

/**
 * 日志记录器类
 */
export class Logger {
  /**
   * 日志配置
   */
  private config: Required<LoggerConfig> & {
    consoleLevel: LogLevel;
    fileLevel: LogLevel;
  };

  /**
   * 注册的自定义文件处理器
   */
  private fileHandlers: FileHandler[] = [];

  /**
   * 构造函数
   * @param config 日志配置
   */
  constructor(config: LoggerConfig = {}) {
    const defaultFileLevel = config.level || LogLevel.INFO;
    const logFile =
      config.logFile || join(resolveProjectRoot(), 'logs', 'app.log');

    this.config = {
      level: config.level || LogLevel.INFO,
      logFile,
      consoleOutput: config.consoleOutput ?? true,
      fileOutput: config.fileOutput ?? true,
      consoleLevel: config.consoleLevel ?? LogLevel.WARNING,
      fileLevel: config.fileLevel ?? defaultFileLevel,
    };

    // 确保日志目录存在
    if (this.config.fileOutput) {
      const logDir = this.config.logFile.substring(
        0,
        Math.max(
          this.config.logFile.lastIndexOf('/'),
          this.config.logFile.lastIndexOf('\\')
        )
      );
      if (logDir && !existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }
    }

    // 初始化验证：写入启动标记，确认文件写入正常
    if (this.config.fileOutput) {
      try {
        const initMsg = `[Logger] 日志系统就绪 — ${logFile}`;
        appendFileSync(logFile, initMsg + '\n');
      } catch (error) {
        console.error(`[Logger] 日志文件写入失败: ${logFile}`, error);
      }
    }
  }

  /**
   * 检查日志级别是否启用
   * @param level 日志级别
   * @returns 是否启用
   */
  private isLevelEnabled(level: LogLevel, minimum: LogLevel): boolean {
    const levels = [
      LogLevel.DEBUG,
      LogLevel.INFO,
      LogLevel.WARNING,
      LogLevel.ERROR,
      LogLevel.FATAL,
    ];
    return levels.indexOf(level) >= levels.indexOf(minimum);
  }

  /**
   * 生成日志消息
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 元数据
   * @returns 日志消息
   */
  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(7);
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] [${levelStr}] ${message}${metaStr}`;
  }

  /**
   * 输出日志
   * @param level 日志级别
   * @param message 日志消息
   * @param meta 元数据
   */
  private log(level: LogLevel, message: string, meta?: any): void {
    const formattedMessage = this.formatMessage(level, message, meta);

    if (
      this.config.consoleOutput &&
      this.isLevelEnabled(level, this.config.consoleLevel)
    ) {
      this.consoleLog(level, formattedMessage);
    }

    if (
      this.config.fileOutput &&
      this.isLevelEnabled(level, this.config.fileLevel)
    ) {
      this.fileLog(formattedMessage);
    }

    for (const handler of this.fileHandlers) {
      handler.write(formattedMessage, level);
    }
  }

  /**
   * 输出到控制台
   * @param level 日志级别
   * @param message 日志消息
   */
  private consoleLog(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
        console.log(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARNING:
        console.warn(message);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(message);
        break;
    }
  }

  /**
   * 输出到文件
   * @param message 日志消息
   */
  private fileLog(message: string): void {
    try {
      appendFileSync(this.config.logFile, message + '\n');
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * 调试日志
   * @param message 日志消息
   * @param meta 元数据
   */
  debug(message: string, meta?: any): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * 信息日志
   * @param message 日志消息
   * @param meta 元数据
   */
  info(message: string, meta?: any): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * 警告日志（别名）
   * @param message 日志消息
   * @param meta 元数据
   */
  warn(message: string, meta?: any): void {
    this.warning(message, meta);
  }

  /**
   * 警告日志
   * @param message 日志消息
   * @param meta 元数据
   */
  warning(message: string, meta?: any): void {
    this.log(LogLevel.WARNING, message, meta);
  }

  /**
   * 错误日志
   * @param message 日志消息
   * @param meta 元数据
   */
  error(message: string, meta?: any): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * 致命日志
   * @param message 日志消息
   * @param meta 元数据
   */
  fatal(message: string, meta?: any): void {
    this.log(LogLevel.FATAL, message, meta);
  }

  /**
   * 设置日志级别
   * @param level 日志级别
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  /**
   * 获取日志级别
   * @returns 日志级别
   */
  getLevel(): LogLevel {
    return this.config.level;
  }

  /**
   * 启用控制台输出
   */
  enableConsoleOutput(): void {
    this.config.consoleOutput = true;
  }

  /**
   * 禁用控制台输出
   */
  disableConsoleOutput(): void {
    this.config.consoleOutput = false;
  }

  /**
   * 启用文件输出
   */
  enableFileOutput(): void {
    this.config.fileOutput = true;
  }

  /**
   * 禁用文件输出
   */
  disableFileOutput(): void {
    this.config.fileOutput = false;
  }

  /**
   * 设置日志文件路径
   * @param logFile 日志文件路径
   */
  setLogFile(logFile: string): void {
    this.config.logFile = logFile;

    // 确保日志目录存在
    const logDir = logFile.substring(0, logFile.lastIndexOf('/'));
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * 注册自定义文件日志处理器
   * 对标 Hermes logging.py addHandler：支持多目标文件输出
   *
   * @param handler 文件处理器实例
   */
  addFileHandler(handler: FileHandler): void {
    this.fileHandlers.push(handler);
  }

  /**
   * 移除指定的文件日志处理器
   * @param handler 文件处理器实例
   */
  removeFileHandler(handler: FileHandler): void {
    const idx = this.fileHandlers.indexOf(handler);
    if (idx !== -1) {
      this.fileHandlers.splice(idx, 1);
    }
  }
}

/**
 * 日志记录器实例
 */
let logger: Logger | undefined;

/**
 * 获取日志记录器实例
 * @returns 日志记录器实例
 */
export function getLogger(): Logger {
  if (!logger) {
    logger = new Logger();
  }
  return logger;
}

/**
 * 创建日志记录器实例
 * @param config 日志配置
 * @returns 日志记录器实例
 */
export function createLogger(config: LoggerConfig = {}): Logger {
  return new Logger(config);
}
