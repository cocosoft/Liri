// @ts-nocheck
/**
 * 任务管理器
 * 提供任务创建、状态更新、查询和生命周期管理
 */

import { logger } from '../../utils/log.js';
import {
  TaskType,
  TaskStatus,
  TaskStateBase,
  TaskHandle,
  TaskContext,
  isTerminalTaskStatus,
  generateTaskId,
  createTaskStateBase,
} from './types.js';

/**
 * 任务管理器
 */
export class TaskManager {
  private static instance: TaskManager;
  private tasks: Map<string, TaskStateBase>;
  private taskHandles: Map<string, TaskHandle>;
  private taskContexts: Map<string, TaskContext>;

  private constructor() {
    this.tasks = new Map();
    this.taskHandles = new Map();
    this.taskContexts = new Map();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): TaskManager {
    if (!TaskManager.instance) {
      TaskManager.instance = new TaskManager();
    }
    return TaskManager.instance;
  }

  /**
   * 创建新任务
   */
  createTask(type: TaskType, description: string, toolUseId?: string): TaskStateBase {
    const id = generateTaskId(type);
    const taskState = createTaskStateBase(id, type, description, toolUseId);
    
    this.tasks.set(id, taskState);
    logger.info(`Task created: ${id} (${type}) - ${description}`);
    
    return taskState;
  }

  /**
   * 更新任务状态
   */
  updateTaskStatus(taskId: string, status: TaskStatus): TaskStateBase | null {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`Task not found: ${taskId}`);
      return null;
    }

    // 防止终态任务再次转换
    if (isTerminalTaskStatus(task.status)) {
      logger.warn(`Task ${taskId} is already in terminal state: ${task.status}`);
      return task;
    }

    task.status = status;
    
    if (isTerminalTaskStatus(status)) {
      task.endTime = Date.now();
    }

    logger.debug(`Task ${taskId} status updated to: ${status}`);
    return task;
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): TaskStateBase | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): TaskStateBase[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 按类型获取任务
   */
  getTasksByType(type: TaskType): TaskStateBase[] {
    return this.getAllTasks().filter(task => task.type === type);
  }

  /**
   * 获取活跃任务（非终态）
   */
  getActiveTasks(): TaskStateBase[] {
    return this.getAllTasks().filter(task => !isTerminalTaskStatus(task.status));
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    // 清理关联资源
    this.cleanupTask(taskId);
    
    this.tasks.delete(taskId);
    logger.info(`Task deleted: ${taskId}`);
    
    return true;
  }

  /**
   * 注册任务句柄
   */
  registerTaskHandle(taskId: string, handle: TaskHandle): void {
    this.taskHandles.set(taskId, handle);
  }

  /**
   * 获取任务句柄
   */
  getTaskHandle(taskId: string): TaskHandle | undefined {
    return this.taskHandles.get(taskId);
  }

  /**
   * 注册任务上下文
   */
  registerTaskContext(taskId: string, context: TaskContext): void {
    this.taskContexts.set(taskId, context);
  }

  /**
   * 获取任务上下文
   */
  getTaskContext(taskId: string): TaskContext | undefined {
    return this.taskContexts.get(taskId);
  }

  /**
   * 终止任务
   */
  async killTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`Task not found for kill: ${taskId}`);
      return false;
    }

    if (isTerminalTaskStatus(task.status)) {
      logger.warn(`Task ${taskId} is already in terminal state`);
      return false;
    }

    // 触发清理
    const handle = this.taskHandles.get(taskId);
    if (handle?.cleanup) {
      try {
        handle.cleanup();
      } catch (error) {
        logger.error(`Task cleanup failed for ${taskId}:`, error);
      }
    }

    // 中止上下文
    const context = this.taskContexts.get(taskId);
    if (context) {
      context.abortController.abort();
    }

    this.updateTaskStatus(taskId, 'killed');
    this.cleanupTask(taskId);
    
    logger.info(`Task killed: ${taskId}`);
    return true;
  }

  /**
   * 清理任务关联资源
   */
  private cleanupTask(taskId: string): void {
    this.taskHandles.delete(taskId);
    this.taskContexts.delete(taskId);
  }

  /**
   * 获取任务统计信息
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.tasks.size,
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      killed: 0,
    };

    const tasks = Array.from(this.tasks.values());
    for (const task of tasks) {
      stats[task.status] = (stats[task.status] || 0) + 1;
    }

    return stats;
  }

  /**
   * 重置任务管理器（主要用于测试）
   */
  reset(): void {
    this.tasks.clear();
    this.taskHandles.clear();
    this.taskContexts.clear();
  }
}

/**
 * 便捷函数：创建任务
 */
export function createTask(type: TaskType, description: string, toolUseId?: string): TaskStateBase {
  return TaskManager.getInstance().createTask(type, description, toolUseId);
}

/**
 * 便捷函数：更新任务状态
 */
export function updateTaskStatus(taskId: string, status: TaskStatus): TaskStateBase | null {
  return TaskManager.getInstance().updateTaskStatus(taskId, status);
}

/**
 * 便捷函数：获取任务
 */
export function getTask(taskId: string): TaskStateBase | undefined {
  return TaskManager.getInstance().getTask(taskId);
}
