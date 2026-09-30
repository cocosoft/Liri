// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 错误类型定义（**转出壳**）
 * 提供详细的错误分类和层次结构
 *
 * 2026-09-30（分层倒挂收口第 2 批）：错误基座 `AppError` / `ErrorCategory` / `ErrorSeverity`
 * 的定义已**下沉至 core 侧** `core/errors.ts` —— 三者被 core 层多处直接引用，
 * 原位置构成 core → infra 倒挂（A 类台账，见 .trae/specs/layer-inversion-a-class-inventory.md §3.5.1）。
 * 本文件保留同名转出 ⇒ `@modules/error` 与 `@modules/error/types` 对外符号逐字不变。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '../core/errors.js';

export { AppError, ErrorCategory, ErrorSeverity } from '../core/errors.js';

/**
 * 网络错误类
 */
export class NetworkError extends AppError {
  constructor(
    message: string,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>,
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
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
    public readonly response?: unknown,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    code?: string,
    context?: Record<string, unknown>
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
    context?: Record<string, unknown>
  ) {
    super(message, ErrorCategory.DATABASE, severity, code, context);
    this.name = 'DatabaseError';
  }
}

/**
 * 中止错误类
 */
export class AbortError extends AppError {
  constructor(message?: string) {
    super(
      message || 'Operation was aborted',
      ErrorCategory.OPERATION,
      ErrorSeverity.LOW,
      'ABORT'
    );
    this.name = 'AbortError';
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
    context?: Record<string, unknown>
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
  static sanitizeContext(
    context: Record<string, unknown>
  ): Record<string, unknown> {
    const sensitiveKeys = [
      'password',
      'token',
      'apiKey',
      'secret',
      'credential',
      'auth',
      'key',
    ];
    const safeContext: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(context)) {
      if (
        sensitiveKeys.some((sensitiveKey) =>
          key.toLowerCase().includes(sensitiveKey.toLowerCase())
        )
      ) {
        safeContext[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        safeContext[key] = this.sanitizeContext(
          value as Record<string, unknown>
        );
      } else {
        safeContext[key] = value;
      }
    }

    return safeContext;
  }
}

/**
 * 模块错误类
 * 用于模块系统内部错误报告
 */
export class ModuleError extends AppError {
  constructor(
    message: string,
    public readonly moduleId?: string,
    public readonly errorCode?: string
  ) {
    super(
      message,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      errorCode ?? 'MODULE_ERROR'
    );
    this.name = 'ModuleError';
  }
}
