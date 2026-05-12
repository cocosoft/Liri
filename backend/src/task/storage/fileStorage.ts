/**
 * 文件系统任务存储
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { TaskStorage, Task, TaskQueryOptions } from '../models/types';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join } from 'path';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 文件系统任务存储类
 */
export class FileTaskStorage implements TaskStorage {
  private storagePath: string;

  /**
   * 构造函数
   * @param storagePath 存储路径
   */
  constructor(storagePath: string) {
    this.storagePath = storagePath;

    // 确保存储目录存在
    if (!existsSync(this.storagePath)) {
      mkdirSync(this.storagePath, { recursive: true });
    }
  }

  /**
   * 创建任务
   * @param task 任务
   * @returns 创建的任务
   */
  async create(task: Task): Promise<Task> {
    const taskPath = join(this.storagePath, `${task.id}.json`);
    writeFileSync(taskPath, JSON.stringify(task, null, 2), 'utf-8');
    return task;
  }

  /**
   * 获取任务
   * @param id 任务ID
   * @returns 任务或undefined
   */
  async get(id: string): Promise<Task | undefined> {
    const taskPath = join(this.storagePath, `${id}.json`);
    if (!existsSync(taskPath)) {
      return undefined;
    }

    try {
      const data = readFileSync(taskPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to read task:', error);
      return undefined;
    }
  }

  /**
   * 更新任务
   * @param id 任务ID
   * @param task 更新的任务数据
   * @returns 更新后的任务或undefined
   */
  async update(id: string, task: Partial<Task>): Promise<Task | undefined> {
    const existingTask = await this.get(id);
    if (!existingTask) {
      return undefined;
    }

    const updatedTask = { ...existingTask, ...task, updatedAt: Date.now() };
    const taskPath = join(this.storagePath, `${id}.json`);
    writeFileSync(taskPath, JSON.stringify(updatedTask, null, 2), 'utf-8');
    return updatedTask;
  }

  /**
   * 删除任务
   * @param id 任务ID
   * @returns 是否成功
   */
  async delete(id: string): Promise<boolean> {
    const taskPath = join(this.storagePath, `${id}.json`);
    if (!existsSync(taskPath)) {
      return false;
    }

    try {
      unlinkSync(taskPath);
      return true;
    } catch (error) {
      logger.error('Failed to delete task:', error);
      return false;
    }
  }

  /**
   * 列出任务
   * @param options 查询选项
   * @returns 任务列表
   */
  async list(options?: TaskQueryOptions): Promise<Task[]> {
    try {
      const files = readdirSync(this.storagePath);
      const tasks: Task[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskPath = join(this.storagePath, file);
          const data = readFileSync(taskPath, 'utf-8');
          const task = JSON.parse(data);
          tasks.push(task);
        }
      }

      // 应用过滤
      let filteredTasks = tasks;
      if (options) {
        if (options.status) {
          filteredTasks = filteredTasks.filter(
            (task) => task.status === options.status
          );
        }
        if (options.priority) {
          filteredTasks = filteredTasks.filter(
            (task) => task.priority === options.priority
          );
        }
        if (options.type) {
          filteredTasks = filteredTasks.filter(
            (task) => task.type === options.type
          );
        }
      }

      // 应用排序
      if (options?.sortBy) {
        filteredTasks.sort((a, b) => {
          const aValue = a[options.sortBy!];
          const bValue = b[options.sortBy!];

          // 处理undefined值的情况
          if (aValue === undefined && bValue === undefined) {
            return 0;
          }
          if (aValue === undefined) {
            return 1; // undefined排在后面
          }
          if (bValue === undefined) {
            return -1; // undefined排在后面
          }

          if (aValue < bValue) {
            return options.sortOrder === 'desc' ? 1 : -1;
          }
          if (aValue > bValue) {
            return options.sortOrder === 'desc' ? -1 : 1;
          }
          return 0;
        });
      }

      // 应用分页
      if (options?.limit) {
        const offset = options.offset || 0;
        filteredTasks = filteredTasks.slice(offset, offset + options.limit);
      }

      return filteredTasks;
    } catch (error) {
      logger.error('Failed to list tasks:', error);
      return [];
    }
  }

  /**
   * 计算任务数量
   * @param options 查询选项
   * @returns 任务数量
   */
  async count(options?: TaskQueryOptions): Promise<number> {
    const tasks = await this.list(options);
    return tasks.length;
  }
}

/**
 * 创建文件系统任务存储实例
 * @param storagePath 存储路径
 * @returns 文件系统任务存储实例
 */
export function createFileTaskStorage(
  storagePath: string = join(process.cwd(), 'task_storage')
): TaskStorage {
  return new FileTaskStorage(storagePath);
}

/**
 * 文件系统任务存储实例
 */
export const fileTaskStorage = createFileTaskStorage();
