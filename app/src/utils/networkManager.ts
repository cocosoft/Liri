/**
 * 网络请求管理器
 * 用于优化网络请求，实现请求缓存、重试、超时处理等功能
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import { handleError } from '@modules/error/handleError';
import { CacheFactory } from '@modules/cache';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('utils:networkManager');

/**
 * HTTP方法
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'DELETE'
  | 'PATCH'
  | 'HEAD'
  | 'OPTIONS';

/**
 * 网络请求选项
 */
export interface NetworkRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retry?: number;
  retryDelay?: number;
  cache?: boolean;
  cacheExpiry?: number;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
}

/**
 * 网络请求响应
 */
export interface NetworkResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  duration: number;
  fromCache: boolean;
}

/**
 * 网络错误
 */
/**
 * 网络管理器内部错误
 * 注意：使用 NetworkManagerError 避免与 error/types 中标准 NetworkError 同名冲突
 */
export class NetworkManagerError extends AppError {
  constructor(
    message: string,
    public status?: number,
    public response?: NetworkResponse
  ) {
    super(message, ErrorCategory.NETWORK, ErrorSeverity.MEDIUM);
    this.name = 'NetworkManagerError';
  }
}

/**
 * 网络请求管理器
 */
export class NetworkManager {
  private requestCache = CacheFactory.getOrCreate<NetworkResponse>('network');
  private activeRequests = new Map<string, Promise<NetworkResponse>>();

  /**
   * 生成缓存键
   */
  private generateCacheKey(
    url: string,
    options: NetworkRequestOptions
  ): string {
    const { method = 'GET', body } = options;
    if (method !== 'GET') {
      return '';
    }
    return `network:${url}:${JSON.stringify(body || {})}`;
  }

