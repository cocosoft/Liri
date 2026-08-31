/**
 * 统一 HTTP 客户端
 *
 * 封装 fetch，提供：
 * - 自动 base URL + auth header
 * - 统一错误格式 { code, message }
 * - 超时控制（默认 30s）
 * - 请求/响应拦截
 *
 * 2026-08-31 R04-001 拆分（FSZ-155）：
 * - httpUtils：全局配置/URL 拼接/请求头/错误格式化（共享纯函数）
 * - tauriProxy：Tauri http_proxy 非流式代理 + createStreamReader 流式通道
 * 本文件保留 request/fetchWithRetry/httpLegacy/http（含 stream），并 re-export
 * 上述模块导出以保持调用方（静态/动态 import）零改动。
 */

import { getOTelTracing } from "../monitoring/otel";
import { createLogger } from "../utils/logger";
import { handleClientError } from "../utils/handleError";
import { readWithIdleTimeout } from "../utils/readWithIdleTimeout";
import {
  buildUrl,
  buildHeaders,
  formatError,
  DEFAULT_TIMEOUT,
  setHttpBaseUrl,
  setHttpTimeout,
  getHttpTimeout,
  setHttpHeader,
  type HttpClientConfig,
} from "./httpUtils";
import {
  isTauri,
  getTauriCore,
  proxyFetch,
  createStreamReader,
  type StreamReader,
  type ProxyStreamEvent,
} from "./tauriProxy";

import type { ApiResponse } from "../types/system";

// re-export：保持调用方既有导入路径不变（含 chatService 动态 import createStreamReader）
export {
  DEFAULT_TIMEOUT,
  setHttpBaseUrl,
  setHttpTimeout,
  getHttpTimeout,
  setHttpHeader,
  createStreamReader,
  type HttpClientConfig,
  type StreamReader,
};

const logger = createLogger("services:http");

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
      const timeout = config?.timeout ?? DEFAULT_TIMEOUT;
      const responseType = config?.responseType ?? "json";
      // N-2：FormData 的 Content-Type 由浏览器/Rust 自动设置（含 boundary），
      // 移除强制 application/json，否则后端 multipart 校验必 400
      const headers =
        body instanceof FormData
          ? omitContentType(buildHeaders(config?.headers))
          : buildHeaders(config?.headers);

      // W6：Tauri 环境走 Rust 代理（secret 由 Rust 注入，JS 不接触明文密钥）
      if (isTauri) {
        return await proxyFetch<T>(
          method,
          url,
          headers,
          body,
          timeout,
          responseType,
        );
      }

      const fetchOptions: RequestInit = {
        method,
        headers,
      };

      if (body !== undefined && method !== "GET") {
        fetchOptions.body =
          body instanceof FormData ? body : JSON.stringify(body);
      }

      return (await fetchWithRetry(
        url,
        fetchOptions,
        timeout,
        responseType,
      )) as ApiResponse<T>;
    },
    { "http.method": method, "http.url": path },
  );
}

