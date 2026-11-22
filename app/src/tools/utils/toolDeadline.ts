// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolDeadline — 工具执行的**统一超时 + 取消**（F5，2026-11-22）
 *
 * 背景（二次复查）：超时只存在于 chat 链（`withToolTimeout`），且是纯 `Promise.race`
 * —— 超时后**底层工具继续运行**（幽灵执行）；Registry / ToolManager / LRO 等入口
 * 完全没有超时。
 *
 * 本模块提供唯一实现：
 * - 超时 ⇒ abort 派生 controller（工具收到取消）并 reject `TOOL_EXEC_TIMEOUT`；
 * - 父取消（用户取消 / 整轮取消）转发到派生 controller；
 * - 不改调用方传入的 controller ⇒ 不会误取消整轮。
 *
 * 位于 app 层（而非 infra）：调用方全在 app，且避免 infra 内部 SCC 环棘轮（R7）。
 */

import { configManager } from '@openliri/infra/config';
import { DEFAULT_TOOL_EXEC_TIMEOUT_MS } from '@openliri/infra/constants';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';

/** 解析 `TOOL_EXEC_TIMEOUT_MS`（非法/缺省 ⇒ 常量真源） */
export function resolveToolExecTimeoutMs(): number {
  const raw = parseInt(configManager.env('TOOL_EXEC_TIMEOUT_MS') || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TOOL_EXEC_TIMEOUT_MS;
}

export interface ToolDeadlineOptions {
  timeoutMs?: number;
  /** 父取消信号（用户取消 / 整轮取消） */
  parentSignal?: AbortSignal;
  /** 超时回调（仅观测，不改变判定） */
  onTimeout?: (timeoutMs: number) => void;
}

/**
 * 在超时与父取消约束下执行一次工具调用。
 *
 * @param run 收到**派生 controller**（应传给工具的 `context.abortController`）
 */
export async function runWithToolDeadline<T>(
  run: (controller: AbortController) => Promise<T>,
  options: ToolDeadlineOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? resolveToolExecTimeoutMs();
  const parent = options.parentSignal;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) controller.abort(parent.reason);
  else parent?.addEventListener('abort', forwardAbort, { once: true });

  const runPromise = run(controller);
  // 超时后底层仍可能迟到 reject ⇒ 显式吞掉（避免 unhandledRejection，不影响 race 结果）
  runPromise.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new AppError(
        `工具执行超时（${timeoutMs}ms）`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.MEDIUM,
        'TOOL_EXEC_TIMEOUT'
      );
      options.onTimeout?.(timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
    parent?.removeEventListener('abort', forwardAbort);
  }
}
