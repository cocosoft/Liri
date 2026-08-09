/**
 * 统一 HTTP 客户端
 *
 * 封装 fetch，提供：
 * - 自动 base URL + auth header
 * - 统一错误格式 { code, message }
 * - 超时控制（默认 30s）
 * - 请求/响应拦截
 */

import { getBackendBaseUrl, getApiSecret } from "./backendUrl";
import { propagation, context as otelContext } from "@opentelemetry/api";
import { handleClientError } from "../utils/handleError";
import { getOTelTracing } from "../monitoring/otel";

import type { ApiError, ApiResponse } from "../types/system";

export interface HttpClientConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 30_000;

let globalConfig: HttpClientConfig = {
  timeout: DEFAULT_TIMEOUT,
};

/** 设置全局 base URL */
export function setHttpBaseUrl(url: string): void {
  globalConfig.baseUrl = url;
}

/** 设置全局超时，返回旧值 */
export function setHttpTimeout(ms: number): number {
  const prev = globalConfig.timeout ?? DEFAULT_TIMEOUT;
  globalConfig.timeout = ms;
  return prev;
}

/** 获取当前全局超时 */
export function getHttpTimeout(): number {
  return globalConfig.timeout ?? DEFAULT_TIMEOUT;
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

  // 登录态注入：管理 API 鉴权（M0d，登录后携带 Bearer token；未登录不注入）
  if (typeof localStorage !== "undefined") {
    const authToken = localStorage.getItem("auth_token");
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
  }

  // W3C TraceContext 传播：注入 traceparent 头
  propagation.inject(otelContext.active(), headers);

  return headers;
}

function formatError(status: number, body?: string): ApiError {
  let message = `HTTP ${status}`;
  try {
    if (body) {
      const parsed = JSON.parse(body);
      message =
        parsed.message ||
        (typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message) ||
        message;
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
  return getOTelTracing().asyncWrap(
    `http:${method}:${path}`,
    async () => {
      const url = buildUrl(path);
      const timeout =
        config?.timeout ?? globalConfig.timeout ?? DEFAULT_TIMEOUT;
      const headers = buildHeaders(config?.headers);

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined && method !== "GET") {
        fetchOptions.body = JSON.stringify(body);
      }

      return (await fetchWithRetry(
        url,
        fetchOptions,
        timeout,
      )) as ApiResponse<T>;
    },
    { "http.method": method, "http.url": path },
  );
}

/**
 * 带指数退避重试的 fetch 包装器
 * 可重试状态码: 429, 503, 504
 * 网络错误也重试（AbortError 除外）
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeout: number,
): Promise<ApiResponse<unknown>> {
  const RETRYABLE_STATUSES = new Set([429, 503, 504]);
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 可重试的 HTTP 错误状态码
      if (
        !res.ok &&
        RETRYABLE_STATUSES.has(res.status) &&
        attempt < MAX_RETRIES
      ) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, error: formatError(res.status, text) };
      }

      // 204 No Content
      if (res.status === 204) {
        return { ok: true, data: undefined };
      }

      const data = await res.json().catch(() => null);
      return { ok: true, data: data as unknown };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;

      // AbortError（超时）不重试
      if (err instanceof DOMException && err.name === "AbortError") {
        return {
          ok: false,
          error: { code: 408, message: `请求超时 (${timeout}ms)` },
        };
      }

      // 网络错误：重试
      if (attempt < MAX_RETRIES) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  // 所有重试耗尽
  handleClientError(lastError, {
    module: "services:httpClient",
    action: "request",
  });
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  return { ok: false, error: { code: 0, message } };
}

// ─── httpLegacy（旧 API，后向兼容，抛异常）─────────────────────

export class HTTPClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "HTTPClientError";
  }

  toString(): string {
    return `${this.name}: ${this.message} (status: ${this.status})`;
  }
}

/** 从 ApiResponse 解包，失败时抛 HTTPClientError（后向兼容迁移辅助） */
export function unwrapOrThrow<T>(res: ApiResponse<T>): T {
  if (!res.ok) {
    const error = res.error || { code: 500, message: "未知错误" };
    throw new HTTPClientError(error.message, error.code, error);
  }
  return res.data as T;
}

/** @deprecated 使用 http（返回 ApiResponse<T>）替代。保留为后向兼容层。 */
export const httpLegacy = {
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
    return unwrapOrThrow(res);
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await request<T>("POST", path, body);
    return unwrapOrThrow(res);
  },

  async put<T>(path: string, body: unknown): Promise<T> {
    const res = await request<T>("PUT", path, body);
    return unwrapOrThrow(res);
  },

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const res = await request<T>("PATCH", path, body);
    return unwrapOrThrow(res);
  },

  async delete<T>(path: string): Promise<T> {
    const res = await request<T>("DELETE", path);
    return unwrapOrThrow(res);
  },
};

// ─── http（新 API，返回 ApiResponse<T>）────────────────────────

export const http = {
  async get<T>(
    path: string,
    options?: { params?: Record<string, unknown> },
  ): Promise<ApiResponse<T>> {
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
    return request<T>("GET", url, undefined);
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>("POST", path, body);
  },

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>("PUT", path, body);
  },

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return request<T>("PATCH", path, body);
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    return request<T>("DELETE", path);
  },

  /** SSE 流式请求 */
  async stream(
    path: string,
    onChunk: (data: string) => void,
    config?: HttpClientConfig,
  ): Promise<AbortController> {
    const url = buildUrl(path);
    const headers = buildHeaders({
      Accept: "text/event-stream",
      ...config?.headers,
    });
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
