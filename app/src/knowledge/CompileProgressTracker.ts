/**
 * CompileProgressTracker — 编译进度追踪器 (Phase 3 W9)
 *
 * 轻量级模块级单例，用于 KnowledgeCompiler 报告进度，
 * HTTP 端点查询当前状态。
 * v1.1: 接入 SSE 实时推送，每次进度更新广播到前端。
 */

import { broadcastEvent } from '@modules/infrastructure';
import { PROGRESS_BROADCAST_MIN_INTERVAL_MS } from './defaults';

export interface CompileProgress {
  /** 当前状态：idle / compiling / done */
  status: 'idle' | 'compiling' | 'done';
  /** 当前已编译/跳过的文件数 */
  current: number;
  /** 总文件数 */
  total: number;
  /** 开始时间戳 */
  startedAt: number;
  /** 最近一次错误信息 */
  lastError: string | null;
  /**
   * 编译结果摘要（done 后返回，供前端展示）
   * KB-COMPILE-ASYNC（2026-08-28）
   */
  result: {
    compiled: number;
    skipped: number;
    errors: number;
  } | null;
}

let currentProgress: CompileProgress = {
  status: 'idle',
  current: 0,
  total: 0,
  startedAt: 0,
  lastError: null,
  result: null,
};

/**
 * K8（2026-11-26）：进度 SSE 广播按 `PROGRESS_BROADCAST_MIN_INTERVAL_MS` 节流。
 *
 * 编译循环对**每个** raw 文件调用一次 `updateCompileProgress`（真机 593 次/轮），
 * 逐次广播 ⇒ SSE/EventBus 上每轮 593 个事件，而前端只用来渲染 `current/total`。
 * 节流只降低**广播**频率：内存里的 `current` 仍然每次都更新
 * （`GET /v1/knowledge/compile-status` 精度不变）。
 */

/** 上次广播时间戳（`startCompileProgress` 重置；跨轮不继承） */
let lastBroadcastAt = 0;

/**
 * 是否应把本次进度广播出去（纯函数，便于单测）。
 *
 * - 带错误 ⇒ 必须广播（失败要即时可见）；
 * - 走到最后一个文件 ⇒ 必须广播（前端据此显示 N/N 再等 completed）；
 * - 其余按最小间隔节流。
 */
export function shouldBroadcastProgress(args: {
  current: number;
  total: number;
  lastBroadcastAt: number;
  now: number;
  hasError: boolean;
  minIntervalMs?: number;
}): boolean {
  if (args.hasError) return true;
  if (args.total > 0 && args.current >= args.total) return true;
  const interval = args.minIntervalMs ?? PROGRESS_BROADCAST_MIN_INTERVAL_MS;
  return args.now - args.lastBroadcastAt >= interval;
}

/** 开始新一轮编译 */
export function startCompileProgress(total: number): void {
  currentProgress = {
    status: 'compiling',
    current: 0,
    total,
    startedAt: Date.now(),
    lastError: null,
    result: null,
  };
  lastBroadcastAt = 0;
  try {
    broadcastEvent('knowledge:compile:started', { total });
  } catch {
    /* SSE 不可用，不影响编译 */
  }
}

/** 更新进度 */
export function updateCompileProgress(current: number, error?: string): void {
  currentProgress.current = current;
  if (error) currentProgress.lastError = error;

  const now = Date.now();
  const shouldBroadcast = shouldBroadcastProgress({
    current,
    total: currentProgress.total,
    lastBroadcastAt,
    now,
    hasError: Boolean(error),
  });
  if (!shouldBroadcast) return;
  lastBroadcastAt = now;

  try {
    broadcastEvent('knowledge:compile:progress', {
      current,
      total: currentProgress.total,
      error: error ?? null,
    });
  } catch {
    /* SSE 不可用 */
  }
}

/** 编译完成 */
export function finishCompileProgress(result?: {
  compiled: number;
  skipped: number;
  errors: number;
}): void {
  currentProgress.status = 'done';
  currentProgress.result = result ?? null;
  try {
    broadcastEvent('knowledge:compile:completed', {
      total: currentProgress.total,
      result,
      durationMs: Date.now() - currentProgress.startedAt,
    });
  } catch {
    /* SSE 不可用 */
  }
  // 60 秒后重置为 idle（前端轮询完成/超时后恢复，避免过早重置导致结果丢失）
  setTimeout(() => {
    if (currentProgress.status === 'done') {
      currentProgress = {
        status: 'idle',
        current: 0,
        total: 0,
        startedAt: 0,
        lastError: null,
        result: null,
      };
    }
  }, 60000);
}

/** 编译异常中止 */
export function abortCompileProgress(error: string): void {
  currentProgress.status = 'done';
  currentProgress.lastError = error;
  try {
    broadcastEvent('knowledge:compile:aborted', { error });
  } catch {
    /* SSE 不可用 */
  }
}

/** 获取当前进度（供 HTTP 端点使用） */
export function getCompileProgress(): CompileProgress {
  return { ...currentProgress };
}
