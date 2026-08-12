// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { AppError, ErrorCategory, ErrorSeverity } from './types';
import { createLogger, LogLevel } from '@modules/monitoring';
import { getOTelTracing } from '../monitoring/otel/OTelTracing.js';

/**
 * 统一错误处理选项
 */
export interface HandleErrorOptions {
  /** 必传：哪个模块 */
  module: string;
  /** 当时在做什么 */
  action?: string;
  /** 是否重新抛出（默认 false） */
  rethrow?: boolean;
  /** 附加上下文 */
  context?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// 内联错误追踪（替代 ErrorTracker + ErrorMonitor）
// ---------------------------------------------------------------------------

/** 追踪的错误记录 */
interface TrackedEntry {
  id: string;
  error: AppError;
  timestamp: number;
  context?: Record<string, unknown>;
}

const trackedErrors = new Map<string, TrackedEntry>();
const MAX_TRACKED = 10000;

/** 简易错误统计 */
const errorStats = {
  total: 0,
  byCategory: {} as Record<string, number>,
  bySeverity: {} as Record<string, number>,
  recent: [] as TrackedEntry[],
};

const MAX_RECENT = 100;

/**
 * 记录一条错误到内存追踪
 * @param appError 标准化后的 AppError
 * @param context 附加上下文
 */
function recordError(
  appError: AppError,
  context?: Record<string, unknown>
): void {
  const id = `track_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const entry: TrackedEntry = {
    id,
    error: appError,
    timestamp: Date.now(),
    context,
  };

  trackedErrors.set(id, entry);

  // 更新统计
  errorStats.total++;
  errorStats.byCategory[appError.category] =
    (errorStats.byCategory[appError.category] || 0) + 1;
  errorStats.bySeverity[appError.severity] =
    (errorStats.bySeverity[appError.severity] || 0) + 1;

  // 维护最近错误列表
  errorStats.recent.unshift(entry);
  if (errorStats.recent.length > MAX_RECENT) {
    errorStats.recent = errorStats.recent.slice(0, MAX_RECENT);
  }

  // 裁剪超出上限的旧记录
  if (trackedErrors.size > MAX_TRACKED) {
    const oldest = [...trackedErrors.entries()]
      .sort(([, a], [, b]) => a.timestamp - b.timestamp)
      .slice(0, trackedErrors.size - MAX_TRACKED);
    for (const [key] of oldest) {
      trackedErrors.delete(key);
    }
  }

  // 严重/高严重性错误额外记录 warning
  if (
    appError.severity === ErrorSeverity.CRITICAL ||
    appError.severity === ErrorSeverity.HIGH
  ) {
    const warnLogger = createLogger({
      level: LogLevel.WARN,
      module: 'error:tracker',
    });
    warnLogger.warn(`High severity error: ${appError.name}`, {
      category: appError.category,
      severity: appError.severity,
      code: appError.code,
      message: appError.message,
    });
  }
}

// ---------------------------------------------------------------------------
// 统一错误处理入口
// ---------------------------------------------------------------------------

/**
 * 统一的错误处理入口函数
 *
 * 所有 catch 块的标准模式：转 AppError → 日志记录 → 内存追踪
 * 替代了之前的 ErrorTracker + ErrorMonitor 两个模块。
 *
 * 注意：EventBus publish 不在此函数内处理，由 setupEventBridges 订阅 handleError
 * 记录的追踪事件后统一转发。
 *
 * @param error 捕获到的错误对象
 * @param options 处理选项
 * @returns 标准化后的 AppError 实例
 */
export async function handleError(
  error: unknown,
  options: HandleErrorOptions
): Promise<AppError> {
  // 1. 转为 AppError（非 AppError 包装为 UNHANDLED_ERROR）
  const appError =
    error instanceof AppError
      ? error
      : new AppError(
          (error as Error)?.message || String(error),
          ErrorCategory.UNKNOWN,
          ErrorSeverity.MEDIUM,
          'UNHANDLED_ERROR',
          { ...options.context, originalType: typeof error }
        );

  // 2. 日志记录
  const logger = createLogger({
    level: LogLevel.ERROR,
    module: options.module,
  });
  logger.error(
    options.action
      ? `[${options.action}] ${appError.message}`
      : appError.message,
    {
      category: appError.category,
      severity: appError.severity,
      code: appError.code,
      context: appError.context,
      errorId: appError.errorId,
    }
  );

  // 3. 内存追踪（内联 ErrorTracker + ErrorMonitor）
  recordError(appError, {
    module: options.module,
    action: options.action || 'unknown',
    ...options.context,
  });

  // 4. OTel Span 错误记录（方案 10：handleError → Span + 采样率）
  //    仅 CRITICAL/HIGH 记录 exception + 设 ERROR 状态
  //    MEDIUM 仅记录 exception，不改变 span 状态
  //    LOW 跳过不记录
  try {
    const tracing = getOTelTracing();
    const activeSpan = tracing.getActiveSpan();
    if (activeSpan && appError.severity !== ErrorSeverity.LOW) {
      const recordErr =
        error instanceof Error ? error : new Error(appError.message);
      if (
        appError.severity === ErrorSeverity.CRITICAL ||
        appError.severity === ErrorSeverity.HIGH
      ) {
        tracing.recordError(activeSpan, recordErr);
      } else {
        // MEDIUM: 仅记录 exception 事件，不改变 span 状态
        activeSpan.addEvent('exception', {
          'exception.message': appError.message,
          'exception.type': appError.code || appError.name,
          'exception.severity': appError.severity,
        });
      }
    }
  } catch (err) {
    // OTel 不可用时不中断主流程
  }

  // 5. CRITICAL/HIGH 错误发布到 EventBus，供告警系统响应
  if (
    appError.severity === ErrorSeverity.CRITICAL ||
    appError.severity === ErrorSeverity.HIGH
  ) {
    try {
      const { globalEventBus } = await import('../core/events/EventBus.js');
      globalEventBus.publish('error:occurred', {
        errorId: appError.errorId,
        category: appError.category,
        severity: appError.severity,
        code: appError.code,
        message: appError.message,
        module: options.module,
        action: options.action,
        timestamp: Date.now(),
      });
    } catch {
      // globalEventBus 不可用时静默跳过（启动早期可能尚未初始化）
    }
  }

  // 6. 可选重新抛出
  if (options.rethrow) {
    throw appError;
  }

  return appError;
}

/**
 * P3-2.11: 获取后端错误统计快照
 * 供 GET /v1/monitoring/errors 端点使用
 */
export function getErrorStats(): {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
  recent: Array<{
    module: string;
    action: string;
    category: string;
    severity: string;
    code: string;
    message: string;
    timestamp: number;
  }>;
} {
  return {
    total: errorStats.total,
    byCategory: { ...errorStats.byCategory },
    bySeverity: { ...errorStats.bySeverity },
    recent: errorStats.recent.slice(0, 20).map((e) => ({
      module: (e.context?.module as string) || 'unknown',
      action: (e.context?.action as string) || 'unknown',
      category: e.error.category,
      severity: e.error.severity,
      code: e.error.code || 'UNHANDLED_ERROR',
      message: e.error.message,
      timestamp: e.timestamp,
    })),
  };
}
