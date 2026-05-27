/**
 * @deprecated 请使用 TaskRegistry 替代。
 * TaskStorage 将在后续版本中移除。
 * 迁移路径：/task 命令已迁移至 TaskRegistry，不再使用 TaskTool 独立存储。
 *
 * Task存储实现
 *
 * 内存中的任务存储
 */

import { randomUUID } from 'crypto';
import type { Task, TaskStorage, TaskStatus } from './types';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

/**
 * @deprecated 使用 TaskRegistry 替代
 *
 * 内存任务存储
 *
 * 在内存中存储任务，实际项目中应该使用持久化存储
 */
export class InMemoryTaskStorage implements TaskStorage {
  /** 任务存储 */
  private tasks: Map<string, Task> = new Map();

  /**
   * 创建任务
   */
  async create(
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Task> {
    const now = Date.now();
    const task: Task = {
      ...taskData,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      blockedBy: taskData.blockedBy || [],
    };

    this.tasks.set(task.id, task);
    return task;
  }

  /**
   * 获取任务
   */
  async get(id: string): Promise<Task | null> {
    return this.tasks.get(id) || null;
  }

  /**
   * 更新任务
   */
  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new AppError(
        `Task with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const updatedTask: Task = {
      ...task,
      ...updates,
      id: task.id,
      createdAt: task.createdAt,
      updatedAt: Date.now(),
    };

    if (updates.status === 'completed' && !task.completedAt) {
      updatedTask.completedAt = Date.now();
    }

    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  /**
   * 删除任务
   */
  async delete(id: string): Promise<void> {
    if (!this.tasks.has(id)) {
      throw new AppError(
        `Task with id ${id} not found`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }
    this.tasks.delete(id);
  }

  /**
   * 列出所有任务
   */
  async list(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  /**
   * 按状态列出任务
   */
  async listByStatus(status: TaskStatus): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === status
    );
  }

  /**
   * 清除所有任务
   */
  clear(): void {
    this.tasks.clear();
  }

  /**
   * 获取任务数量
   */
  size(): number {
    return this.tasks.size;
  }
}

/**
 * 默认任务存储单例
 */
export const defaultTaskStorage = new InMemoryTaskStorage();
