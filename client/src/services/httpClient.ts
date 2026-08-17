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
import { createLogger } from "../utils/logger";
import { readWithIdleTimeout } from "../utils/readWithIdleTimeout";
import { getOTelTracing } from "../monitoring/otel";

import type { ApiError, ApiResponse } from "../types/system";

export interface HttpClientConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT = 30_000;

const logger = createLogger("services:http");

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
    const authToken = localStorage.getItem("liri-auth-token");
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

// ─── W6 修复：Tauri 环境 HTTP 代理 ────────────────────
// 共享密钥（LIRI_API_SECRET）由 Rust 侧 http_proxy command 注入 X-API-Key，
// WebView JS 上下文永不持有明文密钥（防止 XSS 拿到密钥后任意调用后端 → RCE）。
// 浏览器模式（非 Tauri）保持 fetch 直连（后端默认不鉴权）。

const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

let _tauriCorePromise: Promise<
  typeof import("@tauri-apps/api/core") | null
> | null = null;

function getTauriCore(): Promise<typeof import("@tauri-apps/api/core") | null> {
  if (!isTauri) return Promise.resolve(null);
  if (!_tauriCorePromise) {
    _tauriCorePromise = import("@tauri-apps/api/core").catch(() => null);
  }
  return _tauriCorePromise;
}

interface ProxyResponse {
  status: number;
  body: string;
}

async function proxyFetch<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeout: number,
): Promise<ApiResponse<T>> {
  const core = await getTauriCore();
  if (!core) {
    return { ok: false, error: { code: 0, message: "Tauri IPC 不可用" } };
  }

  try {
    const invokePromise = core.invoke<ProxyResponse>("http_proxy", {
      method,
      url,
      body:
        body !== undefined && method !== "GET" ? JSON.stringify(body) : null,
      headers,
    });

    // 超时保护：invoke 挂起时按超时失败返回（Rust 侧 reqwest 另有 60s 兜底）
    const resp = await Promise.race([
      invokePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`请求超时 (${timeout}ms)`)), timeout),
      ),
    ]);

    if (resp.status >= 200 && resp.status < 300) {
      let data: unknown;
      if (resp.body) {
        try {
          data = JSON.parse(resp.body);
        } catch {
          data = resp.body;
        }
      }
      return { ok: true, data: data as T };
    }
    return { ok: false, error: formatError(resp.status, resp.body) };
  } catch (e) {
    handleClientError(e, {
      module: "services:httpClient",
      action: "proxyFetch",
    });
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: 408, message: `请求失败: ${message}` } };
  }
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

      // W6：Tauri 环境走 Rust 代理（secret 由 Rust 注入，JS 不接触明文密钥）
      if (isTauri) {
        return await proxyFetch<T>(method, url, headers, body, timeout);
      }

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
 *
 * BUG-4 修复：重试按方法区分——POST/PATCH 为非幂等写操作，请求若已到达后端
 * 但响应在网络中丢失，重试会重复副作用（如 POST /v1/sessions 重复创建会话、
 * POST /v1/chat/completions 重复生成）。仅幂等方法（GET/HEAD/PUT/DELETE）重试，
 * POST/PATCH 只在 attempt=0 请求一次。
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeout: number,
): Promise<ApiResponse<unknown>> {
  const RETRYABLE_STATUSES = new Set([429, 503, 504]);
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;

  const method = (options.method ?? "GET").toUpperCase();
  const isIdempotent = method !== "POST" && method !== "PATCH";
  const effectiveMaxRetries = isIdempotent ? MAX_RETRIES : 0;

  let lastError: unknown;

  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
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
        attempt < effectiveMaxRetries
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

      // 网络错误：幂等方法重试；POST/PATCH 不重试（防副作用重复）
      if (attempt < effectiveMaxRetries) {
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
    config?: HttpClientConfig & { onError?: (err: unknown) => void },
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
      // P3（第四份导出 #1）：SSE 按事件边界（空行）解析——onChunk 收到剥离
      // `data:` 前缀的完整 payload（支持多行 data continuation），
      // 原实现把含前缀的原始行直接回传，与"SSE 流式请求"语义不符。
      const pendingData: string[] = [];

      while (true) {
        // 无数据超时兜底：SSE 流中断时不永久挂起（超时抛 TimeoutError）
        const { done, value } = await readWithIdleTimeout(reader);
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            // 空行 = SSE 事件结束：处理累积的多行 data
            if (pendingData.length === 0) continue;
            const payload = pendingData.join("\n");
            pendingData.length = 0;
            if (payload !== "[DONE]") onChunk(payload);
            continue;
          }
          // 兼容 `data:` 与 `data: ` 前缀
          if (trimmed.startsWith("data:")) {
            pendingData.push(trimmed.slice(5).trimStart());
          }
          // 其他 SSE 字段（event:/id:/retry:）忽略
        }
      }
      // 流结束：flush 未闭合的残留 data（最后一条无空行结尾）
      if (pendingData.length > 0) {
        const payload = pendingData.join("\n");
        if (payload !== "[DONE]") onChunk(payload);
      }
    };

    doFetch().catch((err: unknown) => {
      // G-9 修复：流中断（非用户主动 Abort）时通知 onError，避免前端无感知静默卡死
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) {
        config?.onError?.(err);
      }
      if (err instanceof DOMException && err.name === "TimeoutError") {
        // 排查网络超时：SSE 流 idle 超时（区别于用户 AbortController 关闭）
        logger.warn("httpClient.stream: 流式读取超时（idle 60s 无数据）", {
          path,
        });
      }
      // 用户主动 Abort（AbortError）是正常关闭，静默
    });

    return controller;
  },
};
