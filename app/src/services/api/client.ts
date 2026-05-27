/**
 * 核心 API 客户端
 *
 * 基于原生 fetch 实现，不依赖第三方 HTTP 库。
 * 提供统一的 HTTP 请求、重试、超时和错误处理能力。
 */
import { ApiError, ApiConnectionError, ApiTimeoutError } from './errors';

export interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  oauthToken?: string;
  maxRetries: number;
  timeoutMs: number;
  defaultHeaders?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export class ApiClient {
  private config: ApiClientConfig;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = {
      baseUrl:
        config.baseUrl ||
        process.env.API_BASE_URL ||
        'https://api.anthropic.com',
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
      oauthToken: config.oauthToken || process.env.OAUTH_TOKEN,
      maxRetries: config.maxRetries ?? 3,
      timeoutMs: config.timeoutMs ?? 600000,
      defaultHeaders: {
        'Content-Type': 'application/json',
        'User-Agent': 'py_app/1.0.0',
        ...config.defaultHeaders,
      },
    };
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.config.defaultHeaders,
    };

    if (this.config.oauthToken) {
      headers['Authorization'] = `Bearer ${this.config.oauthToken}`;
    } else if (this.config.apiKey) {
      headers['x-api-key'] = this.config.apiKey;
    }

    return headers;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { retries?: number; signal?: AbortSignal }
  ): Promise<ApiResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    const maxRetries = options?.retries ?? this.config.maxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const signal = options?.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal;

        const fetchOptions: RequestInit = {
          method,
          headers: this.buildHeaders(),
          signal,
        };

        if (body !== undefined) {
          fetchOptions.body = JSON.stringify(body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text().catch(() => '');
          throw new ApiError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status,
            errorBody
          );
        }

        const data = (await response.json()) as T;
        return { data, status: response.status, headers: response.headers };
      } catch (error) {
        lastError = error as Error;

        if (error instanceof ApiError) {
          if (
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 429
          ) {
            throw error;
          }
        } else if (
          error instanceof DOMException &&
          error.name === 'AbortError'
        ) {
          throw new ApiTimeoutError('Request timed out', this.config.timeoutMs);
        } else if (error instanceof TypeError) {
          throw new ApiConnectionError(`Connection failed: ${error.message}`);
        }

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new ApiError('Max retries exceeded', 0, '');
  }

  async get<T>(
    path: string,
    options?: { retries?: number; signal?: AbortSignal }
  ): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: { retries?: number; signal?: AbortSignal }
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: { retries?: number; signal?: AbortSignal }
  ): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(
    path: string,
    options?: { retries?: number; signal?: AbortSignal }
  ): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  getBaseUrl(): string {
    return this.config.baseUrl;
  }
}
