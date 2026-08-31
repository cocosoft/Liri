/**
 * HTTP 客户端共享工具（httpClient / tauriProxy 共用）
 *
 * 2026-08-31 自 httpClient.ts 拆分（R04-001 文件行数治理，FSZ-155）：
 * 全局配置（baseUrl/超时/header）、URL 拼接、请求头构建、错误格式化
 * 下沉至此低层模块，避免 httpClient ↔ tauriProxy 循环依赖。
 */

import { getBackendBaseUrl, getApiSecret } from "./backendUrl";
import { propagation, context as otelContext } from "@opentelemetry/api";

import type { ApiError } from "../types/system";

export interface HttpClientConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  /** 响应类型：json（默认，自动解析）| blob（二进制下载/预览） */
  responseType?: "json" | "blob";
}

export const DEFAULT_TIMEOUT = 30_000;

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

export function buildUrl(path: string): string {
  const base = globalConfig.baseUrl || getBackendBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base.replace(/\/+$/, "")}${normalizedPath}`;
}

export function buildHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
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

export function formatError(status: number, body?: string): ApiError {
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
