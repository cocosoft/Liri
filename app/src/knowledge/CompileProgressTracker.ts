/**
 * CompileProgressTracker — 编译进度追踪器 (Phase 3 W9)
 *
 * 轻量级模块级单例，用于 KnowledgeCompiler 报告进度，
 * HTTP 端点查询当前状态。
 * v1.1: 接入 SSE 实时推送，每次进度更新广播到前端。
 */

import { broadcastEvent } from '@modules/infrastructure/http/LocalHTTPServiceSSE.js';

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
}

let currentProgress: CompileProgress = {
  status: 'idle',
  current: 0,
  total: 0,
  startedAt: 0,
  lastError: null,
};

/** 开始新一轮编译 */
export function startCompileProgress(total: number): void {
  currentProgress = {
    status: 'compiling',
    current: 0,
    total,
    startedAt: Date.now(),
    lastError: null,
  };
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
export function finishCompileProgress(): void {
  currentProgress.status = 'done';
  try {
    broadcastEvent('knowledge:compile:completed', {
      total: currentProgress.total,
      durationMs: Date.now() - currentProgress.startedAt,
    });
  } catch {
    /* SSE 不可用 */
  }
  // 30 秒后重置为 idle
  setTimeout(() => {
    if (currentProgress.status === 'done') {
      currentProgress = {
        status: 'idle',
        current: 0,
        total: 0,
        startedAt: 0,
        lastError: null,
      };
    }
  }, 30000);
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
