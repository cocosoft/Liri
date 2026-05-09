/**
 * 工作池
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 任务接口
 */
export interface Task {
  /**
   * 任务ID
   */
  id: string;

  /**
   * 执行函数
   */
  execute: () => Promise<any>;

  /**
   * 取消函数
   */
  cancel?: () => void;
}

/**
 * 工作池配置
 */
export interface WorkerPoolConfig {
  /**
   * 最大工作线程数
   */
  maxWorkers: number;

  /**
   * 任务队列大小
   */
  queueSize: number;

  /**
   * 任务超时（毫秒）
   */
  taskTimeout: number;
}

/**
 * 工作池
 */
export class WorkerPool {
  private config: WorkerPoolConfig;
  private workers: number = 0;
  private taskQueue: Task[] = [];
  private runningTasks: Map<string, Task> = new Map();
  private taskCounter: number = 0;

  /**
   * 构造函数
   */
  constructor(
    config: WorkerPoolConfig = {
      maxWorkers: Math.max(1, Math.floor(require('os').cpus().length / 2)),
      queueSize: 100,
      taskTimeout: 30000,
    }
  ) {
    this.config = config;
  }

  /**
   * 提交任务
   */
  async submit(task: Omit<Task, 'id'>): Promise<any> {
    const id = `task-${++this.taskCounter}-${Date.now()}`;
    const fullTask: Task = {
      ...task,
      id,
    };

    return new Promise((resolve, reject) => {
      if (this.taskQueue.length >= this.config.queueSize) {
        reject(new Error('Task queue is full'));
        return;
      }

      const wrappedTask: Task = {
        ...fullTask,
        execute: async () => {
          try {
            const result = await fullTask.execute();
            resolve(result);
            return result;
          } catch (error) {
            reject(error);
            throw error;
          } finally {
            this.runningTasks.delete(id);
            this.processQueue();
          }
        },
      };

      this.taskQueue.push(wrappedTask);
      this.processQueue();
    });
  }

  /**
   * 处理任务队列
   */
  private processQueue(): void {
    while (this.workers < this.config.maxWorkers && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      if (!task) {
        break;
      }

      this.workers++;
      this.runningTasks.set(task.id, task);

      // 执行任务
      Promise.resolve().then(async () => {
        try {
          await task.execute();
        } catch (error) {
          logger.error(`Task ${task.id} failed:`, { error });
        } finally {
          this.workers--;
          this.runningTasks.delete(task.id);
          this.processQueue();
        }
      });
    }
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.runningTasks.get(taskId);
    if (task && task.cancel) {
      task.cancel();
      this.runningTasks.delete(taskId);
      this.workers--;
      this.processQueue();
      return true;
    }

    const queueIndex = this.taskQueue.findIndex((t) => t.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
      return true;
    }

    return false;
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.taskQueue = [];
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * 获取运行中任务数
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size;
  }

  /**
   * 获取工作线程数
   */
  getWorkerCount(): number {
    return this.workers;
  }

  /**
   * 获取配置
   */
  getConfig(): WorkerPoolConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<WorkerPoolConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * 全局工作池实例
 */
export const workerPool = new WorkerPool();
