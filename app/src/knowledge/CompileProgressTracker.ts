/**
 * CompileProgressTracker — 编译进度追踪器 (Phase 3 W9)
 *
 * 轻量级模块级单例，用于 KnowledgeCompiler 报告进度，
 * HTTP 端点查询当前状态。
 */
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
}

/** 更新进度 */
export function updateCompileProgress(current: number, error?: string): void {
  currentProgress.current = current;
  if (error) currentProgress.lastError = error;
}

/** 编译完成 */
export function finishCompileProgress(): void {
  currentProgress.status = 'done';
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
}

/** 获取当前进度（供 HTTP 端点使用） */
export function getCompileProgress(): CompileProgress {
  return { ...currentProgress };
}
