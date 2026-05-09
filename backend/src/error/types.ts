/**
 * 错误类型定义
 * 提供详细的错误分类和层次结构
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
 * 应用错误基类
 */
export class AppError extends Error {
  /**
   * 构造函数
   * @param message 错误信息
   * @param category 错误分类
   * @param severity 错误严重程度
   * @param code 错误代码
   * @param context 错误上下文
   * @param errorId 错误 ID（用于生产环境溯源）
   */
  constructor(
    message: string,
    public category: ErrorCategory,
    public severity: ErrorSeverity,
    public code?: string,
    public context?: Record<string, any>,
    public errorId?: number
  ) {
    super(message);
    this.name = 'AppError';
  }

  /**
   * 从标准错误码创建 AppError
   * @param errorDef 错误码定义
   * @param options 可选参数
   */
  static fromCode(
    errorDef: { code: number; message: string; level: string },
    options?: {
      category?: ErrorCategory;
      context?: Record<string, any>;
      cause?: Error;
    }
  ): AppError {
    const category = options?.category ?? ErrorCategory.UNKNOWN;
    const severity = AppError.levelToSeverity(errorDef.level);
    const error = new AppError(
      errorDef.message,
      category,
      severity,
      String(errorDef.code),
      options?.context
    );
    if (options?.cause) {
      error.cause = options.cause;
    }
    return error;
  }

  private static levelToSeverity(level: string): ErrorSeverity {
    switch (level) {
      case 'CRITICAL':
        return ErrorSeverity.CRITICAL;
      case 'ERROR':
        return ErrorSeverity.HIGH;
      case 'WARN':
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.LOW;
    }
  }
}

/**
 * 网络错误类
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.NETWORK, severity, code, context);
    this.name = 'NetworkError';
  }
}

/**
 * 文件系统错误类
 */
export class FileSystemError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.FILESYSTEM, severity, code, context);
    this.name = 'FileSystemError';
  }
}

/**
 * 权限错误类
 */
export class PermissionError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.PERMISSION, severity, code, context);
    this.name = 'PermissionError';
  }
}

/**
 * 验证错误类
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.LOW,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.VALIDATION, severity, code, context);
    this.name = 'ValidationError';
  }
}

/**
 * 执行错误类
 */
export class ExecutionError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.EXECUTION, severity, code, context);
    this.name = 'ExecutionError';
  }
}

/**
 * 配置解析错误类
 * 兼容 CC 源码的 ConfigParseError 接口（含 filePath / defaultConfig）
 */
export class ConfigParseError extends AppError {
  /**
   * 配置文件路径（CC 兼容）
   */
  readonly filePath?: string;

  /**
   * 应使用的默认配置（CC 兼容）
   */
  readonly defaultConfig?: unknown;

  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    code?: string,
    context?: Record<string, any>,
    options?: { filePath?: string; defaultConfig?: unknown }
  ) {
    super(message, ErrorCategory.CONFIGURATION, severity, code, context);
    this.name = 'ConfigParseError';
    this.filePath = options?.filePath;
    this.defaultConfig = options?.defaultConfig;
  }

  /**
   * 以 CC 兼容签名构造（方便迁移）
   */
  static ccCompatible(
    message: string,
    filePath: string,
    defaultConfig: unknown
  ): ConfigParseError {
    return new ConfigParseError(
      message,
      ErrorSeverity.HIGH,
      'CONFIG_PARSE_ERROR',
      { filePath },
      { filePath, defaultConfig }
    );
  }
}

/**
 * Shell错误类
 */
export class ShellError extends AppError {
  constructor(
    message: string,
    public readonly stdout: string = '',
    public readonly stderr: string = '',
    public readonly exitCode: number = 1,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.EXECUTION, severity, code, context);
    this.name = 'ShellError';
  }
}

/**
 * 插件错误类
 */
export class PluginError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.EXECUTION, severity, code, context);
    this.name = 'PluginError';
  }
}

/**
 * 工具错误类
 */
export class ToolError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.EXECUTION, severity, code, context);
    this.name = 'ToolError';
  }
}

/**
 * 缓存错误类
 */
export class CacheError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.EXECUTION, severity, code, context);
    this.name = 'CacheError';
  }
}

/**
 * 安全错误类
 */
export class SecurityError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.PERMISSION, severity, code, context);
    this.name = 'SecurityError';
  }
}

/**
 * API错误类
 */
export class APIError extends AppError {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: any,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.API, severity, code, context);
    this.name = 'APIError';
  }
}

/**
 * 数据库错误类
 */
export class DatabaseError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.HIGH,
    code?: string,
    context?: Record<string, any>
  ) {
    super(message, ErrorCategory.DATABASE, severity, code, context);
    this.name = 'DatabaseError';
  }
}

/**
 * 中止错误类
 */
export class AbortError extends Error {
  constructor(message?: string) {
    super(message || 'Operation was aborted');
    this.name = 'AbortError';
  }
}

/**
 * Fallback触发错误类
 * 当主流程失败并触发fallback时抛出此错误
 * 兼容 CC 源码的 FallbackTriggeredError 接口（含 originalModel / fallbackModel）
 */
export class FallbackTriggeredError extends Error {
  /**
   * 原始模型名称（CC 兼容）
   */
  readonly originalModel?: string;

  /**
   * Fallback 模型名称（CC 兼容）
   */
  readonly fallbackModel?: string;