  /**
   * 执行网络请求
   */
  async request<T = unknown>(
    url: string,
    options: NetworkRequestOptions = {}
  ): Promise<NetworkResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = 30000,
      retry = 3,
      retryDelay = 1000,
      cache = true,
      cacheExpiry = 60000, // 1分钟
      validateStatus = (status) => status >= 200 && status < 300,
      signal,
    } = options;

    // 生成缓存键
    const cacheKey = cache ? this.generateCacheKey(url, options) : '';

    // 检查缓存
    if (cacheKey) {
      const cachedResponse = this.requestCache.get(cacheKey);
      if (cachedResponse) {
        logger.debug(`Network request cached: ${url}`);
        return {
          ...cachedResponse,
          fromCache: true,
          data: cachedResponse.data as T,
        };
      }
    }

    // 检查是否有相同的请求正在进行
    const requestKey = `${method}:${url}:${JSON.stringify(body || {})}`;
    const activeRequest = this.activeRequests.get(requestKey);
    if (activeRequest) {
      logger.debug(`Network request deduplicated: ${url}`);
      return activeRequest as Promise<NetworkResponse<T>>;
    }

    // 创建请求
    const requestPromise = this.executeRequest<T>(
      url,
      { method, headers, body, timeout, validateStatus, signal },
      retry,
      retryDelay
    );

    // 添加到活跃请求
    this.activeRequests.set(requestKey, requestPromise);

    try {
      const response = await requestPromise;

      // 缓存响应
      if (cacheKey && response.status >= 200 && response.status < 300) {
        this.requestCache.set(cacheKey, response, cacheExpiry);
      }

      return response;
    } finally {
      // 从活跃请求中移除
      this.activeRequests.delete(requestKey);
    }
  }

  /**
   * 执行实际的网络请求
   */
  private async executeRequest<T = unknown>(
    url: string,
    options: Omit<
      NetworkRequestOptions,
      'retry' | 'retryDelay' | 'cache' | 'cacheExpiry'
    >,
    retry: number,
    retryDelay: number
  ): Promise<NetworkResponse<T>> {
    const startTime = performance.now();
    let attempt = 0;

    while (attempt <= retry) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), options.timeout);

        const fetchOptions: RequestInit = {
          method: options.method,
          headers: options.headers,
          signal: options.signal || controller.signal,
        };

        if (options.body) {
          fetchOptions.body =
            typeof options.body === 'string'
              ? options.body
              : JSON.stringify(options.body);

          if (!options.headers?.['Content-Type']) {
            fetchOptions.headers = {
              ...options.headers,
              'Content-Type': 'application/json',
            };
          }
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);

        const duration = performance.now() - startTime;
        const data = await this.parseResponse(response);

        if (!options.validateStatus?.(response.status)) {
          throw new NetworkManagerError(
            `Request failed with status ${response.status}`,
            response.status,
            {
              status: response.status,
              statusText: response.statusText,
              headers: this.getHeaders(response),
              data: data as T,
              duration,
              fromCache: false,
            }
          );
        }

        return {
          status: response.status,
          statusText: response.statusText,
          headers: this.getHeaders(response),
          data: data as T,
          duration,
          fromCache: false,
        };
      } catch (error) {
        attempt++;

        if (attempt > retry) {
          if (error instanceof NetworkManagerError) {
            handleError(error, { module: 'utils:network', action: 'request' });
            throw error;
          }
          handleError(error, { module: 'utils:network', action: 'request' });
          throw new NetworkManagerError(
            error instanceof Error ? error.message : 'Network request failed',
            undefined
          );
        }

        logger.warn(
          `Network request failed, retrying (${attempt}/${retry}): ${url}`,
          { error }
        );
        await this.delay(retryDelay * Math.pow(2, attempt - 1)); // 指数退避
      }
    }

    throw new NetworkManagerError('Network request failed after all retries');
  }

  /**
   * 解析响应
   */
  private async parseResponse(response: Response): Promise<unknown> {
    const contentType = response.headers.get('Content-Type');

    if (contentType?.includes('application/json')) {
      return response.json();
    } else if (contentType?.includes('text/')) {
      return response.text();
    } else {
      return response.arrayBuffer();
    }
  }

  /**
   * 获取响应头
   */
  private getHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * GET请求
   */
  async get<T = unknown>(
    url: string,
    options: Omit<NetworkRequestOptions, 'method'> = {}
  ): Promise<NetworkResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  /**
   * POST请求
   */
  async post<T = unknown>(
    url: string,
    data: unknown,
    options: Omit<NetworkRequestOptions, 'method' | 'body'> = {}
  ): Promise<NetworkResponse<T>> {
    return this.request<T>(url, { ...options, method: 'POST', body: data });
  }

  /**
   * PUT请求
   */
  async put<T = unknown>(
    url: string,
    data: unknown,
    options: Omit<NetworkRequestOptions, 'method' | 'body'> = {}
  ): Promise<NetworkResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PUT', body: data });
  }

  /**
   * DELETE请求
   */
  async delete<T = unknown>(
    url: string,
    options: Omit<NetworkRequestOptions, 'method'> = {}
  ): Promise<NetworkResponse<T>> {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }

  /**
   * PATCH请求
   */
  async patch<T = unknown>(
    url: string,
    data: unknown,
    options: Omit<NetworkRequestOptions, 'method' | 'body'> = {}
  ): Promise<NetworkResponse<T>> {
    return this.request<T>(url, { ...options, method: 'PATCH', body: data });
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.requestCache.clear();
    logger.debug('Network request cache cleared');
  }
}

/**
 * 全局网络请求管理器实例
 */
export const networkManager = new NetworkManager();

/**
 * 网络请求装饰器
 * 用于缓存网络请求的结果
 */
export function cachedNetworkRequest(expiry?: number) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`;
      const cache = CacheFactory.getOrCreate<unknown>('network-cached');
      const cachedValue = cache.get(cacheKey);

      if (cachedValue !== null) {
        return cachedValue;
      }

      const result = await originalMethod.apply(this, args);
      cache.set(cacheKey, result, expiry);
      return result;
    };
  };
}
