/**
 * Tauri 环境 HTTP 代理（Rust http_proxy / http_proxy_stream）
 *
 * 2026-08-31 自 httpClient.ts 拆分（R04-001 文件行数治理，FSZ-155）：
 * - proxyFetch：非流式代理（JSON/FormData/blob），密钥由 Rust 注入 X-API-Key
 * - createStreamReader：流式代理（Channel 队列模拟 ReadableStreamDefaultReader），
 *   调用方保持原 ReadableStream 解析循环（readWithIdleTimeout 等）不变
 *
 * 依赖 httpUtils（buildUrl/formatError），不反向依赖 httpClient。
 */

import { buildUrl, formatError } from "./httpUtils";
import { handleClientError } from "../utils/handleError";

import type { ApiResponse } from "../types/system";

// ─── W6 修复：Tauri 环境 HTTP 代理 ────────────────────
// 共享密钥（LIRI_API_SECRET）由 Rust 侧 http_proxy command 注入 X-API-Key，
// WebView JS 上下文永不持有明文密钥（防止 XSS 拿到密钥后任意调用后端 → RCE）。
// 浏览器模式（非 Tauri）保持 fetch 直连（后端默认不鉴权）。

export const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

let _tauriCorePromise: Promise<
  typeof import("@tauri-apps/api/core") | null
> | null = null;

export function getTauriCore(): Promise<
  typeof import("@tauri-apps/api/core") | null
> {
  if (!isTauri) return Promise.resolve(null);
  if (!_tauriCorePromise) {
    _tauriCorePromise = import("@tauri-apps/api/core").catch(() => null);
  }
  return _tauriCorePromise;
}

interface ProxyResponse {
  status: number;
  body: string;
  /** N-1：二进制响应（下载/预览）时 Rust 侧返回 base64 */
  body_base64?: string | null;
}

/** N-2：multipart 表单字段（Tauri 代理序列化），文件内容转 base64 */
interface ProxyFormPart {
  name: string;
  filename?: string;
  content: string;
  content_type?: string;
}

/** http_proxy_stream 流式事件（Rust 侧 Channel 逐条推送，tagged enum） */
export type ProxyStreamEvent =
  | { type: "start"; status: number }
  | { type: "chunk"; data: string }
  | { type: "binary"; data_base64: string }
  | { type: "end" }
  | { type: "error"; message: string };

/** bytes → base64（浏览器端，支持大块数据） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** base64 → bytes */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** N-2：FormData → Rust 代理可序列化的 parts（文件内容转 base64） */
async function formDataToParts(form: FormData): Promise<ProxyFormPart[]> {
  const parts: ProxyFormPart[] = [];
  for (const [name, value] of form.entries()) {
    if (value instanceof Blob) {
      const file = value as File;
      parts.push({
        name,
        filename: file.name || undefined,
        content: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
        content_type: value.type || undefined,
      });
    } else {
      parts.push({
        name,
        content: bytesToBase64(new TextEncoder().encode(String(value))),
        content_type: "text/plain",
      });
    }
  }
  return parts;
}

