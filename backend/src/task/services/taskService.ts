/**
 * 任务服务
 */

import {
  TaskService,
  Task,
  TaskCreateOptions,
  TaskUpdateOptions,
  TaskQueryOptions,
  TaskStatus,
} from '../models/types';
import { createTask } from '../models/task';
import { createFileTaskStorage } from '../storage/fileStorage';

/**
 * 任务服务类
 */
export class TaskServiceImpl implements TaskService {
  private storage: any;

  /**
   * 构造函数
   * @param storage 任务存储
   */
  constructor(storage: any) {
    this.storage = storage;
  }

  /**
   * 创建任务
   * @param options 任务创建选项
   * @returns 创建的任务
   */
  async createTask(options: TaskCreateOptions): Promise<Task> {
    const task = createTask(options);
    return await this.storage.create(task);
  }

  /**
   * 获取任务
   * @param id 任务ID
   * @returns 任务或undefined
   */
  async getTask(id: string): Promise<Task | undefined> {
    return await this.storage.get(id);
  }

  /**
   * 更新任务
   * @param id 任务ID
   * @param options 任务更新选项
   * @returns 更新后的任务或undefined
   */
  async updateTask(
    id: string,
    options: TaskUpdateOptions
  ): Promise<Task | undefined> {
    return await this.storage.update(id, options);
  }

  /**
   * 删除任务
   * @param id 任务ID
   * @returns 是否成功
   */
  async deleteTask(id: string): Promise<boolean> {
    return await this.storage.delete(id);
  }

  /**
   * 列出任务
   * @param options 查询选项
   * @returns 任务列表
   */
  async listTasks(options?: TaskQueryOptions): Promise<Task[]> {
    return await this.storage.list(options);
  }

  /**
   * 计算任务数量
   * @param options 查询选项
   * @returns 任务数量
   */
  async countTasks(options?: TaskQueryOptions): Promise<number> {
    return await this.storage.count(options);
  }

  /**
   * 开始任务
   * @param id 任务ID
   * @returns 开始后的任务或undefined
   */
  async startTask(id: string): Promise<Task | undefined> {
    return await this.storage.update(id, {
      status: TaskStatus.IN_PROGRESS,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * 完成任务
   * @param id 任务ID
   * @param output 任务输出
   * @returns 完成后的任务或undefined
   */
  async completeTask(
    id: string,
    output?: Record<string, any>
  ): Promise<Task | undefined> {
    const task = await this.getTask(id);
    if (!task) {
      return undefined;
    }

    const duration = task.startedAt ? Date.now() - task.startedAt : undefined;

    return await this.storage.update(id, {
      status: TaskStatus.COMPLETED,
      output,
      completedAt: Date.now(),
      duration,
      updatedAt: Date.now(),
    });
  }

  /**
   * 失败任务
   * @param id 任务ID
   * @param error 错误信息
   * @returns 失败后的任务或undefined
   */
  async failTask(id: string, error: string): Promise<Task | undefined> {
    const task = await this.getTask(id);
    if (!task) {
      return undefined;
    }

    const duration = task.startedAt ? Date.now() - task.startedAt : undefined;

    return await this.storage.update(id, {
      status: TaskStatus.FAILED,
      error,
      completedAt: Date.now(),
      duration,
      updatedAt: Date.now(),
    });
  }

  /**
   * 取消任务
   * @param id 任务ID
   * @returns 取消后的任务或undefined
   */
  async cancelTask(id: string): Promise<Task | undefined> {
    return await this.storage.update(id, {
      status: TaskStatus.CANCELLED,
      updatedAt: Date.now(),
    });
  }
}

/**
 * 创建任务服务实例
 * @returns 任务服务实例
 */
export function createTaskService(): TaskService {
  const storage = createFileTaskStorage();
  return new TaskServiceImpl(storage);
}

/**
 * 任务服务实例
 */
export const taskService = createTaskService();
