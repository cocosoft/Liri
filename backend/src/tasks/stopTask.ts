/**
 * 任务停止功能模块
 * 基于CC源码 cc_code/backend/tasks/stopTask.ts 实现
 */

import { taskRegistry } from './TaskRegistry';
import { TaskStatus } from './types';

/**
 * 停止任务选项
 */
export interface StopTaskOptions {
  /**
   * 是否强制停止（跳过优雅停止）
   */
  force?: boolean;

  /**
   * 优雅停止超时时间（毫秒）
   */
  timeout?: number;
}

/**
 * 停止任务结果
 */
export interface StopTaskResult {
  /**
   * 是否成功
   */
  success: boolean;

  /**
   * 任务ID
   */
  taskId: string;

  /**
   * 任务状态
   */
  status: TaskStatus;

  /**
   * 消息
   */
  message?: string;
}

/**
 * 停止指定任务
 * @param taskId 任务ID
 * @param options 停止选项
 * @returns 停止结果
 */
export async function stopTask(
  taskId: string,
  options: StopTaskOptions = {}
): Promise<StopTaskResult> {
  const { force = false, timeout = 5000 } = options;

  const task = taskRegistry.getTask(taskId);

  if (!task) {
    return {
      success: false,
      taskId,
      status: TaskStatus.FAILED,
      message: `Task ${taskId} not found`,
    };
  }

  const currentStatus = task.status;

  if (
    currentStatus === TaskStatus.COMPLETED ||
    currentStatus === TaskStatus.FAILED ||
    currentStatus === TaskStatus.KILLED
  ) {
    return {
      success: true,
      taskId,
      status: currentStatus,
      message: `Task ${taskId} is already in terminal state: ${currentStatus}`,
    };
  }

  try {
    if (force) {
      // 强制停止：直接kill
      await task.kill();
    } else {
      // 优雅停止：等待任务自行停止，超时后强制kill
      const killPromise = task.kill();

      const timeoutPromise = new Promise<void>((resolve) => {
        setTimeout(resolve, timeout);
      });

      await Promise.race([killPromise, timeoutPromise]);
    }

    return {
      success: true,
      taskId,
      status: task.status,
      message: `Task ${taskId} stopped successfully`,
    };
  } catch (error) {
    return {
      success: false,
      taskId,
      status: TaskStatus.FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 停止所有运行中的任务
 * @param options 停止选项
 * @returns 停止结果列表
 */
export async function stopAllTasks(
  options: StopTaskOptions = {}
): Promise<StopTaskResult[]> {
  const runningTasks = taskRegistry.getRunningTasks();
  const results: StopTaskResult[] = [];

  for (const task of runningTasks) {
    const result = await stopTask(task.id, options);
    results.push(result);
  }

  return results;
}

/**
 * 批量停止多个任务
 * @param taskIds 任务ID列表
 * @param options 停止选项
 * @returns 停止结果列表
 */
export async function stopTasks(
  taskIds: string[],
  options: StopTaskOptions = {}
): Promise<StopTaskResult[]> {
  const results: StopTaskResult[] = [];

  for (const taskId of taskIds) {
    const result = await stopTask(taskId, options);
    results.push(result);
  }

  return results;
}