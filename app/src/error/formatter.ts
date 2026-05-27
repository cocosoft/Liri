/**
 * 错误格式化器
 * 提供友好的错误格式化和专门错误处理
 */

import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  ValidationError,
  NetworkError,
  FileSystemError,
  PermissionError,
  APIError,
  ShellError,
  ConfigParseError,
  DatabaseError,
} from './types';
import { ErrorUtils } from './utils';

/**
 * 错误格式化器类
 */
export class ErrorFormatter {
  /**
   * 格式化错误信息
   * @param error 错误对象
   * @returns 格式化后的错误信息
   */
  static format(error: Error): string {
    if (error instanceof ValidationError) {
      return this.formatValidationError(error);
    }

    if (error instanceof AppError) {
      return this.formatAppError(error);
    }

    return this.formatGenericError(error);
  }

  /**
   * 格式化应用错误
   * @param error 应用错误
   * @returns 格式化后的错误信息
   */
  private static formatAppError(error: AppError): string {
    let message = `[${error.category.toUpperCase()}] ${error.message}`;

    if (error.code) {
      message += ` (Code: ${error.code})`;
    }

    if (error.context && Object.keys(error.context).length > 0) {
      message += `\nContext: ${JSON.stringify(error.context)}`;
    }

    return message;
  }

  /**
   * 格式化验证错误
   * @param error 验证错误
   * @returns 格式化后的错误信息
   */
  private static formatValidationError(error: ValidationError): string {
    let message = `[VALIDATION] ${error.message}`;

    if (error.code) {
      message += ` (Code: ${error.code})`;
    }

    if (error.context) {
      message += `\nDetails:`;

      // 处理Zod验证错误
      if (error.context.zodError) {
        message += this.formatZodError(error.context.zodError);
      }

      // 处理其他验证错误
      for (const [key, value] of Object.entries(error.context)) {
        if (key !== 'zodError') {
          message += `\n- ${key}: ${value}`;
        }
      }
    }

    return message;
  }

  /**
   * 格式化Zod验证错误
   * @param zodError Zod错误对象
   * @returns 格式化后的错误信息
   */
  private static formatZodError(zodError: unknown): string {
    let message = '';

    const zodErr = zodError as {
      errors?: Array<{ path?: (string | number)[]; message: string }>;
    } | null;
    if (zodErr?.errors && Array.isArray(zodErr.errors)) {
      for (const error of zodErr.errors) {
        message += `\n  - ${error.path?.join('.') || 'value'}: ${error.message}`;
      }
    }

    return message;
  }

  /**
   * 格式化通用错误
   * @param error 通用错误
   * @returns 格式化后的错误信息
   */
  private static formatGenericError(error: Error): string {
    const category = ErrorUtils.categorizeError(error);
    let message = `[${category.toUpperCase()}] ${error.message || 'Unknown error'}`;

    if (error.stack) {
      // 只显示堆栈的前几行
      const stackLines = error.stack.split('\n').slice(0, 5);
      message += `\nStack: ${stackLines.join('\n')}`;
    }

    return message;
  }

  /**
   * 格式化为用户友好的错误信息
   * @param error 错误对象
   * @returns 用户友好的错误信息
   */
  static formatUserFriendly(error: Error): string {
    if (error instanceof ValidationError) {
      return this.formatUserFriendlyValidationError(error);
    }

    if (error instanceof NetworkError) {
      return this.formatUserFriendlyNetworkError(error);
    }

    if (error instanceof FileSystemError) {
      return this.formatUserFriendlyFileSystemError(error);
    }

    if (error instanceof PermissionError) {
      return this.formatUserFriendlyPermissionError(error);
    }

    if (error instanceof APIError) {
      return this.formatUserFriendlyAPIError(error);
    }

    if (error instanceof ShellError) {
      return this.formatUserFriendlyShellError(error);
    }

    if (error instanceof ConfigParseError) {
      return this.formatUserFriendlyConfigError(error);
    }

    if (error instanceof DatabaseError) {
      return this.formatUserFriendlyDatabaseError(error);
    }

    if (error instanceof AppError) {
      return this.formatUserFriendlyAppError(error);
    }

    return this.formatUserFriendlyGenericError(error);
  }

