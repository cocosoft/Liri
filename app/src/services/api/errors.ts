/**
 * API 错误类型定义
 *
 * 参考 CC源码 cc_code/backend/services/api/errors.ts
 * 提供统一的 API 错误层次结构，支持错误分类和友好提示。
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly errorBody: string;
  public readonly isApiError: boolean = true;

  constructor(message: string, status: number, errorBody: string = '') {
    super(message);
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

export class ApiConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiConnectionError';
  }
}

export class ApiTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message);
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