  constructor(
    message: string,
    public readonly originalError?: Error,
    public readonly fallbackType?: string,
    options?: { originalModel?: string; fallbackModel?: string }
  ) {
    super(message);
    this.name = 'FallbackTriggeredError';
    this.originalModel = options?.originalModel;
    this.fallbackModel = options?.fallbackModel;
  }

  /**
   * 以 CC 兼容签名构造（model fallback 场景）
   */
  static fromModelFallback(
    originalModel: string,
    fallbackModel: string,
    originalError?: Error
  ): FallbackTriggeredError {
    return new FallbackTriggeredError(
      `Model fallback triggered: ${originalModel} -> ${fallbackModel}`,
      originalError,
      'model_fallback',
      { originalModel, fallbackModel }
    );
  }
}

/**
 * 遥测安全错误类（不包含敏感信息）
 */
export class TelemetrySafeError extends AppError {
  readonly telemetryMessage: string;

  constructor(
    message: string,
    category: ErrorCategory,
    severity: ErrorSeverity,
    telemetryMessage?: string,
    code?: string,
    context?: Record<string, any>
  ) {
    // 移除上下文可能包含的敏感信息
    const safeContext = context
      ? TelemetrySafeError.sanitizeContext(context)
      : undefined;
    super(message, category, severity, code, safeContext);
    this.name = 'TelemetrySafeError';
    this.telemetryMessage = telemetryMessage || message;
  }

  /**
   * 清理上下文，移除敏感信息
   */
  static sanitizeContext(context: Record<string, any>): Record<string, any> {
    const sensitiveKeys = [
      'password',
      'token',
      'apiKey',
      'secret',
      'credential',
      'auth',
      'key',
    ];
    const safeContext: Record<string, any> = {};

    for (const [key, value] of Object.entries(context)) {
      if (
        sensitiveKeys.some((sensitiveKey) =>
          key.toLowerCase().includes(sensitiveKey.toLowerCase())
        )
      ) {
        safeContext[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        safeContext[key] = this.sanitizeContext(value as Record<string, any>);
      } else {
        safeContext[key] = value;
      }
    }

    return safeContext;
  }
}

/**
 * 安全遥测错误类（双消息设计）
 *
 * 显式分离用户消息和遥测消息：
 * - message: 完整消息，可包含路径等详细信息（用于日志和用户显示）
 * - telemetryMessage: 安全消息，不含敏感信息（用于遥测上报）
 *
 * 使用示例:
 * throw new SafeTelemetryError(
 *   `文件 /home/user/.ssh/id_rsa 不存在`,  // 完整消息
 *   'SSH key file not found'                // 遥测消息
 * );
 */
export class SafeTelemetryError extends Error {
  readonly telemetryMessage: string;

  constructor(message: string, telemetryMessage?: string) {
    super(message);
    this.name = 'SafeTelemetryError';
    this.telemetryMessage = telemetryMessage ?? message;
  }

  /**
   * 从现有错误创建安全遥测错误
   */
  static fromError(
    error: Error,
    telemetryMessage?: string
  ): SafeTelemetryError {
    return new SafeTelemetryError(error.message, telemetryMessage);
  }

  /**
   * 获取用于遥测上报的安全错误对象
   */
  toTelemetryObject(): { message: string; name: string; stack?: string } {
    return {
      message: this.telemetryMessage,
      name: this.name,
      stack: this.stack,
    };
  }
}

/**
 * 畸形命令错误类
 */
export class MalformedCommandError extends Error {
  constructor(message: string = 'Malformed command') {
    super(message);
    this.name = 'MalformedCommandError';
  }
}

/**
 * 传送操作错误类
 */
export class TeleportOperationError extends Error {
  constructor(
    message: string,
    public readonly formattedMessage: string
  ) {
    super(message);
    this.name = 'TeleportOperationError';
  }
}

/**
 * 轻量级网络错误类
 *
 * 相比 AppError 更轻量，不包含分类和严重程度字段，
 * 适用于性能敏感场景或简单错误处理。
 */
export class LightweightNetworkError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly timeout?: number
  ) {
    super(message);
    this.name = 'LightweightNetworkError';
  }
}

/**
 * 轻量级文件错误类
 *
 * 相比 AppError 更轻量，专注于文件系统错误的核心信息。
 */
export class LightweightFileError extends Error {
  constructor(
    message: string,
    readonly path?: string,
    readonly errno?: string
  ) {
    super(message);
    this.name = 'LightweightFileError';
  }
}

/**
 * 轻量级 API 错误类
 *
 * 相比 AppError 更轻量，专注于 API 错误的核心信息。
 */
export class LightweightAPIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly endpoint?: string
  ) {
    super(message);
    this.name = 'LightweightAPIError';
  }
}

/**
 * 轻量级配置错误类
 *
 * 相比 AppError 更轻量，专注于配置错误的核心信息。
 */
export class LightweightConfigError extends Error {
  constructor(
    message: string,
    readonly key?: string,
    readonly value?: string
  ) {
    super(message);
    this.name = 'LightweightConfigError';
  }
}

/**
 * 模块错误类
 * 用于模块系统内部错误报告
 */
export class ModuleError extends Error {
  constructor(
    message: string,
    public readonly moduleId?: string,
    public readonly errorCode?: string
  ) {
    super(message);
    this.name = 'ModuleError';
  }
}

export type { TrackedError } from './tracker/ErrorTracker';
export type { ErrorContext } from './monitor/ExternalErrorMonitor';
