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
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

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

/**
 * 统一的错误处理入口函数
 * 所有 catch 块的标准模式：转 AppError → 日志记录 → ErrorTracker 记录
 *
 * 注意：EventBus publish 不在此函数内处理，由阶段二桥接层订阅 ErrorTracker 事件统一转发
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
  const appError = error instanceof AppError
    ? error
    : new AppError(
        (error as Error)?.message || String(error),
        ErrorCategory.UNKNOWN,
        ErrorSeverity.MEDIUM,
        'UNHANDLED_ERROR',
        { ...options.context, originalType: typeof error }
      );

  // 2. 日志记录（每次 new Logger，module 必传）
  const logger = new Logger({ level: LogLevel.ERROR, module: options.module });
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

  // 3. ErrorTracker 记录（动态 import，避免循环依赖）
  try {
    const { errorTracker } = await import('./tracker/ErrorTracker');
    errorTracker.track(appError, {
      module: options.module,
      action: options.action || 'unknown',
      ...options.context,
    });
  } catch {
    // ErrorTracker 不可用时静默降级
  }

  // 4. EventBus publish 不在 handleError 内做
  //    原因：①消除对 core/events 的硬依赖 ②避免循环依赖
  //    替代：ErrorTracker 记录后，由阶段二桥接层订阅 ErrorTracker 事件 → publish 到 globalEventBus
  //    参见 §2.2 事件体系重构 → setupEventBridges.ts

  // 5. 可选重新抛出
  if (options.rethrow) {
    throw appError;
  }

  return appError;
}