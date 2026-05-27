//
/**
 * 增强的任务调度器
 * 支持任务重试、任务依赖和执行历史
 */

import { randomUUID } from 'crypto';
import {
  EnhancedCronTask,
  canRetryTask,
  calculateNextRetryTime,
  checkTaskDependencies,
  incrementRetryCount,
  recordTaskExecution,
  resetRetryState,
  TaskExecutionStatus,
} from './EnhancedCronTask.js';

/**
 * 简单的cron解析和计算函数
 */
function parseCronExpression(cron: string): number[] | null {
  const parts = cron.split(' ').map((p) => p.trim());
  if (parts.length !== 5) {
    return null;
  }
  return parts.map((p) => (p === '*' ? 0 : parseInt(p, 10)));
}

function computeNextCronRun(fields: number[], from: Date): Date | null {
  // 简化实现，仅支持每分钟执行
  if (fields[0] === 0) {
    const next = new Date(from);
    next.setMinutes(next.getMinutes() + 1);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }
  return null;
}

/**
 * 计算下次执行时间
 */
function nextCronRunMs(cron: string, fromMs: number): number | null {
  const fields = parseCronExpression(cron);
  if (!fields) return null;
  const next = computeNextCronRun(fields, new Date(fromMs));
  return next ? next.getTime() : null;
}

/**
 * 任务调度器选项
 */
export interface EnhancedSchedulerOptions {
  /** 任务执行回调 */
  onTaskExecute: (task: EnhancedCronTask) => Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
  /** 任务状态变更回调 */
  onTaskStatusChange?: (
    task: EnhancedCronTask,
    status: TaskExecutionStatus
  ) => void;
  /** 任务依赖失败回调 */
  onDependencyFailure?: (
    task: EnhancedCronTask,
    failedDependencies: string[]
  ) => void;
  /** 任务重试回调 */
  onTaskRetry?: (
    task: EnhancedCronTask,
    retryCount: number,
    nextRetryAt: number
  ) => void;
  /** 任务执行完成回调 */
  onTaskComplete?: (
    task: EnhancedCronTask,
    status: 'success' | 'failed'
  ) => void;
}

/**
 * 增强的任务调度器
 */
export class EnhancedTaskScheduler {
  private tasks: Map<string, EnhancedCronTask> = new Map();
  private options: EnhancedSchedulerOptions;
  private taskExecutionPromises: Map<string, Promise<void>> = new Map();
  private isRunning: boolean = false;

  constructor(options: EnhancedSchedulerOptions) {
    this.options = options;
  }

  /**
   * 添加任务
   */
  addTask(task: EnhancedCronTask): void {
    this.tasks.set(task.id, task);
  }

  /**
   * 移除任务
   */
  removeTask(taskId: string): void {
    this.tasks.delete(taskId);
    this.taskExecutionPromises.delete(taskId);
  }