  /**
   * 格式化为用户友好的应用错误信息
   * @param error 应用错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyAppError(error: AppError): string {
    switch (error.category) {
      case ErrorCategory.NETWORK:
        return `网络连接错误: ${error.message}\n请检查您的网络连接后重试。`;
      case ErrorCategory.FILESYSTEM:
        return `文件操作错误: ${error.message}\n请确保文件路径正确且您有相应的权限。`;
      case ErrorCategory.PERMISSION:
        return `权限错误: ${error.message}\n请联系管理员获取相应的权限。`;
      case ErrorCategory.VALIDATION:
        return `输入验证错误: ${error.message}\n请检查您的输入后重试。`;
      case ErrorCategory.EXECUTION:
        return `执行错误: ${error.message}\n请稍后重试。`;
      case ErrorCategory.CONFIGURATION:
        return `配置错误: ${error.message}\n请检查您的配置文件。`;
      case ErrorCategory.API:
        return `API错误: ${error.message}\n请稍后重试。`;
      case ErrorCategory.DATABASE:
        return `数据库错误: ${error.message}\n请检查数据库连接。`;
      default:
        return `操作失败: ${error.message}\n请稍后重试。`;
    }
  }

  /**
   * 格式化为用户友好的验证错误信息
   * @param error 验证错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyValidationError(
    error: ValidationError
  ): string {
    let message = '输入验证失败:';

    if (error.context?.zodError) {
      const zodError = error.context.zodError as
        | { errors?: Array<{ path?: (string | number)[]; message: string }> }
        | undefined;
      if (zodError?.errors && Array.isArray(zodError.errors)) {
        for (const e of zodError.errors) {
          const field = e.path?.join('.') || '输入';
          message += `\n- ${field}: ${e.message}`;
        }
      }
    } else {
      message += `\n- ${error.message}`;
    }

    message += '\n请检查您的输入后重试。';
    return message;
  }

  /**
   * 格式化为用户友好的网络错误信息
   * @param error 网络错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyNetworkError(error: NetworkError): string {
    let message = '网络连接失败';

    if (error.code === 'ETIMEDOUT') {
      message = '连接超时';
    } else if (error.code === 'ECONNREFUSED') {
      message = '连接被拒绝';
    } else if (error.code === 'ENOTFOUND') {
      message = '无法找到服务器';
    }

    return `${message}: ${error.message}\n请检查您的网络连接和代理设置后重试。`;
  }

  /**
   * 格式化为用户友好的文件系统错误信息
   * @param error 文件系统错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyFileSystemError(
    error: FileSystemError
  ): string {
    let message = '文件操作失败';

    if (error.code === 'ENOENT') {
      message = '文件或目录不存在';
    } else if (error.code === 'EACCES') {
      message = '权限不足，无法访问文件';
    } else if (error.code === 'EEXIST') {
      message = '文件已存在';
    }

    return `${message}: ${error.message}\n请检查文件路径和权限后重试。`;
  }

  /**
   * 格式化为用户友好的权限错误信息
   * @param error 权限错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyPermissionError(
    error: PermissionError
  ): string {
    return `权限不足: ${error.message}\n请确保您有执行此操作的权限，或联系管理员。`;
  }

  /**
   * 格式化为用户友好的API错误信息
   * @param error API错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyAPIError(error: APIError): string {
    let message = 'API请求失败';

    if (error.status) {
      if (error.status === 401) {
        message = '认证失败，请重新登录';
      } else if (error.status === 403) {
        message = '权限不足，无法访问此资源';
      } else if (error.status === 404) {
        message = '请求的资源不存在';
      } else if (error.status === 429) {
        message = '请求过于频繁，请稍后重试';
      } else if (error.status >= 500) {
        message = '服务器内部错误';
      }
    }

    return `${message}: ${error.message}\n请稍后重试。`;
  }

  /**
   * 格式化为用户友好的Shell错误信息
   * @param error Shell错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyShellError(error: ShellError): string {
    let message = `命令执行失败 (退出码: ${error.exitCode})`;

    if (error.stderr) {
      message += `\n错误输出: ${error.stderr}`;
    }

    return `${message}\n请检查命令和参数后重试。`;
  }

  /**
   * 格式化为用户友好的配置错误信息
   * @param error 配置错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyConfigError(
    error: ConfigParseError
  ): string {
    return `配置解析失败: ${error.message}\n请检查配置文件的格式和内容。`;
  }

  /**
   * 格式化为用户友好的数据库错误信息
   * @param error 数据库错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyDatabaseError(error: DatabaseError): string {
    return `数据库操作失败: ${error.message}\n请检查数据库连接和配置。`;
  }

  /**
   * 格式化为用户友好的通用错误信息
   * @param error 通用错误
   * @returns 用户友好的错误信息
   */
  private static formatUserFriendlyGenericError(error: Error): string {
    return `操作失败: ${error.message || '未知错误'}\n请稍后重试。`;
  }

  /**
   * 格式化为详细的错误报告
   * @param error 错误对象
   * @returns 详细的错误报告
   */
  static formatDetailedReport(error: Error): string {
    const errorInfo = ErrorUtils.extractErrorInfo(error);

    let report = `=== 错误报告 ===\n`;
    report += `错误类型: ${error.name}\n`;
    report += `错误信息: ${errorInfo.message}\n`;
    report += `错误分类: ${errorInfo.category}\n`;
    report += `严重程度: ${errorInfo.severity}\n`;

    if (errorInfo.code) {
      report += `错误代码: ${errorInfo.code}\n`;
    }

    if (errorInfo.context) {
      report += `错误上下文: ${JSON.stringify(errorInfo.context, null, 2)}\n`;
    }

    if (errorInfo.stack) {
      report += `错误堆栈:\n${errorInfo.stack}\n`;
    }

    report += `================`;

    return report;
  }

  /**
   * 格式化为JSON
   * @param error 错误对象
   * @returns JSON格式的错误信息
   */
  static formatJSON(error: Error): object {
    const errorInfo = ErrorUtils.extractErrorInfo(error);

    return {
      name: error.name,
      message: errorInfo.message,
      category: errorInfo.category,
      severity: errorInfo.severity,
      code: errorInfo.code,
      context: errorInfo.context,
      stack: errorInfo.stack,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 格式化错误为日志格式
   * @param error 错误对象
   * @returns 日志格式的错误信息
   */
  static formatLog(error: Error): string {
    const errorInfo = ErrorUtils.extractErrorInfo(error);
    const timestamp = new Date().toISOString();

    return `[${timestamp}] [${errorInfo.severity.toUpperCase()}] [${errorInfo.category.toUpperCase()}] ${errorInfo.message}${errorInfo.code ? ` (${errorInfo.code})` : ''}`;
  }
}
