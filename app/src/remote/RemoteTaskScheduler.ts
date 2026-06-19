//
/**
 * 远程任务调度服务
 * 提供在远程服务器上调度和管理任务的功能
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 远程任务状态
 */
export enum RemoteTaskStatus {
  PENDING = 'pending',
  SCHEDULED = 'scheduled',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout',
}

/**
 * 远程任务类型
 */
export enum RemoteTaskType {
  IMMEDIATE = 'immediate',
  DELAYED = 'delayed',
  SCHEDULED = 'scheduled',
  RECURRING = 'recurring',
}

/**
 * 远程任务配置
 */
export interface RemoteTaskConfig {
  id: string;
  sessionId: string;
  type: RemoteTaskType;
  command: string;
  description?: string;
  timeout?: number;
  retryCount?: number;
  retryDelay?: number;
  scheduledAt?: number;
  interval?: number;
  enabled?: boolean;
}

/**
 * 远程任务结果
 */
export interface RemoteTaskResult {
  taskId: string;
  status: RemoteTaskStatus;
  output?: string;
  error?: string;
  exitCode?: number;
  startTime?: number;
  endTime?: number;
  duration?: number;
  retries?: number;
}

/**
 * 远程任务回调
 */
export interface RemoteTaskCallbacks {
  onStart?: (taskId: string) => void;
  onOutput?: (taskId: string, output: string) => void;
  onError?: (taskId: string, error: string) => void;
  onComplete?: (taskId: string, result: RemoteTaskResult) => void;
  onStatusChange?: (taskId: string, status: RemoteTaskStatus) => void;
}

/**
 * 远程任务信息
 */
interface RemoteTaskInfo {
  config: RemoteTaskConfig;
  status: RemoteTaskStatus;
  result?: RemoteTaskResult;
  timer?: NodeJS.Timeout;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  runCount: number;
}

/**
 * 远程任务调度服务
 */
export class RemoteTaskScheduler {
  private tasks: Map<string, RemoteTaskInfo> = new Map();
  private callbacks: RemoteTaskCallbacks;
  private commandExecutor: (
    sessionId: string,
    command: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /**
   * 构造函数
   * @param callbacks 任务回调
   * @param commandExecutor 命令执行器
   */
  constructor(
    callbacks?: RemoteTaskCallbacks,
    commandExecutor?: (
      sessionId: string,
      command: string
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
  ) {
    this.callbacks = callbacks || {};
    this.commandExecutor = commandExecutor || this.defaultCommandExecutor;
  }

  /**
   * 默认命令执行器（需要子类或外部实现具体逻辑）
   */
  private async defaultCommandExecutor(
    sessionId: string,
    command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    logger.info(
      `[RemoteTaskScheduler] Executing command on ${sessionId}: ${command}`
    );
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
    };
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 注册任务
   */
  public registerTask(config: Omit<RemoteTaskConfig, 'id'>): string {
    const taskId = this.generateTaskId();

    const taskInfo: RemoteTaskInfo = {
      config: {
        ...config,
        id: taskId,
        enabled: config.enabled ?? true,
        retryCount: config.retryCount ?? 0,
        retryDelay: config.retryDelay ?? 1000,
        timeout: config.timeout ?? 60000,
      },
      status: RemoteTaskStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      runCount: 0,
    };

    this.tasks.set(taskId, taskInfo);

    if (
      taskInfo.config.type === RemoteTaskType.IMMEDIATE &&
      taskInfo.config.enabled
    ) {
      this.scheduleTask(taskId);
    } else if (
      taskInfo.config.type === RemoteTaskType.DELAYED &&
      taskInfo.config.scheduledAt
    ) {
      this.scheduleTask(taskId);
    } else if (
      taskInfo.config.type === RemoteTaskType.SCHEDULED &&
      taskInfo.config.scheduledAt
    ) {
      this.scheduleTask(taskId);
    }

    return taskId;
  }

  /**
   * 调度任务
   */
  private scheduleTask(taskId: string): void {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return;

    const config = taskInfo.config;
    let delay = 0;

    if (config.type === RemoteTaskType.DELAYED && config.scheduledAt) {
      delay = config.scheduledAt - Date.now();
      if (delay < 0) delay = 0;
    } else if (config.type === RemoteTaskType.SCHEDULED && config.scheduledAt) {
      delay = config.scheduledAt - Date.now();
      if (delay < 0) delay = 0;
    }

    taskInfo.timer = setTimeout(() => {
      this.executeTask(taskId);
    }, delay);

    taskInfo.status = RemoteTaskStatus.SCHEDULED;
    taskInfo.updatedAt = Date.now();
    this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.SCHEDULED);
  }

  /**
   * 执行任务
   */
  public async executeTask(taskId: string): Promise<RemoteTaskResult> {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) {
      return {
        taskId,
        status: RemoteTaskStatus.FAILED,
        error: 'Task not found',
      };
    }

    if (!taskInfo.config.enabled) {
      return {
        taskId,
        status: RemoteTaskStatus.CANCELLED,
        error: 'Task is disabled',
      };
    }

    taskInfo.status = RemoteTaskStatus.RUNNING;
    taskInfo.updatedAt = Date.now();
    taskInfo.lastRunAt = Date.now();
    taskInfo.runCount++;

    this.callbacks.onStart?.(taskId);
    this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.RUNNING);

    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = taskInfo.config.retryCount || 0;

