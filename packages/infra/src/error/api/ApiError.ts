import { APIError as BaseAPIError, ErrorSeverity } from '../types';

/**
 * Anthropic SDK APIError 的轻量替代。
 * APISceneClassifier 依赖的字段：status、message、headers
 */
export class APIErrorWithHeaders extends BaseAPIError {
  headers: Record<string, string | undefined> | undefined;

  constructor(
    message: string,
    status?: number,
    headers?: Record<string, string | undefined>
  ) {
    super(message, status, undefined, ErrorSeverity.HIGH);
    this.name = 'APIError';
    this.headers = headers;
  }
}

/**
 * Anthropic SDK APIConnectionError 的轻量替代。
 */
export class APIConnectionError extends APIErrorWithHeaders {
  constructor(message: string) {
    super(message);
    this.name = 'APIConnectionError';
  }
}

/**
 * Anthropic SDK APIConnectionTimeoutError 的轻量替代。
 */
export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(message: string = 'Connection timed out') {
    super(message);
    this.name = 'APIConnectionTimeoutError';
  }
}
