/**
 * 内存预取队列
 * 异步预取记忆向量嵌入，减少搜索延迟
 * 支持优先级排序、并发限制、批量处理、自动重试
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'memory:services:memoryPrefetchQueue',
  level: LogLevel.INFO,
});

/**
 * 预取队列配置
 */
export interface PrefetchQueueConfig {
  maxConcurrency: number;
  batchSize: number;
  prefetchIntervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * 预取任务
 */
interface PrefetchTask {
  id: string;
  priority: number;
  enqueueTime: number;
  retries: number;
  execute: () => Promise<void>;
}

/**
 * 默认预取配置
 */
const DEFAULT_PREFETCH_CONFIG: PrefetchQueueConfig = {
  maxConcurrency: 3,
  batchSize: 5,
  prefetchIntervalMs: 5000,
  maxRetries: 2,
  retryDelayMs: 1000,
};

/**
 * 记忆预取队列
 * 异步预取记忆向量嵌入到缓存中
 * 支持按优先级排队和并发控制
 */
export class MemoryPrefetchQueue {
  private queue: PrefetchTask[] = [];
  private running: Set<string> = new Set();
  private config: PrefetchQueueConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(config?: Partial<PrefetchQueueConfig>) {
    this.config = { ...DEFAULT_PREFETCH_CONFIG, ...config };
  }

  /**
   * 入队一个预取任务
   */
  enqueue(
    id: string,
    execute: () => Promise<void>,
    priority: number = 0
  ): void {
    if (this.running.has(id)) return;
    const existing = this.queue.findIndex((t) => t.id === id);
    if (existing !== -1) {
      if (this.queue[existing].priority >= priority) return;
      this.queue.splice(existing, 1);
    }
    this.queue.push({
      id,
      priority,
      enqueueTime: Date.now(),
      retries: 0,
      execute,
    });
    this.sortQueue();
  }

  /**
   * 批量入队预取任务
   */
  enqueueBatch(
    items: Array<{ id: string; priority: number }>,
    executor: (id: string) => Promise<void>
  ): void {
    for (const item of items) {
      this.enqueue(item.id, () => executor(item.id), item.priority);
    }
  }

  /**
   * 启动定时处理
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processNext().catch(() => {});
    }, this.config.prefetchIntervalMs);
    this.processNext().catch(() => {});
  }

  /**
   * 停止定时处理
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 队列大小
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * 当前运行的任务数
   */
  get activeCount(): number {
    return this.running.size;
  }

  /**
   * 是否空闲
   */
  get idle(): boolean {
    return this.queue.length === 0 && this.running.size === 0;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PrefetchQueueConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 处理下一个批次
   */
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (
        this.queue.length > 0 &&
        this.running.size < this.config.maxConcurrency
      ) {
        const available = this.config.maxConcurrency - this.running.size;
        const batchSize = Math.min(
          available,
          this.config.batchSize,
          this.queue.length
        );
        if (batchSize <= 0) break;

        const batch = this.queue.splice(0, batchSize);
        const promises = batch.map((task) => this.runTask(task));
        await Promise.allSettled(promises);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 执行单个预取任务
   */
  private async runTask(task: PrefetchTask): Promise<void> {
    this.running.add(task.id);

    try {
      await task.execute();
      logger.debug(`预取完成: ${task.id}`);
    } catch (error) {
      if (task.retries < this.config.maxRetries) {
        task.retries++;
        const delay = this.config.retryDelayMs * Math.pow(2, task.retries - 1);
        logger.warn(
          `预取失败，将重试 (${task.retries}/${this.config.maxRetries}): ${task.id}`,
          {
            delay,
            error: String(error),
          }
        );
        setTimeout(() => {
          this.queue.push(task);
          this.sortQueue();
          this.processNext().catch(() => {});
        }, delay);
      } else {
        logger.warn(`预取失败，已达最大重试次数: ${task.id}`, {
          error: String(error),
        });
      }
    } finally {
      this.running.delete(task.id);
    }
  }

  /**
   * 按优先级排序（高优先级优先）
   */
  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return a.enqueueTime - b.enqueueTime;
    });
  }
}
