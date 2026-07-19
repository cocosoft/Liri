/**
 * 统一并行执行器
 * 提供并发控制、超时管理、错误隔离的并行任务执行能力
 */

/**
 * 并行任务选项
 */
import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:executor:ParallelExecutor',
  level: LogLevel.INFO,
});

export interface ParallelTask<T> {
  execute: () => Promise<T>;
  timeout?: number;
}

/**
 * 并行执行结果
 */
export interface TaskResult<T> {
  index: number;
  data?: T;
  error?: Error;
  executionTime: number;
}

/**
 * 并行执行器配置
 */
export interface ParallelExecutorOptions {
  maxConcurrency?: number;
  defaultTimeout?: number;
}

/**
 * 统一并行执行器
 */
export class ParallelExecutor {
  private maxConcurrency: number;
  private defaultTimeout: number;

  constructor(options: ParallelExecutorOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 5;
    this.defaultTimeout = options.defaultTimeout ?? 0;
  }

  /**
   * 并行执行一组任务，支持并发数限制和超时控制
   * @param tasks 任务数组
   * @param options 执行选项
   * @returns 任务执行结果数组
   */
  async execute<T>(
    tasks: Array<ParallelTask<T>>,
    options?: { maxConcurrency?: number; defaultTimeout?: number }
  ): Promise<TaskResult<T>[]> {
    const concurrency = options?.maxConcurrency ?? this.maxConcurrency;
    const timeout = options?.defaultTimeout ?? this.defaultTimeout;
    const results: TaskResult<T>[] = [];
    const executing: Promise<void>[] = [];
    const taskQueue = [...tasks];
    let nextIndex = 0;

    const runTask = async (
      task: ParallelTask<T>,
      index: number
    ): Promise<void> => {
      const startTime = Date.now();
      try {
        const execution = task.execute();
        const timedPromise =
          timeout > 0
            ? Promise.race([
                execution,
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () =>
                      reject(new Error(`Task timed out after ${timeout}ms`)),
                    timeout
                  )
                ),
              ])
            : execution;

        const data = await timedPromise;
        results.push({ index, data, executionTime: Date.now() - startTime });
      } catch (error) {
        results.push({
          index,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTime: Date.now() - startTime,
        });
      }
    };

    const scheduleNext = (): Promise<void> | null => {
      if (taskQueue.length === 0) return null;
      const task = taskQueue.shift()!;
      const index = nextIndex++;
      const promise = runTask(task, index).finally(() => {
        const idx = executing.indexOf(promise);
        if (idx !== -1) executing.splice(idx, 1);
        scheduleNext();
      });
      executing.push(promise);
      return promise;
    };

    const initialCount = Math.min(concurrency, taskQueue.length);
    const initialPromises: Promise<void>[] = [];
    for (let i = 0; i < initialCount; i++) {
      const promise = scheduleNext();
      if (promise) initialPromises.push(promise);
    }

    await Promise.all(initialPromises);
    results.sort((a, b) => a.index - b.index);
    return results;
  }

  /**
   * 并行执行任务，返回成功的数据数组（忽略失败的任务）
   * @param tasks 任务数组
   * @param options 执行选项
   * @returns 成功执行的数据数组
   */
  async executeAllSettled<T>(
    tasks: Array<ParallelTask<T>>,
    options?: { maxConcurrency?: number; defaultTimeout?: number }
  ): Promise<T[]> {
    const results = await this.execute(tasks, options);
    return results
      .filter((r): r is TaskResult<T> & { data: T } => r.data !== undefined)
      .map((r) => r.data);
  }

  /**
   * 设置最大并发数
   */
  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }

  /**
   * 设置默认超时
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }
}

let defaultExecutor: ParallelExecutor | null = null;

/**
 * 获取全局默认并行执行器实例
 */
export function getParallelExecutor(): ParallelExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new ParallelExecutor();
  }
  return defaultExecutor;
}
