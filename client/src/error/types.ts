/**
 * 前端错误类型定义
 *
 * 与后端 error/types.ts 对齐，提供统一的错误分类和严重程度枚举。
 */

/**
 * 错误分类枚举
 */
export enum ErrorCategory {
  NETWORK = "network",
  FILESYSTEM = "filesystem",
  PERMISSION = "permission",
  VALIDATION = "validation",
  EXECUTION = "execution",
  CONFIGURATION = "configuration",
  API = "api",
  DATABASE = "database",
  RESOURCE = "resource",
  DATA = "data",
  OPERATION = "operation",
  UNKNOWN = "unknown",
}

/**
 * 错误严重程度枚举
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * 前端应用错误基类
 */
export class AppError extends Error {
  constructor(
    message: string,
    public category: ErrorCategory,
    public severity: ErrorSeverity,
    public code?: string,
    public context?: Record<string, unknown>,
    public errorId?: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}
