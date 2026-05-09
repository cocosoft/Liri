/**
 * 专门错误处理类
 */

import {
  AppError,
  ErrorCategory,
  NetworkError,
  FileSystemError,
  PermissionError,
  ValidationError,
} from '../types';
import { SafeLogger } from '../safeLog';
import { ErrorFormatter } from '../formatter';

/**
 * 错误处理策略接口
 */
interface ErrorHandlingStrategy {
  handle(error: AppError): void;
  canHandle(error: AppError): boolean;
}

/**
 * 网络错误处理策略
 */
class NetworkErrorHandler implements ErrorHandlingStrategy {
  handle(error: NetworkError): void {
    SafeLogger.logError(error, {
      action: 'network_retry',
      retryCount: error.context?.retryCount || 0,
    });

    // 可以在这里实现网络错误的重试逻辑
    if ((error.context?.retryCount || 0) < 3) {
      SafeLogger.logInfo('Retrying network operation...', {
        retryCount: (error.context?.retryCount || 0) + 1,
      });
    }
  }

  canHandle(error: AppError): boolean {
    return error.category === ErrorCategory.NETWORK;
  }
}

/**
 * 文件系统错误处理策略
 */
class FileSystemErrorHandler implements ErrorHandlingStrategy {
  handle(error: FileSystemError): void {
    SafeLogger.logError(error, {
      action: 'file_system_recovery',
      path: error.context?.path,
    });

    // 可以在这里实现文件系统错误的恢复逻辑
    if (error.context?.path) {
      SafeLogger.logInfo(`Checking file path: ${error.context.path}`);
    }
  }

  canHandle(error: AppError): boolean {
    return error.category === ErrorCategory.FILESYSTEM;
  }
}

/**
 * 权限错误处理策略
 */
class PermissionErrorHandler implements ErrorHandlingStrategy {
  handle(error: PermissionError): void {
    SafeLogger.logError(error, {
      action: 'permission_escalation',
      resource: error.context?.resource,
    });

    // 可以在这里实现权限错误的处理逻辑
    if (error.context?.resource) {
      SafeLogger.logInfo(
        `Checking permissions for resource: ${error.context.resource}`
      );
    }
  }

  canHandle(error: AppError): boolean {
    return error.category === ErrorCategory.PERMISSION;
  }
}

/**
 * 验证错误处理策略
 */
class ValidationErrorHandler implements ErrorHandlingStrategy {
  handle(error: ValidationError): void {
    SafeLogger.logError(error, {
      action: 'validation_correction',
      fields: error.context?.fields,
    });

    // 可以在这里实现验证错误的处理逻辑
    const userFriendlyMessage = ErrorFormatter.formatUserFriendly(error);
    SafeLogger.logInfo('User-friendly validation error message:', {
      message: userFriendlyMessage,
    });
  }

  canHandle(error: AppError): boolean {
    return error.category === ErrorCategory.VALIDATION;
  }
}

/**
 * 执行错误处理策略
 */
class ExecutionErrorHandler implements ErrorHandlingStrategy {
  handle(error: AppError): void {
    SafeLogger.logError(error, {
      action: 'execution_recovery',
      operation: error.context?.operation,
    });

    // 可以在这里实现执行错误的恢复逻辑
    if (error.context?.operation) {
      SafeLogger.logInfo(`Operation failed: ${error.context.operation}`);
    }
  }

  canHandle(error: AppError): boolean {
    return error.category === ErrorCategory.EXECUTION;
  }
}

/**
 * 专门错误处理器
 */
export class SpecializedErrorHandler {
  private strategies: ErrorHandlingStrategy[] = [
    new NetworkErrorHandler(),
    new FileSystemErrorHandler(),
    new PermissionErrorHandler(),
    new ValidationErrorHandler(),
    new ExecutionErrorHandler(),
  ];

  /**
   * 处理错误
   * @param error 错误对象
   */
  handle(error: AppError): void {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(error)) {
        strategy.handle(error);
        return;
      }
    }

    // 默认处理
    this.handleDefault(error);
  }

  /**
   * 默认错误处理
   * @param error 错误对象
   */
  private handleDefault(error: AppError): void {
    SafeLogger.logError(error, {
      action: 'default_error_handling',
    });
  }

  /**
   * 添加自定义错误处理策略
   * @param strategy 错误处理策略
   */
  addStrategy(strategy: ErrorHandlingStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * 处理所有错误（包括非AppError）
   * @param error 错误对象
   */
  handleAnyError(error: Error): void {
    if (error instanceof AppError) {
      this.handle(error);
    } else {
      SafeLogger.logError(error);
    }
  }
}

// 导出单例实例
export const specializedErrorHandler = new SpecializedErrorHandler();
