/**
 * Execution 生命周期 —— 错误类型（PR1 / 2026-10-09）
 */
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/core';
import type { AbortReason } from './types';

/**
 * 陈旧执行错误：执行已被顶替/取消/释放（fencing 失败）。
 *
 * 由 `ExecutionLease.assertCurrent()` 与 `ExecutionManager` 的完成/失败路径抛出，
 * 防止"晚到完成"（late completion）改写新执行的 session 状态。
 */
export class StaleExecutionError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      message,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'EXEC_STALE',
      context
    );
    this.name = 'StaleExecutionError';
  }
}

/**
 * 执行中止错误：携带**类型化** `reason`（PR2）。
 *
 * 消费者（如渠道 Router）按 `reason` 判定中止类型，**禁止**再用
 * `error.message.includes('超时…')` 式文案匹配（CS02）。
 */
export class ExecutionAbortedError extends AppError {
  constructor(
    public readonly reason: AbortReason,
    message: string,
    context?: Record<string, unknown>
  ) {
    super(
      message,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'EXEC_ABORTED',
      context
    );
    this.name = 'ExecutionAbortedError';
  }
}

/** 类型守卫：是否为携带原因的 ExecutionAbortedError */
export function isExecutionAbortedError(
  error: unknown
): error is ExecutionAbortedError {
  return error instanceof ExecutionAbortedError;
}