/** 移除 Content-Type（FormData 时由浏览器/Rust 自动设置含 boundary 的类型） */
function omitContentType(
  headers: Record<string, string>,
): Record<string, string> {
  const { "Content-Type": _ct, ...rest } = headers;
  return rest;
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
  responseType: "json" | "blob" = "json",
): Promise<ApiResponse<unknown>> {
  const RETRYABLE_STATUSES = new Set([429, 503, 504]);
  const MAX_RETRIES = 3;
  const BASE_BACKOFF_MS = 1000;
  // 启动窗口专用退避（2026-08-30）：503「Service starting」与连接拒绝
  // （Failed to fetch）多发生在后端重启/启动间隙（实测 10-11s），标准退避
  // 1s+2s+4s≈7s 窗口不足 → 重试耗尽仍报错。改用 2s 起底（2+4+8=14s）覆盖。
  const STARTUP_BACKOFF_MS = 2000;

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
        // 503 视为服务启动中，用启动窗口退避（覆盖后端 10-15s 就绪时间）
        const base = res.status === 503 ? STARTUP_BACKOFF_MS : BASE_BACKOFF_MS;
        // P2（2026-08-31）：equal jitter 打散并发重试（防 convoy——多请求同时失败
        // 同时退避会同步冲击后端；随机 50%-100% 保持指数增长）
        const delay = Math.floor(
          base * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5),
        );
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

      // N-1：blob 响应——二进制直接返回，不做 JSON 解析
      if (responseType === "blob") {
        const blob = await res.blob();
        return { ok: true, data: blob };
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

      // 网络错误：幂等方法重试；POST/PATCH 不重试（防副作用重复）。
      // 连接拒绝（Failed to fetch）多发生在后端重启间隙，用启动窗口退避。
      if (attempt < effectiveMaxRetries) {
        const delay = STARTUP_BACKOFF_MS * Math.pow(2, attempt);
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
    options?: {
      params?: Record<string, unknown>;
      /** N-1：blob 响应（下载/预览二进制文件） */
      responseType?: "json" | "blob";
      timeout?: number;
    },
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
    return request<T>("GET", url, undefined, {
      timeout: options?.timeout,
      responseType: options?.responseType,
    });
  },

  async post<T>(
    path: string,
    body?: unknown,
    options?: { responseType?: "json" | "blob"; timeout?: number },
  ): Promise<ApiResponse<T>> {
    return request<T>("POST", path, body, {
      timeout: options?.timeout,
      responseType: options?.responseType,
    });
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

  /** SSE 流式请求（GET/POST，Tauri 下走 Rust http_proxy_stream，密钥 Rust 侧注入）。
   *  onChunk(data, eventName)：data 为剥离 `data:` 前缀的完整 payload，eventName
   *  为 `event:` 字段（无则为 "message"）。 */
  async stream(
    path: string,
    onChunk: (data: string, eventName?: string) => void,
    config?: HttpClientConfig & {
      onError?: (err: unknown) => void;
      /** 请求方法（默认 GET） */
      method?: string;
      /** JSON 请求体（POST 等） */
      body?: unknown;
    },
  ): Promise<AbortController> {
    const url = buildUrl(path);
    const headers = buildHeaders({
      Accept: "text/event-stream",
      ...config?.headers,
    });
    const controller = new AbortController();
    const method = config?.method ?? "GET";

    // W6：Tauri 环境走 Rust 流式代理（http_proxy_stream，Channel 逐 chunk 转发，
    // 密钥由 Rust 注入 X-API-Key——原 fetch 直连会把密钥带出 WebView，加固部署下
    // 与"JS 不持匙"原则相悖）。SSE 行解析（event:/data: 剥离）与 fetch 分支保持一致。
    if (isTauri) {
      const core = await getTauriCore();
      if (core) {
        const { Channel } = core;
        const channel = new Channel<ProxyStreamEvent>();
        let buffer = "";
        let aborted = false;
        let pendingData: string[] = [];
        let currentEvent = "message";
        const flushPending = (): void => {
          if (pendingData.length === 0) return;
          const payload = pendingData.join("\n");
          pendingData = [];
          const evt = currentEvent;
          currentEvent = "message";
          if (payload !== "[DONE]") onChunk(payload, evt);
        };
        controller.signal.addEventListener("abort", () => {
          aborted = true;
        });
        channel.onmessage = (evt) => {
          if (aborted) return;
          switch (evt.type) {
            case "start":
              // HTTP 非 2xx：通知 onError（对齐 fetch 分支），后续 chunk 不再处理
              if (evt.status < 200 || evt.status >= 300) {
                config?.onError?.(new Error(`HTTP ${evt.status}`));
              }
              break;
            case "chunk": {
              buffer += evt.data;
              const lines = buffer.split("\n");
              buffer = lines.pop() || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                  flushPending();
                  continue;
                }
                if (trimmed.startsWith("event:")) {
                  currentEvent = trimmed.slice(6).trim() || "message";
                } else if (trimmed.startsWith("data:")) {
                  pendingData.push(trimmed.slice(5).trimStart());
                }
              }
              break;
            }
            case "error":
              config?.onError?.(new Error(evt.message));
              break;
            case "end":
              // 流结束：flush 未闭合的残留 data（最后一条无空行结尾）
              flushPending();
              break;
            default:
              break;
          }
        };
        const requestBody =
          config?.body !== undefined && method !== "GET"
            ? JSON.stringify(config.body)
            : null;
        core
          .invoke("http_proxy_stream", {
            request: { method, url, headers, body: requestBody },
            onEvent: channel,
          })
          .catch((err: unknown) => {
            if (!aborted) config?.onError?.(err);
          });
        return controller;
      }
    }

    const doFetch = async (): Promise<void> => {
      const res = await fetch(url, {
        method,
        headers,
        body:
          config?.body !== undefined && method !== "GET"
            ? JSON.stringify(config.body)
            : undefined,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        // 非 2xx / 无 body：通知 onError（否则调用方静默失败无感知）
        config?.onError?.(
          new Error(res.ok ? "No response body" : `HTTP ${res.status}`),
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // P3（第四份导出 #1）：SSE 按事件边界（空行）解析——onChunk 收到剥离
      // `data:` 前缀的完整 payload（支持多行 data continuation），
      // 原实现把含前缀的原始行直接回传，与"SSE 流式请求"语义不符。
      const pendingData: string[] = [];
      let currentEvent = "message";

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
            const evt = currentEvent;
            currentEvent = "message";
            if (payload !== "[DONE]") onChunk(payload, evt);
            continue;
          }
          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim() || "message";
          } else if (trimmed.startsWith("data:")) {
            pendingData.push(trimmed.slice(5).trimStart());
          }
          // 其他 SSE 字段（id:/retry:）忽略
        }
      }
      // 流结束：flush 未闭合的残留 data（最后一条无空行结尾）
      if (pendingData.length > 0) {
        const payload = pendingData.join("\n");
        if (payload !== "[DONE]") onChunk(payload, currentEvent);
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
