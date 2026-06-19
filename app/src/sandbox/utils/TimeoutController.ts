/**
 * 超时控制器
 * 实现命令执行超时控制
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 超时错误
 */
export class TimeoutError extends AppError {
  public readonly timeoutMs: number;
  public readonly command?: string;

  constructor(message: string, timeoutMs: number, command?: string) {
    super(message, ErrorCategory.OPERATION, ErrorSeverity.HIGH);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.command = command;
  }
}

/**
 * 执行结果
 */
export interface ExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  exitCode?: number;
  durationMs: number;
  timedOut: boolean;
}

/**
 * 超时控制器
 */
export class TimeoutController {
  private timeoutId: NodeJS.Timeout | null = null;
  private aborted = false;
  private startTime = 0;

  /**
   * 创建超时控制器
   * @param timeoutMs 超时毫秒数
   * @param onTimeout 超时回调
   */
  constructor(
    private timeoutMs: number,
    private onTimeout?: () => void
  ) {}

  /**
   * 开始计时
   */
  public start(): void {
    this.startTime = Date.now();
    this.aborted = false;

    this.timeoutId = setTimeout(() => {
      this.handleTimeout();
    }, this.timeoutMs);
  }

  /**
   * 处理超时
   */
  private handleTimeout(): void {
    if (this.aborted) {
      return;
    }

    this.aborted = true;

    if (this.onTimeout) {
      this.onTimeout();
    }
  }

  /**
   * 检查是否已超时
   */
  public isTimeout(): boolean {
    if (this.aborted) {
      return true;
    }

    const elapsed = Date.now() - this.startTime;
    return elapsed >= this.timeoutMs;
  }

  /**
   * 获取已用时间
   */
  public getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 获取剩余时间
   */
  public getRemainingMs(): number {
    const elapsed = Date.now() - this.startTime;
    return Math.max(0, this.timeoutMs - elapsed);
  }

  /**
   * 停止计时器
   */
  public stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * 中止操作
   */
  public abort(): void {
    this.aborted = true;
    this.stop();
  }

  /**
   * 获取中止信号
   */
  public getAbortSignal(): AbortSignal {
    const controller = this;
    return {
      aborted: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      onabort: null,
      toString: () => '[object AbortSignal]',
    } as unknown as AbortSignal;
  }
}

/**
 * 带超时执行异步函数
 * @param fn 异步函数
 * @param timeoutMs 超时毫秒数
 * @param command 命令字符串（用于错误信息）
 * @returns 执行结果
 */
export async function executeWithTimeout<T>(
  fn: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  command?: string
): Promise<ExecutionResult<T>> {
  const startTime = Date.now();
  let timedOut = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const abortController = new AbortController();

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      reject(new TimeoutError('命令执行超时', timeoutMs, command));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      fn(abortController.signal),
      timeoutPromise,
    ]);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return {
      success: true,
      data: result,
      durationMs: Date.now() - startTime,
      timedOut: false,
    };
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (timedOut) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '命令执行超时',
        durationMs: Date.now() - startTime,
        timedOut: true,
      };
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
      timedOut: false,
    };
  }
}

/**
 * 创建超时选项
 */
export interface TimeoutOptions {
  timeoutMs: number;
  onTimeout?: () => void;
  command?: string;
}

/**
 * 默认超时配置
 */
export const DEFAULT_TIMEOUT_MS = 300000;

/**
 * 创建默认超时控制器
 */
export function createTimeoutController(
  options?: Partial<TimeoutOptions>
): TimeoutController {
  return new TimeoutController(
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    options?.onTimeout
  );
}
