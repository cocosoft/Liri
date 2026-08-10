/**
 * API 错误类型定义
 *
 * 参考 CC源码 cc_code/backend/services/api/errors.ts
 * 提供统一的 API 错误层次结构，支持错误分类和友好提示。
 *
 * 继承 AppError 接入统一错误处理体系，使用 ErrorCategory.API 分类。
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('services\api\errors');

/**
 * API 错误类
 *
 * @deprecated 请使用 @modules/error/types 中的 APIError 替代。
 *   本类为 services/api 模块自定义的 API 错误类型，与 error/types.ts 中的
 *   标准 APIError 功能重叠。新代码应直接使用 @modules/error/types 的 APIError。
 *   此类型将在未来版本中移除。
 */
export class ApiError extends AppError {
  public readonly status: number;
  public readonly errorBody: string;
  public readonly isApiError: boolean = true;

  constructor(message: string, status: number, errorBody: string = '') {
    super(message, ErrorCategory.API, ErrorSeverity.MEDIUM, String(status));
    this.name = 'ApiError';
    this.status = status;
    this.errorBody = errorBody;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }

  get isPromptTooLong(): boolean {
    return (
      this.status === 400 &&
      this.errorBody.toLowerCase().includes('prompt is too long')
    );
  }
}

/**
 * @deprecated 请使用 @modules/error/types 中的 NetworkError 替代。
 *   此类型将在未来版本中移除。
 */
export class ApiConnectionError extends AppError {
  constructor(message: string) {
    super(
      message,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      'CONNECTION_ERROR'
    );
    this.name = 'ApiConnectionError';
  }
}

/**
 * @deprecated 请使用 @modules/error/types 中的 NetworkError 替代。
 *   此类型将在未来版本中移除。
 */
export class ApiTimeoutError extends AppError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM, 'TIMEOUT');
    this.name = 'ApiTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export const API_ERROR_MESSAGE_PREFIX = 'API Error';

export function startsWithApiErrorPrefix(text: string): boolean {
  return text.startsWith(API_ERROR_MESSAGE_PREFIX);
}

export const PROMPT_TOO_LONG_ERROR_MESSAGE = 'Prompt is too long';

export function isPromptTooLongError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.isPromptTooLong;
  }
  return false;
}

export function parsePromptTooLongTokenCounts(rawMessage: string): {
  actualTokens: number | undefined;
  limitTokens: number | undefined;
} {
  const match = rawMessage.match(
    /prompt is too long[^0-9]*(\d+)\s*tokens?\s*>\s*(\d+)/i
  );
  return {
    actualTokens: match ? parseInt(match[1]!, 10) : undefined,
    limitTokens: match ? parseInt(match[2]!, 10) : undefined,
  };
}

export function getPromptTooLongTokenGap(error: unknown): number | undefined {
  if (!isPromptTooLongError(error) || !(error instanceof ApiError)) {
    return undefined;
  }
  const { actualTokens, limitTokens } = parsePromptTooLongTokenCounts(
    error.errorBody
  );
  if (actualTokens === undefined || limitTokens === undefined) {
    return undefined;
  }
  const gap = actualTokens - limitTokens;
  return gap > 0 ? gap : undefined;
}
