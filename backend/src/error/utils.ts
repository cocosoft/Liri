/**
 * 错误工具函数
 * 提供统一的错误处理接口
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  NetworkError,
  FileSystemError,
  PermissionError,
  ValidationError,
  ExecutionError,
  ConfigParseError,
  ShellError,
  APIError,
  DatabaseError,
  AbortError,
  TelemetrySafeError,
} from './types';

/**
 * 错误工具类
 */
export class ErrorUtils {
  /**
   * 分类错误
   * @param error 错误对象
   * @returns 错误分类
   */
  static categorizeError(error: Error): ErrorCategory {
    if (error instanceof AppError) {
      return error.category;
    }

    // 根据错误信息判断分类
    const errorMessage = error.message.toLowerCase();
    if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('connection')) {
      return ErrorCategory.NETWORK;
    }
    if (errorMessage.includes('file') || errorMessage.includes('fs') || errorMessage.includes('path')) {
      return ErrorCategory.FILESYSTEM;
    }
    if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      return ErrorCategory.PERMISSION;
    }
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorMessage.includes('required')) {
      return ErrorCategory.VALIDATION;
    }
    if (errorMessage.includes('config') || errorMessage.includes('configuration')) {
      return ErrorCategory.CONFIGURATION;
    }
    if (errorMessage.includes('api') || errorMessage.includes('http')) {
      return ErrorCategory.API;
    }
    if (errorMessage.includes('database') || errorMessage.includes('db') || errorMessage.includes('sql')) {
      return ErrorCategory.DATABASE;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * 提取错误信息
   * @param error 错误对象
   * @returns 错误信息
   */
  static extractErrorMessage(error: Error): string {
    if (error instanceof AppError) {
      return error.message;
    }

    return error.message || 'Unknown error';
  }

  /**
   * 提取错误堆栈
   * @param error 错误对象
   * @param maxFrames 最大帧数
   * @returns 错误堆栈
   */
  static extractErrorStack(error: Error, maxFrames: number = 5): string | undefined {
    if (!error.stack) return undefined;
    
    const lines = error.stack.split('\n');
    const header = lines[0] ?? error.message;
    const frames = lines.slice(1).filter(l => l.trim().startsWith('at '));
    
    if (frames.length <= maxFrames) return error.stack;
    return [header, ...frames.slice(0, maxFrames)].join('\n');
  }

  /**
   * 格式化错误信息
   * @param error 错误对象
   * @returns 格式化后的错误信息
   */
  static formatError(error: Error): string {
    if (error instanceof AppError) {
      return `[${error.category}] ${error.message}${error.code ? ` (${error.code})` : ''}`;
    }

    return error.message || 'Unknown error';
  }

  /**
   * 检查错误是否为特定类型
   * @param error 错误对象
   * @param errorType 错误类型
   * @returns 是否为特定类型
   */
  static isErrorType(error: Error, errorType: string): boolean {
    return error.name === errorType;
  }

  /**
   * 将普通错误转换为AppError
   * @param error 普通错误
   * @param category 错误分类
   * @param severity 错误严重程度
   * @param code 错误代码
   * @param context 错误上下文
   * @returns AppError实例
   */
  static toAppError(
    error: Error,
    category: ErrorCategory = ErrorCategory.UNKNOWN,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ): AppError {
    if (error instanceof AppError) {
      return error;
    }

    return new AppError(
      error.message || 'Unknown error',
      category,
      severity,
      code,
      context
    );
  }

  /**
   * 清理错误中的敏感信息
   * @param error 错误对象
   * @returns 清理后的错误对象
   */
  static sanitizeError(error: Error): Error {
    if (error instanceof AppError) {
      // 创建新的AppError实例，确保上下文被清理
      return new AppError(
        error.message,
        error.category,
        error.severity,
        error.code,
        error.context ? this.sanitizeContext(error.context) : undefined
      );
    }

    return error;
  }

  /**
   * 清理上下文，移除敏感信息
   * @param context 错误上下文
   * @returns 清理后的上下文
   */
  static sanitizeContext(context: Record<string, any>): Record<string, any> {
    const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'credential', 'auth', 'key'];
    const safeContext: Record<string, any> = {};

    for (const [key, value] of Object.entries(context)) {
      if (sensitiveKeys.some(sensitiveKey => 
        key.toLowerCase().includes(sensitiveKey.toLowerCase())
      )) {
        safeContext[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        safeContext[key] = this.sanitizeContext(value as Record<string, any>);
      } else {
        safeContext[key] = value;
      }
    }

    return safeContext;
  }

  /**
   * 获取错误严重程度
   * @param error 错误对象
   * @returns 错误严重程度
   */
  static getErrorSeverity(error: Error): ErrorSeverity {
    if (error instanceof AppError) {
      return error.severity;
    }

    // 根据错误类型和信息判断严重程度
    const category = this.categorizeError(error);
    switch (category) {
      case ErrorCategory.PERMISSION:
        return ErrorSeverity.HIGH;
      case ErrorCategory.NETWORK:
      case ErrorCategory.FILESYSTEM:
        return ErrorSeverity.MEDIUM;
      case ErrorCategory.VALIDATION:
        return ErrorSeverity.LOW;
      default:
        return ErrorSeverity.MEDIUM;
    }
  }

  /**
   * 合并错误信息
   * @param errors 错误数组
   * @returns 合并后的错误信息
   */
  static mergeErrors(errors: Error[]): string {
    return errors.map(error => this.formatError(error)).join('; ');
  }

  /**
   * 从错误中提取有用信息
   * @param error 错误对象
   * @returns 错误信息对象
   */
  static extractErrorInfo(error: Error): {
    message: string;
    stack?: string;
    category: ErrorCategory;
    severity: ErrorSeverity;
    code?: string;
    context?: Record<string, any>;
  } {
    if (error instanceof AppError) {
      return {
        message: error.message,
        stack: error.stack,
        category: error.category,
        severity: error.severity,
        code: error.code,
        context: error.context
      };
    }

    return {
      message: error.message || 'Unknown error',
      stack: error.stack,
      category: this.categorizeError(error),
      severity: this.getErrorSeverity(error)
    };
  }

  /**
   * 提取错误代码（errno）
   * @param error 错误对象
   * @returns 错误代码
   */
  static getErrnoCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error && typeof (error as any).code === 'string') {
      return (error as any).code;
    }
    return undefined;
  }

  /**
   * 检查错误是否为ENOENT（文件或目录不存在）
   * @param error 错误对象
   * @returns 是否为ENOENT
   */
  static isENOENT(error: unknown): boolean {
    return this.getErrnoCode(error) === 'ENOENT';
  }

  /**
   * 检查错误是否为文件系统不可访问错误
   * @param error 错误对象
   * @returns 是否为文件系统不可访问错误
   */
  static isFsInaccessible(error: unknown): boolean {
    const code = this.getErrnoCode(error);
    return (
      code === 'ENOENT' ||
      code === 'EACCES' ||
      code === 'EPERM' ||
      code === 'ENOTDIR' ||
      code === 'ELOOP'
    );
  }

  /**
   * 检查错误是否为中止错误
   * @param error 错误对象
   * @returns 是否为中止错误
   */
  static isAbortError(error: unknown): boolean {
    return (
      error instanceof AbortError ||
      (error instanceof Error && error.name === 'AbortError')
    );
  }

  /**
   * 检查错误消息是否完全匹配
   * @param error 错误对象
   * @param message 消息
   * @returns 是否匹配
   */
  static hasExactErrorMessage(error: unknown, message: string): boolean {
    return error instanceof Error && error.message === message;
  }

  /**
   * 将未知值转换为Error
   * @param error 未知值
   * @returns Error实例
   */
  static toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }

  /**
   * 从错误中提取消息
   * @param error 错误对象
   * @returns 错误消息
   */
  static errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * 从错误中提取路径
   * @param error 错误对象
   * @returns 路径
   */
  static getErrnoPath(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'path' in error && typeof (error as any).path === 'string') {
      return (error as any).path;
    }
    return undefined;
  }

  /**
   * 创建网络错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns NetworkError
   */
  static createNetworkError(message: string, code?: string, context?: Record<string, any>): NetworkError {
    return new NetworkError(message, ErrorSeverity.MEDIUM, code, context);
  }

  /**
   * 创建文件系统错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns FileSystemError
   */
  static createFileSystemError(message: string, code?: string, context?: Record<string, any>): FileSystemError {
    return new FileSystemError(message, ErrorSeverity.MEDIUM, code, context);
  }

  /**
   * 创建权限错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns PermissionError
   */
  static createPermissionError(message: string, code?: string, context?: Record<string, any>): PermissionError {
    return new PermissionError(message, ErrorSeverity.HIGH, code, context);
  }

  /**
   * 创建验证错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns ValidationError
   */
  static createValidationError(message: string, code?: string, context?: Record<string, any>): ValidationError {
    return new ValidationError(message, ErrorSeverity.LOW, code, context);
  }

  /**
   * 创建配置解析错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns ConfigParseError
   */
  static createConfigParseError(message: string, code?: string, context?: Record<string, any>): ConfigParseError {
    return new ConfigParseError(message, ErrorSeverity.HIGH, code, context);
  }

  /**
   * 创建Shell错误
   * @param message 错误消息
   * @param stdout 标准输出
   * @param stderr 标准错误
   * @param exitCode 退出代码
   * @param code 错误代码
   * @param context 上下文
   * @returns ShellError
   */
  static createShellError(
    message: string,
    stdout: string = '',
    stderr: string = '',
    exitCode: number = 1,
    code?: string,
    context?: Record<string, any>
  ): ShellError {
    return new ShellError(message, stdout, stderr, exitCode, ErrorSeverity.MEDIUM, code, context);
  }

  /**
   * 创建API错误
   * @param message 错误消息
   * @param status HTTP状态码
   * @param response 响应数据
   * @param code 错误代码
   * @param context 上下文
   * @returns APIError
   */
  static createAPIError(
    message: string,
    status?: number,
    response?: any,
    code?: string,
    context?: Record<string, any>
  ): APIError {
    return new APIError(message, status, response, ErrorSeverity.MEDIUM, code, context);
  }

  /**
   * 创建数据库错误
   * @param message 错误消息
   * @param code 错误代码
   * @param context 上下文
   * @returns DatabaseError
   */
  static createDatabaseError(message: string, code?: string, context?: Record<string, any>): DatabaseError {
    return new DatabaseError(message, ErrorSeverity.HIGH, code, context);
  }

  /**
   * 创建遥测安全错误
   * @param message 错误消息
   * @param category 错误分类
   * @param severity 错误严重程度
   * @param telemetryMessage 遥测消息
   * @param code 错误代码
   * @param context 上下文
   * @returns TelemetrySafeError
   */
  static createTelemetrySafeError(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    telemetryMessage?: string,
    code?: string,
    context?: Record<string, any>
  ): TelemetrySafeError {
    return new TelemetrySafeError(message, category, severity, telemetryMessage, code, context);
  }
}
