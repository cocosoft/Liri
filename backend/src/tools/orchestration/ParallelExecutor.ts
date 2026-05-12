/**
 * ParallelExecutor — 并行工具执行器
 *
 * 支持并发度控制、结果收集、错误隔离。
 * 每个工具在独立上下文中执行，互不干扰。
 *
 * 用法:
 * ```
 * const executor = new ParallelExecutor({ maxConcurrency: 3 });
 * const results = await executor.run([
 *   () => tool1.execute(input1),
 *   () => tool2.execute(input2),
 *   () => tool3.execute(input3),
 * ]);
 * ```
 */

/**
 * 并行执行结果
 */
export interface ParallelTaskResult<T = unknown> {
  index: number;
  status: 'fulfilled' | 'rejected';
  value?: T;
  error?: unknown;
}

/**
 * ParallelExecutor 配置
 */
export interface ParallelExecutorOptions {
  maxConcurrency?: number;
}

const DEFAULT_MAX_CONCURRENCY = 5;

export class ParallelExecutor {
  private maxConcurrency: number;

  constructor(options: ParallelExecutorOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  }

  /**
   * 并发执行一组任务，受 maxConcurrency 限制
   */
  async run<T>(tasks: (() => Promise<T>)[]): Promise<ParallelTaskResult<T>[]> {
    const results: ParallelTaskResult<T>[] = [];
    let nextIndex = 0;

    const runNext = async (): Promise<void> => {
      while (nextIndex < tasks.length) {
        const currentIndex = nextIndex++;
        try {
          const value = await tasks[currentIndex]();
          results[currentIndex] = { index: currentIndex, status: 'fulfilled', value };
        } catch (error) {
          results[currentIndex] = { index: currentIndex, status: 'rejected', error };
        }
      }
    };

    const workers: Promise<void>[] = [];
    const concurrency = Math.min(this.maxConcurrency, tasks.length);

    for (let i = 0; i < concurrency; i++) {
      workers.push(runNext());
    }

    await Promise.all(workers);

    return results;
  }

  /**
   * 并发执行并只返回成功的结果
   */
  async runFulfilled<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
    const results = await this.run(tasks);
    return results
      .filter((r): r is ParallelTaskResult<T> & { status: 'fulfilled' } => r.status === 'fulfilled')
      .map((r) => r.value as T);
  }

  /**
   * 执行并抛出第一个错误（类似 Promise.all 语义）
   */
  async runAll<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
    const results = await this.run(tasks);

    const firstError = results.find((r) => r.status === 'rejected');
    if (firstError) {
      throw firstError.error;
    }

    return results.map((r) => (r as ParallelTaskResult<T> & { status: 'fulfilled' }).value as T);
  }

  /**
   * 更新并发度
   */
  setConcurrency(limit: number): void {
    this.maxConcurrency = Math.max(1, limit);
  }

  /**
   * 获取当前并发度
   */
  getConcurrency(): number {
    return this.maxConcurrency;
  }
}