  /**
   * 获取所有任务
   */
  getTasks(): EnhancedCronTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): EnhancedCronTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 开始调度
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.checkTasks();
  }

  /**
   * 停止调度
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 检查任务
   */
  private async checkTasks(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    const now = Date.now();

    // 检查所有任务
    for (const task of this.tasks.values()) {
      await this.processTask(task, now);
    }

    // 继续检查
    setTimeout(() => this.checkTasks(), 1000);
  }

  /**
   * 处理任务
   */
  private async processTask(
    task: EnhancedCronTask,
    now: number
  ): Promise<void> {
    // 检查是否正在执行
    if (this.taskExecutionPromises.has(task.id)) {
      return;
    }

    // 检查是否需要重试
    if (task.nextRetryAt) {
      if (now >= task.nextRetryAt) {
        await this.executeTaskWithRetry(task);
      }
      return;
    }

    // 检查是否到了执行时间
    const nextRun = nextCronRunMs(
      task.cron,
      task.lastFiredAt || task.createdAt
    );
    if (nextRun === null) {
      return;
    }

    if (now >= nextRun) {
      // 检查任务依赖
      const dependencyCheck = checkTaskDependencies(task, this.tasks);
      if (!dependencyCheck.satisfied) {
        this.handleDependencyFailure(task, dependencyCheck);
        return;
      }

      await this.executeTaskWithRetry(task);
    }
  }

  /**
   * 处理依赖失败
   */
  private handleDependencyFailure(
    task: EnhancedCronTask,
    dependencyCheck: ReturnType<typeof checkTaskDependencies>
  ): void {
    if (this.options.onDependencyFailure) {
      this.options.onDependencyFailure(
        task,
        dependencyCheck.failedDependencies
      );
    }

    // 根据依赖失败策略处理
    const strategy = task.dependencyFailureStrategy || 'fail';

    if (strategy === 'fail') {
      // 标记任务为失败
      const updatedTask = recordTaskExecution(task, 'failed', {
        error: `Dependency failure: ${dependencyCheck.failedDependencies.join(', ')}`,
      });
      this.tasks.set(task.id, updatedTask);

      if (this.options.onTaskStatusChange) {
        this.options.onTaskStatusChange(updatedTask, 'failed');
      }

      if (this.options.onTaskComplete) {
        this.options.onTaskComplete(updatedTask, 'failed');
      }
    }
  }

  /**
   * 执行任务（带重试）
   */
  private async executeTaskWithRetry(task: EnhancedCronTask): Promise<void> {
    // 标记为执行中
    const runningTask = recordTaskExecution(task, 'running');
    this.tasks.set(task.id, runningTask);

    if (this.options.onTaskStatusChange) {
      this.options.onTaskStatusChange(runningTask, 'running');
    }

    const startTime = Date.now();
    let executionResult: {
      success: boolean;
      stdout?: string;
      stderr?: string;
      error?: string;
    };

    try {
      // 执行任务
      this.taskExecutionPromises.set(
        task.id,
        this.executeTask(runningTask) as unknown as Promise<void>
      );
      executionResult = await (this.taskExecutionPromises.get(
        task.id
      ) as unknown as Promise<{
        success: boolean;
        stdout?: string;
        stderr?: string;
        error?: string;
      }>);
    } catch (error) {
      executionResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.taskExecutionPromises.delete(task.id);
    }

    const duration = Date.now() - startTime;

    if (executionResult.success) {
      // 执行成功
      const successTask = recordTaskExecution(
        resetRetryState(runningTask),
        'success',
        {
          duration,
          stdout: executionResult.stdout,
          stderr: executionResult.stderr,
        }
      );

      // 更新上次执行时间
      const updatedTask = {
        ...successTask,
        lastFiredAt: Date.now(),
      };

      this.tasks.set(task.id, updatedTask);

      if (this.options.onTaskStatusChange) {
        this.options.onTaskStatusChange(updatedTask, 'success');
      }

      if (this.options.onTaskComplete) {
        this.options.onTaskComplete(updatedTask, 'success');
      }
    } else {
      // 执行失败
      const failedTask = recordTaskExecution(runningTask, 'failed', {
        duration,
        stdout: executionResult.stdout,
        stderr: executionResult.stderr,
        error: executionResult.error,
      });

      // 检查是否可以重试
      if (canRetryTask(failedTask)) {
        const retryTask = incrementRetryCount(failedTask);
        this.tasks.set(task.id, retryTask);

        if (this.options.onTaskStatusChange) {
          this.options.onTaskStatusChange(retryTask, 'retrying');
        }

        if (this.options.onTaskRetry) {
          this.options.onTaskRetry(
            retryTask,
            retryTask.retryCount || 0,
            retryTask.nextRetryAt || 0
          );
        }
      } else {
        this.tasks.set(task.id, failedTask);

        if (this.options.onTaskStatusChange) {
          this.options.onTaskStatusChange(failedTask, 'failed');
        }

        if (this.options.onTaskComplete) {
          this.options.onTaskComplete(failedTask, 'failed');
        }
      }
    }
  }

  /**
   * 执行任务
   */
  private async executeTask(task: EnhancedCronTask): Promise<{
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
  }> {
    try {
      return await this.options.onTaskExecute(task);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 检查任务是否可以执行
   */
  canExecuteTask(task: EnhancedCronTask): boolean {
    const now = Date.now();

    // 检查依赖
    const dependencyCheck = checkTaskDependencies(task, this.tasks);
    if (!dependencyCheck.satisfied) {
      return false;
    }

    // 检查执行时间
    const nextRun = nextCronRunMs(
      task.cron,
      task.lastFiredAt || task.createdAt
    );
    if (nextRun === null) {
      return false;
    }

    return now >= nextRun;
  }

  /**
   * 手动执行任务
   */
  async executeTaskManually(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    // 检查依赖
    const dependencyCheck = checkTaskDependencies(task, this.tasks);
    if (!dependencyCheck.satisfied) {
      return false;
    }

    await this.executeTaskWithRetry(task);
    return true;
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    const cancelledTask = recordTaskExecution(task, 'cancelled');
    this.tasks.set(taskId, cancelledTask);

    if (this.options.onTaskStatusChange) {
      this.options.onTaskStatusChange(cancelledTask, 'cancelled');
    }

    return true;
  }
}

/**
 * 创建增强的任务调度器
 */
export function createEnhancedTaskScheduler(
  options: EnhancedSchedulerOptions
): EnhancedTaskScheduler {
  return new EnhancedTaskScheduler(options);
}
