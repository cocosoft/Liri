import { EventEmitter } from 'events';

import { getLogger } from '@modules/monitoring';
// P26-2 P1（2026-10-07）：秘密**形态**规则复用既有唯一事实源（`memory` 侧 gitleaks 式规则表）
// —— 不再在此维护第二套"字段名"正则（CS01）。
import { redactSecretsFully } from '../scanner/secret/index.js';

const logger = getLogger('security\services\SensitiveDataService');

/** 邮箱（**豁免 MIT 协议头行** —— 见 `redactEmails`，P26-2 P2） */
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
/** 协议头标记（`Copyright …` / `©`）—— 命中的**整行**跳过邮箱打码 */
const COPYRIGHT_LINE_PATTERN = /copyright|©/i;
/** PII（SSN / 卡号） */
const PII_PATTERNS: RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{4}-\d{4}-\d{4}-\d{4}\b/g,
];

/** 打码结果（`hit` = 文本是否被改动；CS02：结构化信号，非文案匹配） */
interface RedactResult {
  text: string;
  hit: boolean;
}

/**
 * 邮箱打码（**豁免 MIT 协议头行** —— P26-2 **P2**，2026-10-07）
 *
 * **为什么**：`.trae/rules/project_rules.md §1.2` **要求**源码携带 MIT 协议头（含作者邮箱），
 * 而本仓协议头由模板生成 ⇒ 若对邮箱**无差别**打码，模型新建文件时**无法产出合规协议头**
 * （旧实现实测命中 **≥202 处 / ≥200 文件**，见 `guardrails-dual-side.md` §9.2②-1）。
 *
 * **实现**：**按行**判定 —— 该行含 copyright 标记 ⇒ 整行**跳过**邮箱打码。
 * 这是**结构性豁免**（不硬编码作者邮箱，也不依赖固定的 `(c)` 写法）。
 */
function redactEmails(text: string): RedactResult {
  let hit = false;
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (COPYRIGHT_LINE_PATTERN.test(line)) {
      out.push(line);
      continue;
    }
    const next = line.replace(EMAIL_PATTERN, '[REDACTED]');
    if (next !== line) hit = true;
    out.push(next);
  }
  return { text: out.join('\n'), hit };
}

/** PII（SSN / 卡号）打码 */
function redactPii(text: string): RedactResult {
  let out = text;
  for (const pattern of PII_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return { text: out, hit: out !== text };
}

/**
 * 统一打码器清单 —— **`sanitize` 与 `detectSensitiveData` 共用同一组**
 * ⇒ 两者口径**必然一致**（旧实现一个走 `replace`、一个走 `/g` + `.test()`，
 * 后者因 `lastIndex` 残留会**交替误判**；本批顺带消除，见 `guardrails-dual-side.md`）。
 */
const REDACTORS: ReadonlyArray<(text: string) => RedactResult> = [
  redactEmails,
  redactPii,
  redactSecretsFully,
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
    // 与 `sanitize()` **同源**（同一组 REDACTORS）⇒ 判定与打码口径不可能漂移
    return REDACTORS.some((redact) => redact(text).hit);
  }

  sanitize(text: string): string {
    if (!this.config.enableSensitiveDataDetection) {
      return text;
    }
    let sanitized = text;
    for (const redact of REDACTORS) {
      sanitized = redact(sanitized).text;
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
