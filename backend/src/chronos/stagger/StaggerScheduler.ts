/**
 * StaggerScheduler 交错调度器
 * 对标 OpenClaw chronos/stagger/，避免任务同时执行导致资源争抢
 */
import { EventEmitter } from 'node:events';

/**
 * 交错策略
 */
export type StaggerStrategy = 'uniform' | 'random' | 'incremental';

/**
 * 交错任务
 */
export interface StaggerTask {
  id: string;
  name: string;
  execute(): Promise<void>;
}

/**
 * 交错配置
 */
export interface StaggerConfig {
  strategy: StaggerStrategy;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  batchSize: number;
}

/**
 * 交错调度器
 */
export class StaggerScheduler extends EventEmitter {
  private config: StaggerConfig;
  private running: boolean = false;

  constructor(config?: Partial<StaggerConfig>) {
    super();

    this.config = {
      strategy: 'uniform',
      baseDelayMs: 1000,
      maxDelayMs: 60000,
      jitterFactor: 0.2,
      batchSize: 5,
      ...config,
    };
  }

  /**
   * 交错执行一组任务
   */
  async execute(tasks: StaggerTask[]): Promise<void> {
    this.running = true;

    const batches = this.chunkTasks(tasks, this.config.batchSize);

    for (let i = 0; i < batches.length; i++) {
      if (!this.running) {
        break;
      }

      const batch = batches[i];
      const promises = batch.map((task) => this.executeWithDelay(task, i));

      await Promise.all(promises);

      if (i < batches.length - 1) {
        const interBatchDelay = this.calculateDelay(i, batches.length);

        await this.wait(interBatchDelay);
      }
    }

    this.running = false;
  }

  /**
   * 带延迟执行单个任务
   */
  private async executeWithDelay(task: StaggerTask, batchIndex: number): Promise<void> {
    const delay = this.calculateDelay(batchIndex, 0);

    await this.wait(delay);

    this.emit('stagger:execute', { taskId: task.id, taskName: task.name, delay });

    try {
      await task.execute();

      this.emit('stagger:complete', { taskId: task.id, taskName: task.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.emit('stagger:error', { taskId: task.id, taskName: task.name, error: message });
    }
  }

  /**
   * 计算延迟时间
   */
  private calculateDelay(index: number, total: number): number {
    const base = this.config.baseDelayMs;

    switch (this.config.strategy) {
      case 'uniform':
        return base;

      case 'random':
        return Math.random() * this.config.maxDelayMs;

      case 'incremental': {
        const progress = total > 0 ? index / total : 0;

        return Math.min(base + (this.config.maxDelayMs - base) * progress, this.config.maxDelayMs);
      }

      default:
        return base;
    }
  }

  /**
   * 分批任务
   */
  private chunkTasks(tasks: StaggerTask[], size: number): StaggerTask[][] {
    const chunks: StaggerTask[][] = [];

    for (let i = 0; i < tasks.length; i += size) {
      chunks.push(tasks.slice(i, i + size));
    }

    return chunks;
  }

  /**
   * 停止执行
   */
  stop(): void {
    this.running = false;
  }

  /**
   * 更新配置
   */
  setConfig(config: Partial<StaggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * 计算任务的推荐延迟
   */
  getRecommendedDelay(taskIndex: number, totalTasks: number): number {
    return this.calculateDelay(taskIndex, totalTasks);
  }

  /**
   * 等待工具
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const staggerScheduler = new StaggerScheduler();