export async function proxyFetch<T>(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeout: number,
  responseType: "json" | "blob" = "json",
): Promise<ApiResponse<T>> {
  const core = await getTauriCore();
  if (!core) {
    return { ok: false, error: { code: 0, message: "Tauri IPC 不可用" } };
  }

  try {
    // N-2：FormData 序列化为 parts（Rust 侧重建 multipart）；其余 JSON 字符串化
    let invokeBody: string | null = null;
    let formParts: ProxyFormPart[] | null = null;
    if (body !== undefined && method !== "GET") {
      if (body instanceof FormData) {
        formParts = await formDataToParts(body);
      } else {
        invokeBody = JSON.stringify(body);
      }
    }

    const invokePromise = core.invoke<ProxyResponse>("http_proxy", {
      method,
      url,
      body: invokeBody,
      form_parts: formParts,
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
      // N-1：blob 响应——Rust 侧返回 base64，前端解码为 Blob
      if (responseType === "blob") {
        if (resp.body_base64) {
          const bytes = base64ToBytes(resp.body_base64);
          return {
            ok: true,
            data: new Blob([bytes.buffer as ArrayBuffer]) as T,
          };
        }
        // 空响应或无 base64（文本兜底）
        return { ok: true, data: resp.body as unknown as T };
      }
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

/** 流式读取器接口（模拟 ReadableStreamDefaultReader，供 Tauri 代理复用解析循环） */
export interface StreamReader {
  read(): Promise<{ done: boolean; value: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
  /** 原生 reader 释放锁；自定义实现为空操作（无锁语义） */
  releaseLock(): void;
}

/**
 * 统一流式请求通道（W6 收尾，2026-08-31）：
 * - Tauri 下经 Rust http_proxy_stream（Channel 承载，密钥 Rust 侧注入，JS 不接触明文）
 * - 浏览器下 fetch 直连（后端默认不鉴权）
 * 返回模拟 reader，调用方保持原 ReadableStream 解析循环（readWithIdleTimeout 等）不变。
 */
export async function createStreamReader(
  path: string,
  config?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
): Promise<StreamReader> {
  const method = config?.method ?? "GET";
  const url = buildUrl(path);
  const headers: Record<string, string> = {
    ...config?.headers,
  };
  const requestBody =
    config?.body !== undefined && method !== "GET"
      ? JSON.stringify(config.body)
      : undefined;
  if (config?.body !== undefined && method !== "GET") {
    headers["Content-Type"] = "application/json";
  }

  if (isTauri) {
    const core = await getTauriCore();
    if (core) {
      return createTauriStreamReader(
        core,
        url,
        method,
        headers,
        requestBody,
        config?.signal,
      );
    }
  }
  return createFetchStreamReader(
    url,
    method,
    headers,
    requestBody,
    config?.signal,
  );
}

/** Tauri：Channel 队列模拟 reader（Start/Chunk/End/Error 事件 → read() 拉取） */
function createTauriStreamReader(
  core: NonNullable<Awaited<ReturnType<typeof getTauriCore>>>,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal?: AbortSignal,
): StreamReader {
  const { Channel } = core;
  const channel = new Channel<ProxyStreamEvent>();
  const queue: Uint8Array[] = [];
  let done = false;
  let cancelled = false;
  let streamError: Error | null = null;
  const waiters: Array<{
    resolve: (r: { done: boolean; value: Uint8Array }) => void;
    reject: (e: Error) => void;
  }> = [];

  const settle = (): void => {
    while (waiters.length > 0) {
      const w = waiters.shift()!;
      if (streamError) w.reject(streamError);
      else w.resolve({ done: true, value: new Uint8Array() });
    }
  };

  channel.onmessage = (evt) => {
    if (cancelled) return;
    switch (evt.type) {
      case "start": {
        // HTTP 非 2xx 视为错误（对齐 fetch 分支 response.ok 检查）
        if (evt.status < 200 || evt.status >= 300) {
          streamError = new Error(`HTTP ${evt.status}`);
          settle();
        }
        break;
      }
      case "chunk": {
        const bytes = new TextEncoder().encode(evt.data);
        const w = waiters.shift();
        if (w) w.resolve({ done: false, value: bytes });
        else queue.push(bytes);
        break;
      }
      case "end":
        done = true;
        settle();
        break;
      case "error":
        streamError = new Error(evt.message);
        settle();
        break;
      default:
        break;
    }
  };

  // 发起请求（不阻塞 read；错误经 streamError 在下次 read 时抛出）
  core
    .invoke("http_proxy_stream", {
      request: { method, url, headers, body },
      onEvent: channel,
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      streamError = err instanceof Error ? err : new Error(String(err));
      settle();
    });

  if (signal) {
    if (signal.aborted) {
      cancelled = true;
    } else {
      signal.addEventListener("abort", () => {
        cancelled = true;
        settle();
      });
    }
  }

  return {
    async read(): Promise<{ done: boolean; value: Uint8Array }> {
      if (cancelled) return { done: true, value: new Uint8Array() };
      if (streamError) throw streamError;
      if (queue.length > 0) return { done: false, value: queue.shift()! };
      if (done) return { done: true, value: new Uint8Array() };
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    async cancel(): Promise<void> {
      cancelled = true;
      settle();
    },
    releaseLock(): void {
      // 无锁语义（Channel 非原生 ReadableStream），空操作
    },
  };
}

/** 浏览器：直接 fetch 流（后端默认不鉴权） */
async function createFetchStreamReader(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  signal?: AbortSignal,
): Promise<StreamReader> {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("No response body");
  return response.body.getReader() as unknown as StreamReader;
}
