import { getLogger } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

const logger = getLogger('bridge:error:bridgeErrorHandler');

/**
 * 桥接错误处理和重试机制
 * 提供详细的错误处理、自动重试机制和用户通知功能
 */

/**
 * 错误类型
 */
export enum BridgeErrorType {
  CONNECTION_ERROR = 'connection_error',
  AUTH_ERROR = 'auth_error',
  TIMEOUT_ERROR = 'timeout_error',
  VALIDATION_ERROR = 'validation_error',
  PERMISSION_ERROR = 'permission_error',
  SESSION_ERROR = 'session_error',
  NETWORK_ERROR = 'network_error',
  UNKNOWN_ERROR = 'unknown_error',
}

/**
 * 桥接错误类
 */
export class BridgeError extends AppError {
  public readonly type: BridgeErrorType;
  public override readonly code?: string;
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    type: BridgeErrorType,
    options: {
      code?: string;
      statusCode?: number;
      isRetryable?: boolean;
      context?: Record<string, unknown>;
    } = {}
  ) {
    super(
      message,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      type,
      options.context
    );
    this.name = 'BridgeError';
    this.type = type;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.isRetryable = options.isRetryable ?? this.defaultIsRetryable();

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * 默认是否可重试
   */
  private defaultIsRetryable(): boolean {
    switch (this.type) {
      case BridgeErrorType.CONNECTION_ERROR:
      case BridgeErrorType.TIMEOUT_ERROR:
      case BridgeErrorType.NETWORK_ERROR:
        return true;
      case BridgeErrorType.AUTH_ERROR:
      case BridgeErrorType.PERMISSION_ERROR:
      case BridgeErrorType.VALIDATION_ERROR:
        return false;
      default:
        return false;
    }
  }

  /**
   * 转换为普通对象
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      code: this.code,
      statusCode: this.statusCode,
      isRetryable: this.isRetryable,
      context: this.context,
      stack: this.stack,
    };
  }
}

/**
 * 错误日志级别
 */
export enum ErrorLogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * 错误日志条目
 */
export interface ErrorLogEntry {
  timestamp: number;
  level: ErrorLogLevel;
  error: BridgeError;
  context?: Record<string, unknown>;
}

/**
 * 错误通知选项
 */
export interface ErrorNotificationOptions {
  showToUser: boolean;
  notificationTitle?: string;
  notificationMessage?: string;
  logToConsole: boolean;
  logLevel: ErrorLogLevel;
}

/**
 * 桥接错误处理器
 */
export class BridgeErrorHandler {
  private static instance: BridgeErrorHandler;
  private errorLogs: ErrorLogEntry[] = [];
  private maxLogs: number = 100;
  private listeners: Set<
    (error: BridgeError, notification: ErrorNotificationOptions) => void
  > = new Set();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): BridgeErrorHandler {
    if (!BridgeErrorHandler.instance) {
      BridgeErrorHandler.instance = new BridgeErrorHandler();
    }
    return BridgeErrorHandler.instance;
  }

  /**
   * 处理错误
   * @param error 错误
   * @param options 通知选项
   */
  handle(
    error: BridgeError,
    options?: Partial<ErrorNotificationOptions>
  ): void {
    const notificationOptions: ErrorNotificationOptions = {
      showToUser: options?.showToUser ?? false,
      notificationTitle: options?.notificationTitle ?? 'Bridge Error',
      notificationMessage: options?.notificationMessage ?? error.message,
      logToConsole: options?.logToConsole ?? true,
      logLevel: options?.logLevel ?? ErrorLogLevel.ERROR,
    };

    this.logError(error, notificationOptions);

    if (notificationOptions.showToUser) {
      this.notifyListeners(error, notificationOptions);
    }
  }

  /**
   * 记录错误
   * @param error 错误
   * @param options 通知选项
   */
  private logError(
    error: BridgeError,
    options: ErrorNotificationOptions
  ): void {
    const entry: ErrorLogEntry = {
      timestamp: Date.now(),
      level: options.logLevel,
      error,
    };

    this.errorLogs.push(entry);

    if (this.errorLogs.length > this.maxLogs) {
      this.errorLogs.shift();
    }

    if (options.logToConsole) {
      const logMethod = this.getLogMethod(options.logLevel);
      logMethod(`[BridgeError] ${error.type}: ${error.message}`, { error });
    }
  }

  /**
   * 获取日志方法
   */
  private getLogMethod(
    level: ErrorLogLevel
  ): (message: string, ...args: unknown[]) => void {
    switch (level) {
      case ErrorLogLevel.DEBUG:
        return (msg: string, ...args: unknown[]) => logger.debug(msg, ...args);
      case ErrorLogLevel.INFO:
        return (msg: string, ...args: unknown[]) => logger.info(msg, ...args);
      case ErrorLogLevel.WARN:
        return (msg: string, ...args: unknown[]) =>
          logger.warning(msg, ...args);
      case ErrorLogLevel.ERROR:
        return (msg: string, ...args: unknown[]) => logger.error(msg, ...args);
      default:
        return (msg: string, ...args: unknown[]) => logger.info(msg, ...args);
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(
    error: BridgeError,
    options: ErrorNotificationOptions
  ): void {
    for (const listener of this.listeners) {
      try {
        listener(error, options);
      } catch (e) {
        void handleError(e as Error, {
          module: 'bridge:error',
          action: 'notifyListeners',
        });
        logger.error(
          'Error in error handler listener',
          e instanceof Error ? e : new Error(String(e))
        );
      }
    }
  }

  /**
   * 添加错误监听器
   */
  addListener(
    listener: (
      error: BridgeError,
      notification: ErrorNotificationOptions
    ) => void
  ): void {
    this.listeners.add(listener);
  }

  /**
   * 移除错误监听器
   */
  removeListener(
    listener: (
      error: BridgeError,
      notification: ErrorNotificationOptions
    ) => void
  ): void {
    this.listeners.delete(listener);
  }

  /**
   * 获取错误日志
   */
  getErrorLogs(): ErrorLogEntry[] {
    return [...this.errorLogs];
  }

  /**
   * 清空错误日志
   */
  clearErrorLogs(): void {
    this.errorLogs = [];
  }

  /**
   * 获取最近的错误
   */
  getRecentErrors(count: number = 10): ErrorLogEntry[] {
    return this.errorLogs.slice(-count);
  }
}

/**
 * 从错误创建桥接错误
 * @param error 错误
 * @param type 错误类型
 * @returns 桥接错误
 */
export function createBridgeError(
  error: Error | unknown,
  type: BridgeErrorType,
  context?: Record<string, unknown>
): BridgeError {
  const message = error instanceof Error ? error.message : String(error);
  return new BridgeError(message, type, { context });
}

/**
 * 导出单例
 */
export const bridgeErrorHandler = BridgeErrorHandler.getInstance();
