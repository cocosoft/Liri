/**
 * 轻量 API 错误类型
 * 替代 @anthropic-ai/sdk/error.js，消除 SDK 依赖
 */

/**
 * Anthropic SDK APIError 的轻量替代。
 * APISceneClassifier 依赖的字段：status、message、headers
 */
export class APIError extends Error {
  status: number | undefined;
  headers: Record<string, string | undefined> | undefined;

  constructor(
    message: string,
    status?: number,
    headers?: Record<string, string | undefined>
  ) {
    super(message);
    this.name = 'APIError';
    this.status = status;
    this.headers = headers;
  }
}

/**
 * Anthropic SDK APIConnectionError 的轻量替代。
 */
export class APIConnectionError extends APIError {
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
