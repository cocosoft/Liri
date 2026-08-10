/**
 * 前端统一错误处理
 *
 * 与后端 error/handleError.ts 功能对齐：
 * - 错误标准化（转 AppError）
 * - OTEL Span 追踪
 * - 分级日志记录
 * - 后端错误上报（异步，不阻塞）
 * - 内存错误统计（供仪表盘展示）
 */

import { AppError, ErrorCategory, ErrorSeverity } from "../error/types";
import { getOTelTracing } from "../monitoring/otel/OTelTracing";
import { getBackendBaseUrl, getApiSecret } from "../services/backendUrl";
import { createLogger } from "./logger";

const logger = createLogger("error:handler");

/**
 * 从 API 错误响应中提取可读错误信息（5.7 统一解析 {error:{code,message}}）
 * 优先取后端 `response.data.error.message`，附带错误码；无则退回原始 message。
 */
export function extractApiErrorMessage(e: unknown): string {
  const anyErr = e as {
    response?: {
      data?: {
        error?: { code?: string; message?: string };
        message?: string;
      };
    };
    message?: string;
  };
  const apiError = anyErr?.response?.data?.error;
  if (apiError?.message) {
    return apiError.code
      ? `${apiError.message} (${apiError.code})`
      : apiError.message;
  }
  if (anyErr?.response?.data?.message) {
    return anyErr.response.data.message;
  }
  return anyErr?.message || String(e);
}

/**
 * 统一错误处理选项
 */
export interface HandleErrorOptions {
  /** 必传：哪个模块 */
  module: string;
  /** 当时在做什么 */
  action?: string;
  /** 附加上下文 */
  meta?: Record<string, unknown>;
  /** 请求 payload 的 key 集合（不记敏感值，只记键名，便于定位请求结构） */
  payloadKeys?: string[];
  /** React 组件栈（ErrorInfo.componentStack），定位 UI 层出错组件 */
  componentStack?: string;
}

// ---------------------------------------------------------------------------
// 内存错误统计
// ---------------------------------------------------------------------------

interface TrackedEntry {
  id: string;
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  code?: string;
  module: string;
  action?: string;
  payloadKeys?: string[];
  componentStack?: string;
  timestamp: number;
  stack?: string;
}

const MAX_TRACKED = 500;
const MAX_RECENT = 50;

/** 内存中的错误统计 */
export const errorStats = {
  total: 0,
  byCategory: {} as Record<string, number>,
  bySeverity: {} as Record<string, number>,
  recent: [] as TrackedEntry[],
};

/** 已追踪的错误列表（供仪表盘 UI 展示） */
let trackedErrors: TrackedEntry[] = [];

function recordToMemory(entry: TrackedEntry): void {
  errorStats.total++;
  errorStats.byCategory[entry.category] =
    (errorStats.byCategory[entry.category] || 0) + 1;
  errorStats.bySeverity[entry.severity] =
    (errorStats.bySeverity[entry.severity] || 0) + 1;

  errorStats.recent.unshift(entry);
  if (errorStats.recent.length > MAX_RECENT) {
    errorStats.recent = errorStats.recent.slice(0, MAX_RECENT);
  }

  trackedErrors.push(entry);
  if (trackedErrors.length > MAX_TRACKED) {
    trackedErrors = trackedErrors.slice(-MAX_TRACKED);
  }
}

/** 获取已追踪错误列表（清空后返回，供仪表盘轮询） */
export function drainTrackedErrors(): TrackedEntry[] {
  const drained = trackedErrors;
  trackedErrors = [];
  return drained;
}

// ---------------------------------------------------------------------------
// 后端上报
// ---------------------------------------------------------------------------

const REPORT_THROTTLE_MS = 5000;
const PENDING_ERRORS: TrackedEntry[] = [];

let reportTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleReport(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(async () => {
    reportTimer = null;
    if (PENDING_ERRORS.length === 0) return;

    const batch = PENDING_ERRORS.splice(0);
    try {
      const baseUrl = getBackendBaseUrl();
      const body = JSON.stringify({
        errors: batch.map((e) => ({
          message: e.message,
          category: e.category,
          severity: e.severity,
          code: e.code,
          module: e.module,
          action: e.action,
          payloadKeys: e.payloadKeys,
          componentStack: e.componentStack?.split("\n").slice(0, 10).join("\n"),
          timestamp: e.timestamp,
          stack: e.stack?.split("\n").slice(0, 3).join("\n"),
        })),
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      const secret = getApiSecret();
      if (secret) headers["X-API-Key"] = secret;

      await fetch(`${baseUrl}/v1/errors/report`, {
        method: "POST",
        headers,
        body,
        // 不阻塞，静默失败
      }).catch(() => {});
    } catch {
      // 静默失败
    }
  }, REPORT_THROTTLE_MS);
}

function reportToBackend(entry: TrackedEntry): void {
  PENDING_ERRORS.push(entry);
  scheduleReport();
}

// ---------------------------------------------------------------------------
// 统一错误处理入口
// ---------------------------------------------------------------------------

/**
 * 统一的错误处理入口函数
 *
 * 所有 catch 块的标准模式：
 * 1. 转为 AppError（标准化）
 * 2. 记录到 OTEL Span
 * 3. 分级日志输出
 * 4. 内存统计（供仪表盘）
 * 5. 后端异步上报
 *
 * @param error 捕获到的错误对象
 * @param options 处理选项
 * @returns 标准化后的 AppError 实例
 */
export function handleClientError(
  error: unknown,
  options: HandleErrorOptions,
  _severity?: "warn" | "error", // 保留签名兼容性
): AppError {
  // 1. 转为 AppError（标准化）
  const appError =
    error instanceof AppError
      ? error
      : new AppError(
          (error as Error)?.message || String(error),
          ErrorCategory.UNKNOWN,
          ErrorSeverity.MEDIUM,
          "UNHANDLED_ERROR",
        );

  const { module, action, meta, payloadKeys, componentStack } = options;

  // 2. OTEL Span 追踪
  const otel = getOTelTracing();
  const span = otel.getActiveSpan();
  if (span) {
    otel.recordError(span, error);
    span.setAttribute("error.module", module);
    if (action) span.setAttribute("error.action", action);
    if (meta) {
      Object.entries(meta).forEach(([k, v]) => {
        if (typeof v === "string" || typeof v === "number") {
          span.setAttribute(`meta.${k}`, v);
        }
      });
    }
  }

  // 3. 分级日志输出
  const logMeta = {
    category: appError.category,
    severity: appError.severity,
    code: appError.code,
    module,
    action,
    ...meta,
  };

  if (appError.severity === ErrorSeverity.CRITICAL) {
    logger.error(appError.message, { ...logMeta, stack: appError.stack });
  } else if (appError.severity === ErrorSeverity.HIGH) {
    logger.warn(appError.message, logMeta);
  } else {
    logger.info(appError.message, logMeta);
  }

  // 4. 内存统计
  const entry: TrackedEntry = {
    id: `client_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    message: appError.message,
    category: appError.category,
    severity: appError.severity,
    code: appError.code,
    module,
    action,
    payloadKeys,
    componentStack,
    timestamp: Date.now(),
    stack: (error as Error)?.stack,
  };
  recordToMemory(entry);

  // 5. 后端异步上报
  reportToBackend(entry);

  return appError;
}
