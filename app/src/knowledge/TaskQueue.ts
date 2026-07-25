// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TaskQueue — 简单异步任务队列
 *
 * 用于知识编译、FAQ 批量导入、数据迁移等耗时操作。
 * 基于 Node.js async/await，无需外部依赖。
 *
 * 特性：
 *   - 可配置并发数（默认 1，顺序执行）
 *   - 进度回调
 *   - 任务状态追踪（pending/running/done/failed/cancelled）
 *   - 支持取消所有待执行任务
 *   - v1.1: queueId → SSE 实时推送进度
 */

import { broadcastEvent } from '@modules/infrastructure/http/LocalHTTPServiceSSE.js';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface QueueTask<T = unknown> {
  /** 任务唯一 ID */
  id: string;
  /** 任务描述（用于日志和 UI 展示） */
  description: string;
  /** 任务执行函数 */
  execute: () => Promise<T>;
  /** 执行结果 */
  result?: T;
  /** 错误信息 */
  error?: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 开始时间 */
  startedAt?: number;
  /** 完成时间 */
  completedAt?: number;
}

export interface TaskQueueOptions {
  /** 最大并发数，默认 1 */
  concurrency?: number;
  /** 进度回调 */
  onProgress?: (state: QueueState) => void;
  /** 单个任务完成回调 */
  onTaskDone?: (task: QueueTask) => void;
  /** 队列标识（设置后启用 SSE 进度推送） */
  queueId?: string;
}

export interface QueueState {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  tasks: ReadonlyArray<QueueTask>;
}

export class TaskQueue {
  private tasks: QueueTask[] = [];
  private concurrency: number;
  private onProgress?: (state: QueueState) => void;
  private onTaskDone?: (task: QueueTask) => void;
  private cancelled = false;
  private runningCount = 0;
  private queueId?: string;

  constructor(options: TaskQueueOptions = {}) {
    this.concurrency = options.concurrency ?? 1;
    this.onProgress = options.onProgress;
    this.onTaskDone = options.onTaskDone;
    this.queueId = options.queueId;
  }

  /** 添加任务 */
  enqueue<T = unknown>(
    id: string,
    description: string,
    execute: () => Promise<T>
  ): QueueTask<T> {
    const task: QueueTask<T> = {
      id,
      description,
      execute,
      status: 'pending',
    };
    this.tasks.push(task as QueueTask);
    this.notifyProgress();
    return task;
  }

  /** 批量添加任务 */
  enqueueBatch<T = unknown>(
    items: Array<{ id: string; description: string; execute: () => Promise<T> }>
  ): QueueTask<T>[] {
    return items.map((item) =>
      this.enqueue(item.id, item.description, item.execute)
    );
  }

  /** 获取当前状态 */
  getState(): QueueState {
    let pending = 0,
      done = 0,
      failed = 0,
      cancelled = 0;
    for (const t of this.tasks) {
      switch (t.status) {
        case 'pending':
          pending++;
          break;
        case 'done':
          done++;
          break;
        case 'failed':
          failed++;
          break;
        case 'cancelled':
          cancelled++;
          break;
      }
    }
    return {
      total: this.tasks.length,
      pending,
      running: this.runningCount,
      done,
      failed,
      cancelled,
      tasks: this.tasks,
    };
  }

  /** 取消所有待执行任务 */
  cancelAll(): void {
    this.cancelled = true;
    for (const task of this.tasks) {
      if (task.status === 'pending') {
        task.status = 'cancelled';
      }
    }
    this.notifyProgress();
  }

  /** 获取指定任务 */
  getTask(id: string): QueueTask | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** 启动执行 */
  async run(): Promise<QueueState> {
    this.cancelled = false;

    // 按顺序取任务，支持并发
    const pending = () => this.tasks.filter((t) => t.status === 'pending');

    const runNext = async (): Promise<void> => {
      if (this.cancelled) return;

      const candidates = pending();
      if (candidates.length === 0) return;

      const task = candidates[0]!;
      task.status = 'running';
      task.startedAt = Date.now();
      this.runningCount++;
      this.notifyProgress();

      try {
        task.result = await task.execute();
        task.status = 'done';
      } catch (err) {
        task.error = (err as Error).message;
        task.status = 'failed';
      } finally {
        task.completedAt = Date.now();
        this.runningCount--;
        this.onTaskDone?.(task);
        this.notifyProgress();
        // 继续下一个
        await runNext();
      }
    };

    // 启动 concurrency 个并发 runner
    const runners = [];
    for (let i = 0; i < this.concurrency; i++) {
      runners.push(runNext());
    }
    await Promise.all(runners);

    return this.getState();
  }

  private notifyProgress(): void {
    const state = this.getState();
    this.onProgress?.(state);
    if (this.queueId) {
      try {
        broadcastEvent('task:queue:progress', { queueId: this.queueId, state });
      } catch {
        /* SSE 不可用 */
      }
    }
  }
}
