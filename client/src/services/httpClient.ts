/**
 * 统一 HTTP 客户端
 *
 * 封装 fetch，提供：
 * - 自动 base URL + auth header
 * - 统一错误格式 { code, message }
 * - 超时控制（默认 30s）
 * - 请求/响应拦截
 */

import {
  getBackendBaseUrl,
  getApiSecret,
} from "./backendUrl";

export interface HttpClientConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface ApiError {
  code: number;
  message: string;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ApiError;
}

const DEFAULT_TIMEOUT = 30_000;

let globalConfig: HttpClientConfig = {
  timeout: DEFAULT_TIMEOUT,
};

/** 设置全局 base URL */
export function setHttpBaseUrl(url: string): void {
  globalConfig.baseUrl = url;
}

/** 设置全局超时 */
export function setHttpTimeout(ms: number): void {
  globalConfig.timeout = ms;
}

/** 设置全局 header */
export function setHttpHeader(key: string, value: string): void {
  if (!globalConfig.headers) globalConfig.headers = {};
  globalConfig.headers[key] = value;
}

function buildUrl(path: string): string {
  const base = globalConfig.baseUrl || getBackendBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${normalizedPath}`;
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...globalConfig.headers,
    ...extra,
  };

  const secret = getApiSecret();
  if (secret) {
    headers["X-API-Key"] = secret;
  }

  return headers;
}

function formatError(status: number, body?: string): ApiError {
  let message = `HTTP ${status}`;
  try {
    if (body) {
      const parsed = JSON.parse(body);
      message = parsed.message || parsed.error || message;
    }
  } catch {
    if (body) message = body.slice(0, 200);
  }
  return { code: status, message };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  config?: HttpClientConfig,
): Promise<ApiResponse<T>> {
  const url = buildUrl(path);
  const timeout = config?.timeout ?? globalConfig.timeout ?? DEFAULT_TIMEOUT;
  const headers = buildHeaders(config?.headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body !== undefined && method !== "GET") {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: formatError(res.status, text) };
    }

    // 204 No Content
    if (res.status === 204) {
      return { ok: true, data: undefined as unknown as T };
    }

    const data = await res.json().catch(() => null);
    return { ok: true, data: data as T };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, error: { code: 408, message: `请求超时 (${timeout}ms)` } };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: { code: 0, message } };
  } finally {
    clearTimeout(timer);
  }
}

export const httpClient = {
  get<T = unknown>(path: string, config?: HttpClientConfig): Promise<ApiResponse<T>> {
    return request<T>("GET", path, undefined, config);
  },

  post<T = unknown>(path: string, body?: unknown, config?: HttpClientConfig): Promise<ApiResponse<T>> {
    return request<T>("POST", path, body, config);
  },

  put<T = unknown>(path: string, body?: unknown, config?: HttpClientConfig): Promise<ApiResponse<T>> {
    return request<T>("PUT", path, body, config);
  },

  patch<T = unknown>(path: string, body?: unknown, config?: HttpClientConfig): Promise<ApiResponse<T>> {
    return request<T>("PATCH", path, body, config);
  },

  delete<T = unknown>(path: string, config?: HttpClientConfig): Promise<ApiResponse<T>> {
    return request<T>("DELETE", path, undefined, config);
  },

  /** SSE 流式请求 */
  async stream(
    path: string,
    onChunk: (data: string) => void,
    config?: HttpClientConfig,
  ): Promise<AbortController> {
    const url = buildUrl(path);
    const headers = buildHeaders({ Accept: "text/event-stream", ...config?.headers });
    const controller = new AbortController();

    const doFetch = async (): Promise<void> => {
      const res = await fetch(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) onChunk(trimmed);
        }
      }
    };

    doFetch().catch(() => {
      // 流中断是正常行为（AbortController 关闭）
    });

    return controller;
  },
};

// ─── 向后兼容：http（旧 API） ─────────────────────

export class HTTPClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HTTPClientError";
  }
}

/** 旧的 http 对象，兼容所有现有 service。返回原始数据，错误时抛 HTTPClientError。 */
export const http = {
  async get<T>(
    path: string,
    options?: { params?: Record<string, unknown> },
  ): Promise<T> {
    let url = path;
    if (options?.params) {
      const params = new URLSearchParams();
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      });
      url += `?${params.toString()}`;
    }
    const res = await request<T>("GET", url, undefined);
    if (!res.ok) {
      throw new HTTPClientError(
        res.error!.message,
        res.error!.code,
        res.error,
      );
    }
    return res.data as T;
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await request<T>("POST", path, body);
    if (!res.ok) {
      throw new HTTPClientError(
        res.error!.message,
        res.error!.code,
        res.error,
      );
    }
    return res.data as T;
  },

  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await request<T>("PUT", path, body);
    if (!res.ok) {
      throw new HTTPClientError(
        res.error!.message,
        res.error!.code,
        res.error,
      );
    }
    return res.data as T;
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await request<T>("PATCH", path, body);
    if (!res.ok) {
      throw new HTTPClientError(
        res.error!.message,
        res.error!.code,
        res.error,
      );
    }
    return res.data as T;
  },

  async delete<T>(path: string): Promise<T> {
    const res = await request<T>("DELETE", path);
    if (!res.ok) {
      throw new HTTPClientError(
        res.error!.message,
        res.error!.code,
        res.error,
      );
    }
    return res.data as T;
  },
};
