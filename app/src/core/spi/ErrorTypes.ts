/**
 * 错误类型 SPI
 *
 * 定义 core 层的基础错误类型，不依赖 infra/error 层。
 * AppError 实际实现在 error/types.ts 中继承此基类。
 */

/**
 * 错误分类枚举
 */
export enum ErrorCategory {
  NETWORK = 'network',
  FILESYSTEM = 'filesystem',
  PERMISSION = 'permission',
  VALIDATION = 'validation',
  EXECUTION = 'execution',
  CONFIGURATION = 'configuration',
  API = 'api',
  DATABASE = 'database',
  RESOURCE = 'resource',
  DATA = 'data',
  OPERATION = 'operation',
  UNKNOWN = 'unknown',
}

/**
 * 错误严重程度枚举
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 应用错误基类（core 层 SPI 版本）
 *
 * core 层代码应使用此基类，避免直接依赖 infra/error/types。
 * infra/error/types 中的 AppError 继承自此类并扩展额外功能。
 */
export class AppError extends Error {
  constructor(
    message: string,
    public category: ErrorCategory = ErrorCategory.UNKNOWN,
    public severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    public code?: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }

  /**
   * 将错误转换为可序列化的对象
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      category: this.category,
      severity: this.severity,
      code: this.code,
      context: this.context,
      stack: this.stack,
    };
  }
}

/** SPI 服务标识符 */
export const ERROR_SERVICE_ID = 'core.spi.IErrorService';
