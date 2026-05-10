import { Logger } from '../monitoring/logs/Logger';
import { getMonitoringService } from '../monitoring/MonitoringService';

const logger = new Logger({ level: 'info' as any });

export enum TaskPriority {
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
}

export interface Task<T = unknown> {
  id: string;
  name: string;
  priority: TaskPriority;
  execute: (
    signal: AbortSignal,
    onProgress: (pct: number) => void
  ) => Promise<T>;
  timeout?: number;
  retryCount?: number;
  maxRetries?: number;
}

export interface TaskResult<T = unknown> {
  taskId: string;
  success: boolean;
  data?: T;
  error?: string;
  startedAt: number;
  completedAt: number;
  duration: number;
}

interface QueuedTask {
  task: Task;
  resolve: (result: TaskResult) => void;
  controller: AbortController;
  retries: number;
}

export class TaskQueue {
  private queues: Map<TaskPriority, QueuedTask[]>;
  private running: Set<string>;
  private isProcessing: boolean;
  private maxConcurrent: number;

  constructor(maxConcurrent = 4) {
    this.queues = new Map();
    this.running = new Set();
    this.isProcessing = false;
    this.maxConcurrent = maxConcurrent;

    for (const p of Object.values(TaskPriority).filter(
      (v) => typeof v === 'number'
    )) {
      this.queues.set(p as TaskPriority, []);
    }
  }

  submit<T>(task: Task<T>): Promise<TaskResult<T>> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const entry: QueuedTask = {
        task,
        resolve: resolve as (result: TaskResult) => void,
        controller,
        retries: 0,
      };
      this.queues.get(task.priority)?.push(entry);
      logger.info(`任务已提交: ${task.name} (${task.id})`, {
        priority: task.priority,
      });
      this.reportTaskMetrics();
      this.processNext();
    });
  }

  cancel(taskId: string): boolean {
    for (const [, queue] of this.queues) {
      const idx = queue.findIndex((e) => e.task.id === taskId);
      if (idx !== -1) {
        const [entry] = queue.splice(idx, 1);
        entry.controller.abort();
        entry.resolve({
          taskId,
          success: false,
          error: '已取消',
          startedAt: 0,
          completedAt: Date.now(),
          duration: 0,
        });
        logger.info(`任务已取消: ${entry.task.name} (${taskId})`);
        this.reportTaskMetric('daemon.tasks.cancelled', 1);
        this.reportTaskMetrics();
        return true;
      }
    }
    if (this.running.has(taskId)) {
      logger.info(`正在终止运行中的任务: ${taskId}`);
      return true;
    }
    return false;
  }

  getStatus(taskId: string): 'queued' | 'running' | 'not_found' {
    if (this.running.has(taskId)) return 'running';
    for (const [, queue] of this.queues) {
      if (queue.some((e) => e.task.id === taskId)) return 'queued';
    }
    return 'not_found';
  }

  pendingCount(): number {
    let count = 0;
    for (const [, queue] of this.queues) count += queue.length;
    return count;
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    if (this.running.size >= this.maxConcurrent) return;

    this.isProcessing = true;
    try {
      const priorities = [
        TaskPriority.CRITICAL,
        TaskPriority.HIGH,
        TaskPriority.NORMAL,
        TaskPriority.LOW,
      ];
      for (const p of priorities) {
        const queue = this.queues.get(p);
        if (!queue || queue.length === 0) continue;
        const available = this.maxConcurrent - this.running.size;
        const batch = queue.splice(0, available);
        for (const entry of batch) {
          this.executeTask(entry);
        }
        if (this.running.size >= this.maxConcurrent) break;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeTask(entry: QueuedTask): Promise<void> {
    const { task, resolve, controller, retries } = entry;
    this.running.add(task.id);
    const startedAt = Date.now();

    try {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = task.timeout ?? 30000;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`任务超时 (${timeout}ms)`)),
          timeout
        );
      });

      const result = await Promise.race([
        task.execute(controller.signal, (pct: number) => {
          logger.info(`任务进度: ${task.name} (${task.id})`, { progress: pct });
        }),
        timeoutPromise,
      ]);

      clearTimeout(timeoutId);
      this.running.delete(task.id);
      resolve({
        taskId: task.id,
        success: true,
        data: result,
        startedAt,
        completedAt: Date.now(),
        duration: Date.now() - startedAt,
      });
      logger.info(`任务完成: ${task.name} (${task.id})`);
      this.reportTaskMetric('daemon.tasks.completed', 1);
      this.reportTaskMetrics();
    } catch (error) {
      this.running.delete(task.id);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (retries < (task.maxRetries ?? 0)) {
        logger.warning(`任务失败，即将重试: ${task.name} (${task.id})`, {
          error: errMsg,
          retry: retries + 1,
        });
        const newEntry: QueuedTask = {
          task,
          resolve,
          controller: new AbortController(),
          retries: retries + 1,
        };
        this.queues.get(task.priority)?.unshift(newEntry);
        setTimeout(() => this.processNext(), 1000 * (retries + 1));
      } else {
        resolve({
          taskId: task.id,
          success: false,
          error: errMsg,
          startedAt,
          completedAt: Date.now(),
          duration: Date.now() - startedAt,
        });
        logger.error(`任务失败: ${task.name} (${task.id})`, error as Error);
        this.reportTaskMetric('daemon.tasks.failed', 1);
        this.reportTaskMetrics();
      }
    }
    this.processNext();
  }

  private reportTaskMetric(name: string, value: number): void {
    try {
      getMonitoringService().addMetric(name, value);
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }

  private reportTaskMetrics(): void {
    try {
      const monitoring = getMonitoringService();
      monitoring.addMetric('daemon.tasks.pending', this.pendingCount());
      monitoring.addMetric('daemon.tasks.running', this.running.size);
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }
}