    while (retryCount <= maxRetries) {
      try {
        const result = await this.executeWithTimeout(
          taskId,
          taskInfo.config.sessionId,
          taskInfo.config.command,
          taskInfo.config.timeout || 60000
        );

        if (result.exitCode === 0) {
          const endTime = Date.now();
          const taskResult: RemoteTaskResult = {
            taskId,
            status: RemoteTaskStatus.COMPLETED,
            output: result.stdout,
            startTime,
            endTime,
            duration: endTime - startTime,
            retries: retryCount,
          };

          taskInfo.result = taskResult;
          taskInfo.status = RemoteTaskStatus.COMPLETED;
          taskInfo.updatedAt = Date.now();

          this.callbacks.onComplete?.(taskId, taskResult);
          this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.COMPLETED);

          if (
            taskInfo.config.type === RemoteTaskType.RECURRING &&
            taskInfo.config.interval
          ) {
            this.scheduleRecurringTask(taskId);
          }

          return taskResult;
        } else {
          if (retryCount < maxRetries) {
            retryCount++;
            await this.sleep(taskInfo.config.retryDelay || 1000);
            continue;
          }

          const endTime = Date.now();
          const taskResult: RemoteTaskResult = {
            taskId,
            status: RemoteTaskStatus.FAILED,
            error:
              result.stderr || `Command exited with code ${result.exitCode}`,
            exitCode: result.exitCode,
            startTime,
            endTime,
            duration: endTime - startTime,
            retries: retryCount,
          };

          taskInfo.result = taskResult;
          taskInfo.status = RemoteTaskStatus.FAILED;
          taskInfo.updatedAt = Date.now();

          this.callbacks.onError?.(taskId, result.stderr);
          this.callbacks.onComplete?.(taskId, taskResult);
          this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.FAILED);

          return taskResult;
        }
      } catch (error) {
        if (retryCount < maxRetries) {
          retryCount++;
          await this.sleep(taskInfo.config.retryDelay || 1000);
          continue;
        }

        const endTime = Date.now();
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const taskResult: RemoteTaskResult = {
          taskId,
          status: RemoteTaskStatus.FAILED,
          error: errorMessage,
          startTime,
          endTime,
          duration: endTime - startTime,
          retries: retryCount,
        };

        taskInfo.result = taskResult;
        taskInfo.status = RemoteTaskStatus.FAILED;
        taskInfo.updatedAt = Date.now();

        this.callbacks.onError?.(taskId, errorMessage);
        this.callbacks.onComplete?.(taskId, taskResult);
        this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.FAILED);

        return taskResult;
      }
    }

    return taskInfo.result!;
  }

  /**
   * 执行带超时的命令
   */
  private async executeWithTimeout(
    taskId: string,
    sessionId: string,
    command: string,
    timeout: number
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Task execution timeout'));
      }, timeout);

      this.commandExecutor(sessionId, command)
        .then((result) => {
          clearTimeout(timeoutId);
          this.callbacks.onOutput?.(taskId, result.stdout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 调度循环任务
   */
  private scheduleRecurringTask(taskId: string): void {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo || !taskInfo.config.interval) return;

    taskInfo.timer = setTimeout(async () => {
      await this.executeTask(taskId);
    }, taskInfo.config.interval);
  }

  /**
   * 取消任务
   */
  public cancelTask(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return false;

    if (taskInfo.timer) {
      clearTimeout(taskInfo.timer);
    }

    taskInfo.status = RemoteTaskStatus.CANCELLED;
    taskInfo.updatedAt = Date.now();
    this.callbacks.onStatusChange?.(taskId, RemoteTaskStatus.CANCELLED);

    return true;
  }

  /**
   * 暂停任务
   */
  public pauseTask(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return false;

    if (taskInfo.timer) {
      clearTimeout(taskInfo.timer);
    }

    taskInfo.config.enabled = false;
    taskInfo.updatedAt = Date.now();

    return true;
  }

  /**
   * 恢复任务
   */
  public resumeTask(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return false;

    taskInfo.config.enabled = true;
    taskInfo.updatedAt = Date.now();

    if (
      taskInfo.status === RemoteTaskStatus.SCHEDULED ||
      taskInfo.status === RemoteTaskStatus.PENDING
    ) {
      this.scheduleTask(taskId);
    }

    return true;
  }

  /**
   * 删除任务
   */
  public deleteTask(taskId: string): boolean {
    const taskInfo = this.tasks.get(taskId);
    if (!taskInfo) return false;

    if (taskInfo.timer) {
      clearTimeout(taskInfo.timer);
    }

    return this.tasks.delete(taskId);
  }

  /**
   * 获取任务状态
   */
  public getTaskStatus(taskId: string): RemoteTaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }

  /**
   * 获取任务信息
   */
  public getTaskInfo(taskId: string): RemoteTaskConfig | undefined {
    const taskInfo = this.tasks.get(taskId);
    return taskInfo?.config;
  }

  /**
   * 获取任务结果
   */
  public getTaskResult(taskId: string): RemoteTaskResult | undefined {
    return this.tasks.get(taskId)?.result;
  }

  /**
   * 获取所有任务
   */
  public getAllTasks(): RemoteTaskConfig[] {
    return Array.from(this.tasks.values()).map((info) => info.config);
  }

  /**
   * 获取正在运行的任务
   */
  public getRunningTasks(): string[] {
    return Array.from(this.tasks.entries())
      .filter(([, info]) => info.status === RemoteTaskStatus.RUNNING)
      .map(([id]) => id);
  }

  /**
   * 获取待调度的任务
   */
  public getScheduledTasks(): string[] {
    return Array.from(this.tasks.entries())
      .filter(([, info]) => info.status === RemoteTaskStatus.SCHEDULED)
      .map(([id]) => id);
  }

  /**
   * 清除已完成的任务
   */
  public clearCompletedTasks(): number {
    let count = 0;

    for (const [taskId, taskInfo] of this.tasks.entries()) {
      if (
        taskInfo.status === RemoteTaskStatus.COMPLETED ||
        taskInfo.status === RemoteTaskStatus.FAILED ||
        taskInfo.status === RemoteTaskStatus.CANCELLED
      ) {
        if (taskInfo.timer) {
          clearTimeout(taskInfo.timer);
        }
        this.tasks.delete(taskId);
        count++;
      }
    }

    return count;
  }

  /**
   * 销毁调度器
   */
  public destroy(): void {
    for (const taskInfo of this.tasks.values()) {
      if (taskInfo.timer) {
        clearTimeout(taskInfo.timer);
      }
    }
    this.tasks.clear();
  }

  /**
   * 休眠辅助函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 创建远程任务调度器
 */
export function createRemoteTaskScheduler(
  callbacks?: RemoteTaskCallbacks,
  commandExecutor?: (
    sessionId: string,
    command: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
): RemoteTaskScheduler {
  return new RemoteTaskScheduler(callbacks, commandExecutor);
}
