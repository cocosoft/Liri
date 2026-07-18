import { EventEmitter } from 'events';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'security\services\SensitiveDataService', level: LogLevel.INFO });

const SENSITIVE_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g,
  /\b(?:api[_-]?key|secret[_-]?key|password|token)\s*[:=]\s*\S+/gi,
];

export enum SensitiveErrorType {
  SENSITIVE_DATA_DETECTED = 'SENSITIVE_DATA_DETECTED',
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',
  DATA_CORRUPTION = 'DATA_CORRUPTION',
  INVALID_INPUT = 'INVALID_INPUT',
}

export interface SensitiveError {
  type: SensitiveErrorType;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
}

export interface SensitiveDataConfig {
  enableSensitiveDataDetection: boolean;
  enableInputValidation: boolean;
  enableErrorLogging: boolean;
  maxInputLength: number;
  allowedFileExtensions: string[];
}

export class SensitiveDataService extends EventEmitter {
  private static instance: SensitiveDataService;
  private config: SensitiveDataConfig = {
    enableSensitiveDataDetection: true,
    enableInputValidation: true,
    enableErrorLogging: true,
    maxInputLength: 100000,
    allowedFileExtensions: ['.txt', '.md', '.json', '.ts', '.js', '.py'],
  };
  private errorHistory: SensitiveError[] = [];
  private maxErrorHistory: number = 100;

  private constructor() {
    super();
  }

  static getInstance(): SensitiveDataService {
    if (!SensitiveDataService.instance) {
      SensitiveDataService.instance = new SensitiveDataService();
    }
    return SensitiveDataService.instance;
  }

  updateConfig(config: Partial<SensitiveDataConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): SensitiveDataConfig {
    return { ...this.config };
  }

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

  validateInput(input: string): { valid: boolean; error?: string } {
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
      return { valid: false, error: 'Input contains sensitive data' };
    }
    return { valid: true };
  }

  validateFileExtension(filename: string): { valid: boolean; error?: string } {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!this.config.allowedFileExtensions.includes(ext)) {
      return { valid: false, error: `File extension ${ext} is not allowed` };
    }
    return { valid: true };
  }

  logSecurityError(error: Omit<SensitiveError, 'timestamp'>): void {
    if (!this.config.enableErrorLogging) {
      return;
    }
    const securityError: SensitiveError = {
      ...error,
      timestamp: Date.now(),
    };
    this.errorHistory.push(securityError);
    if (this.errorHistory.length > this.maxErrorHistory) {
      this.errorHistory.shift();
    }
    this.emit('securityError', securityError);
  }

  getErrorHistory(): SensitiveError[] {
    return [...this.errorHistory];
  }

  clearErrorHistory(): void {
    this.errorHistory = [];
  }

  getLastSecurityError(): SensitiveError | null {
    return this.errorHistory.length > 0
      ? this.errorHistory[this.errorHistory.length - 1]
      : null;
  }

  getErrorStats(): Record<SensitiveErrorType, number> {
    const stats: Record<string, number> = {
      [SensitiveErrorType.SENSITIVE_DATA_DETECTED]: 0,
      [SensitiveErrorType.UNAUTHORIZED_ACCESS]: 0,
      [SensitiveErrorType.DATA_CORRUPTION]: 0,
      [SensitiveErrorType.INVALID_INPUT]: 0,
    };
    for (const error of this.errorHistory) {
      stats[error.type] = (stats[error.type] || 0) + 1;
    }
    return stats as Record<SensitiveErrorType, number>;
  }

  createFriendlyErrorMessage(error: SensitiveError): string {
    switch (error.type) {
      case SensitiveErrorType.SENSITIVE_DATA_DETECTED:
        return '检测到敏感信息，已被自动过滤。请避免在消息中包含个人信息、密码或密钥。';
      case SensitiveErrorType.UNAUTHORIZED_ACCESS:
        return '权限不足，无法执行此操作。';
      case SensitiveErrorType.DATA_CORRUPTION:
        return '数据损坏，请重试或联系管理员。';
      case SensitiveErrorType.INVALID_INPUT:
        return '输入无效，请检查后重试。';
      default:
        return '发生未知错误，请重试或联系管理员。';
    }
  }

  handleError(error: unknown): {
    message: string;
    details?: Record<string, unknown>;
  } {
    let securityError: SensitiveError;
    if (error instanceof Error) {
      securityError = {
        type: SensitiveErrorType.INVALID_INPUT,
        message: error.message,
        details: { stack: error.stack },
        timestamp: Date.now(),
      };
    } else if (typeof error === 'string') {
      securityError = {
        type: SensitiveErrorType.INVALID_INPUT,
        message: error,
        timestamp: Date.now(),
      };
    } else {
      securityError = {
        type: SensitiveErrorType.INVALID_INPUT,
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

  checkDataIntegrity(data: unknown): { valid: boolean; error?: string } {
    if (data === null || data === undefined) {
      return { valid: false, error: 'Data is null or undefined' };
    }
    if (typeof data === 'object') {
      try {
        JSON.stringify(data);
      } catch {
        return { valid: false, error: 'Data cannot be serialized' };
      }
    }
    return { valid: true };
  }

  safeSerialize(data: unknown): string {
    const integrityCheck = this.checkDataIntegrity(data);
    if (!integrityCheck.valid) {
      this.logSecurityError({
        type: SensitiveErrorType.DATA_CORRUPTION,
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

  safeDeserialize<T>(text: string): T | null {
    try {
      const data = JSON.parse(text) as T;
      const integrityCheck = this.checkDataIntegrity(data);
      if (!integrityCheck.valid) {
        this.logSecurityError({
          type: SensitiveErrorType.DATA_CORRUPTION,
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

  reset(): void {
    this.errorHistory = [];
    this.removeAllListeners();
  }
}

export const sensitiveDataService = SensitiveDataService.getInstance();
