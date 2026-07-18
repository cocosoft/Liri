import { Logger, LogLevel } from '@modules/monitoring';
import { getMonitoringService } from '../monitoring/MonitoringService';
import type { QueueBackend, QueuedTaskEntry } from './QueueBackend';
import { InMemoryQueueBackend } from './QueueBackend';
import { TaskPriority } from './TaskPriority';
import type { Task, TaskResult } from './types';

const logger = new Logger({ module: 'daemon:taskQueue', level: LogLevel.INFO });

export { TaskPriority };
export type { Task, TaskResult };

export class TaskQueue {
  private backend: QueueBackend;
  private running: Set<string>;
  private isProcessing: boolean;
  private maxConcurrent: number;

  constructor(maxConcurrent = 4, backend?: QueueBackend) {
    this.backend = backend ?? new InMemoryQueueBackend();
    this.running = new Set();
    this.isProcessing = false;
    this.maxConcurrent = maxConcurrent;
  }

  getBackend(): QueueBackend {
    return this.backend;
  }

  setBackend(backend: QueueBackend): void {
    this.backend = backend;
  }

  submit<T>(task: Task<T>): Promise<TaskResult<T>> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const entry: QueuedTaskEntry = {
        task,
        resolve: resolve as (result: TaskResult) => void,
        controller,
        retries: 0,
      };
      this.backend.enqueue(entry, task.priority);
      logger.info(`任务已提交: ${task.name} (${task.id})`, {
        priority: task.priority,
      });
      this.reportTaskMetrics();
      this.processNext();
    });
  }

  cancel(taskId: string): boolean {
    const entry = this.backend.remove(taskId);
    if (entry) {
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
    if (this.running.has(taskId)) {
      logger.info(`正在终止运行中的任务: ${taskId}`);
      return true;
    }
    return false;
  }

  getStatus(taskId: string): 'queued' | 'running' | 'not_found' {
    if (this.running.has(taskId)) return 'running';
    if (this.backend.contains(taskId)) return 'queued';
    return 'not_found';
  }

  pendingCount(): number {
    return this.backend.pendingCount();
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
        const available = this.maxConcurrent - this.running.size;
        if (available <= 0) break;
        for (let i = 0; i < available; i++) {
          const entry = this.backend.dequeue(p);
          if (!entry) break;
          this.executeTask(entry);
        }
        if (this.running.size >= this.maxConcurrent) break;
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeTask(entry: QueuedTaskEntry): Promise<void> {
    const { task, resolve, controller, retries } = entry;
    this.running.add(task.id);
    const startedAt = Date.now();

    try {
      let timeoutId: ReturnType<typeof setInterval> | undefined;
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
        const newEntry: QueuedTaskEntry = {
          task,
          resolve,
          controller: new AbortController(),
          retries: retries + 1,
        };
        this.backend.enqueue(newEntry, task.priority);
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
    } catch (err) {
      // MonitoringService not available, skip metric reporting
    }
  }

  private reportTaskMetrics(): void {
    try {
      const monitoring = getMonitoringService();
      monitoring.addMetric('daemon.tasks.pending', this.pendingCount());
      monitoring.addMetric('daemon.tasks.running', this.running.size);
    } catch (err) {
      // MonitoringService not available, skip metric reporting
    }
  }
}
