/**
 * 安全服务
 * 提供数据安全、敏感信息保护和错误处理功能
 */

import { EventEmitter } from 'events';

/**
 * 敏感信息模式
 */
const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g,
  /\b(?:api[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*\S+/gi,
];

/**
 * 安全错误类型
 */
export enum SecurityErrorType {
  SENSITIVE_DATA_DETECTED = 'SENSITIVE_DATA_DETECTED',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  DATA_CORRUPTION = 'DATA_CORRUPTION',
  INVALID_INPUT = 'INVALID_INPUT',
}

/**
 * 安全错误
 */
export interface SecurityError {
  type: SecurityErrorType;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

/**
 * 安全配置
 */
export interface SecurityConfig {
  enableSensitiveDataDetection: boolean;
  enableInputValidation: boolean;
  enableErrorLogging: boolean;
  maxInputLength: number;
  allowedFileExtensions: string[];
}

/**
 * 安全服务类
 */
export class SecurityService extends EventEmitter {
  private static instance: SecurityService;
  private config: SecurityConfig = {
    enableSensitiveDataDetection: true,
    enableInputValidation: true,
    enableErrorLogging: true,
    maxInputLength: 100000,
    allowedFileExtensions: ['.txt', '.md', '.json', '.ts', '.js', '.py'],
  };
  private errorHistory: SecurityError[] = [];
  private maxErrorHistory: number = 100;

  private constructor() {
    super();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  /**
   * 更新安全配置
   * @param config 配置
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 获取安全配置
   * @returns 安全配置
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  /**
   * 检测敏感信息
   * @param text 文本内容
   * @returns 是否包含敏感信息
   */
  detectSensitiveData(text: string): boolean {
    if (!this.config.enableSensitiveDataDetection) {
      return false;
    }

    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 脱敏处理
   * @param text 文本内容
   * @returns 脱敏后的文本
   */
  sanitize(text: string): string {
    if (!this.config.enableSensitiveDataDetection) {
      return text;
    }

    let sanitized = text;

    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }

    return sanitized;
  }

  /**
   * 验证输入
   * @param input 输入内容
   * @returns 验证结果
   */
  validateInput(input: string): {
    valid: boolean;
    error?: string;
  } {
    if (!this.config.enableInputValidation) {
      return { valid: true };
    }

    if (input.length > this.config.maxInputLength) {
      return {
        valid: false,
        error: `Input exceeds maximum length of ${this.config.maxInputLength}`,
      };
    }

    if (this.detectSensitiveData(input)) {
      return {
        valid: false,
        error: 'Input contains sensitive data',
      };
    }

    return { valid: true };
  }

  /**
   * 验证文件扩展名
   * @param filename 文件名
   * @returns 验证结果
   */
  validateFileExtension(filename: string): {
    valid: boolean;
    error?: string;
  } {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

    if (!this.config.allowedFileExtensions.includes(ext)) {
      return {
        valid: false,
        error: `File extension ${ext} is not allowed`,
      };
    }

    return { valid: true };
  }

  /**
   * 记录安全错误
   * @param error 错误信息
   */
  logSecurityError(error: Omit<SecurityError, 'timestamp'>): void {
    if (!this.config.enableErrorLogging) {
      return;
    }

    const securityError: SecurityError = {
      ...error,
      timestamp: Date.now(),
    };

    this.errorHistory.push(securityError);

    if (this.errorHistory.length > this.maxErrorHistory) {
      this.errorHistory.shift();
    }

    this.emit('securityError', securityError);
  }

  /**
   * 获取错误历史
   * @returns 错误历史
   */
  getErrorHistory(): SecurityError[] {
    return [...this.errorHistory];
  }

  /**
   * 清除错误历史
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  /**
   * 获取最近的错误
   * @returns 最近的错误
   */
  getLastSecurityError(): SecurityError | null {
    return this.errorHistory.length > 0
      ? this.errorHistory[this.errorHistory.length - 1]
      : null;
  }

  /**
   * 获取错误统计
   * @returns 错误统计
   */
  getErrorStats(): Record<SecurityErrorType, number> {
    const stats: Record<string, number> = {
      [SecurityErrorType.SENSITIVE_DATA_DETECTED]: 0,
      [SecurityErrorType.UNAUTHORIZED_ACCESS]: 0,
      [SecurityErrorType.DATA_CORRUPTION]: 0,
      [SecurityErrorType.INVALID_INPUT]: 0,
    };

    for (const error of this.errorHistory) {
      stats[error.type] = (stats[error.type] || 0) + 1;
    }

    return stats as Record<SecurityErrorType, number>;
  }

  /**
   * 创建友好的错误消息
   * @param error 错误
   * @returns 友好的错误消息
   */
  createFriendlyErrorMessage(error: SecurityError): string {
    switch (error.type) {
      case SecurityErrorType.SENSITIVE_DATA_DETECTED:
        return '检测到敏感信息，已被自动过滤。请避免在消息中包含个人信息、密码或密钥。';
      case SecurityErrorType.UNAUTHORIZED_ACCESS:
        return '权限不足，无法执行此操作。';
      case SecurityErrorType.DATA_CORRUPTION:
        return '数据损坏，请重试或联系管理员。';
      case SecurityErrorType.INVALID_INPUT:
        return '输入无效，请检查后重试。';
      default:
        return '发生未知错误，请重试或联系管理员。';
    }
  }

  /**
   * 安全地处理错误
   * @param error 错误对象
   * @returns 处理后的错误信息
   */
  handleError(error: unknown): {
    message: string;
    details?: Record<string, unknown>;
  } {
    let securityError: SecurityError;

    if (error instanceof Error) {
      securityError = {
        type: SecurityErrorType.INVALID_INPUT,
        message: error.message,
        details: { stack: error.stack },
        timestamp: Date.now(),
      };
    } else if (typeof error === 'string') {
      securityError = {
        type: SecurityErrorType.INVALID_INPUT,
        message: error,
        timestamp: Date.now(),
      };
    } else {
      securityError = {
        type: SecurityErrorType.INVALID_INPUT,
        message: 'Unknown error occurred',
        details: { originalError: error },
        timestamp: Date.now(),
      };
    }

    this.logSecurityError(securityError);

    return {
      message: this.createFriendlyErrorMessage(securityError),
      details: securityError.details,
    };
  }

  /**
   * 检查数据完整性
   * @param data 数据对象
   * @returns 检查结果
   */
  checkDataIntegrity(data: unknown): {
    valid: boolean;
    error?: string;
  } {
    if (data === null || data === undefined) {
      return {
        valid: false,
        error: 'Data is null or undefined',
      };
    }

    if (typeof data === 'object') {
      try {
        JSON.stringify(data);
      } catch (error) {
        return {
          valid: false,
          error: 'Data cannot be serialized',
        };
      }
    }

    return { valid: true };
  }

  /**
   * 安全地序列化数据
   * @param data 数据对象
   * @returns 序列化后的字符串
   */
  safeSerialize(data: unknown): string {
    const integrityCheck = this.checkDataIntegrity(data);
    if (!integrityCheck.valid) {
      this.logSecurityError({
        type: SecurityErrorType.DATA_CORRUPTION,
        message: integrityCheck.error || 'Data integrity check failed',
      });
      return '{}';
    }

    try {
      const serialized = JSON.stringify(data);
      return this.sanitize(serialized);
    } catch (error) {
      this.handleError(error);
      return '{}';
    }
  }

  /**
   * 安全地反序列化数据
   * @param text 文本内容
   * @returns 反序列化后的数据
   */
  safeDeserialize<T>(text: string): T | null {
    try {
      const data = JSON.parse(text) as T;
      const integrityCheck = this.checkDataIntegrity(data);
      if (!integrityCheck.valid) {
        this.logSecurityError({
          type: SecurityErrorType.DATA_CORRUPTION,
          message: integrityCheck.error || 'Data integrity check failed',
        });
        return null;
      }
      return data;
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  /**
   * 重置服务
   */
  reset(): void {
    this.errorHistory = [];
    this.removeAllListeners();
  }
}

/**
 * 导出单例
 */
export const securityService = SecurityService.getInstance();
