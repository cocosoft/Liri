//
/**
 * 任务系统
 * 提供任务创建、管理、执行和状态跟踪功能
 */

import { appStateStore } from '../state/AppStateStore.js';
import type { AppState } from '../state/AppState.js';
import type { TaskState } from '@modules/types/task.js';

/**
 * 任务优先级
 */
export enum TaskPriority {
  LOW = 'low',
  NORMAL = 'normal',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 任务状态
 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/**
 * 任务选项接口
 */
export interface TaskOptions {
  id?: string;
  name: string;
  description?: string;
  priority?: TaskPriority;
  dependencies?: string[];
  timeout?: number;
  retries?: number;
}

/**
 * 任务执行结果
 */
export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * 任务函数类型
 */
export type TaskFunction = () => Promise<TaskResult> | TaskResult;

/**
 * 任务接口
 */
export interface Task {
  id: string;
  name: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dependencies: string[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: TaskResult;
  retries: number;
  maxRetries: number;
}

/**
 * 任务服务类
 */
export class TaskService {
  private static instance: TaskService;
  private store = appStateStore;
  private taskExecutors: Map<string, TaskFunction> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): TaskService {
    if (!TaskService.instance) {
      TaskService.instance = new TaskService();
    }
    return TaskService.instance;
  }

  /**
   * 创建任务
   * @param options 任务选项
   * @returns 任务ID
   */
  create(options: TaskOptions): string {
    const id =
      options.id ||
      `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.store.setState((prev: AppState) => {
      const newTask = {
        id,
        name: options.name,
        description: options.description,
        priority: options.priority || TaskPriority.NORMAL,
        status: TaskStatus.PENDING,
        dependencies: options.dependencies || [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retries: 0,
        maxRetries: options.retries || 0,
      } as unknown as TaskState;

      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [id]: newTask,
        },
      };
    });

    return id;
  }

  /**
   * 注册任务执行器
   * @param taskId 任务ID
   * @param executor 执行函数
   */
  registerExecutor(taskId: string, executor: TaskFunction): void {
    this.taskExecutors.set(taskId, executor);
  }

  /**
   * 执行任务
   * @param taskId 任务ID
   * @returns 任务结果
   */
  async execute(taskId: string): Promise<TaskResult> {
    const state = this.store.getState();
    const task = state.tasks[taskId] as unknown as Task | undefined;

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === TaskStatus.RUNNING) {
      throw new Error(`Task is already running: ${taskId}`);
    }

    const dependencies = task.dependencies || [];
    for (const depId of dependencies) {
      const depTask = state.tasks[depId] as unknown as Task | undefined;
      if (depTask && depTask.status !== TaskStatus.COMPLETED) {
        throw new Error(`Dependency task not completed: ${depId}`);
      }
    }

    this.updateTaskState(taskId, {
      status: TaskStatus.RUNNING,
      startedAt: Date.now(),
    });

    const executor = this.taskExecutors.get(taskId);

    if (!executor) {
      const result: TaskResult = {
        success: false,
        error: 'No executor registered for this task',
      };

      this.updateTaskState(taskId, {
        status: TaskStatus.FAILED,
        result,
        completedAt: Date.now(),
      });

      return result;
    }

    try {
      const result = await executor();

      this.updateTaskState(taskId, {
        status: result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED,
        result,
        completedAt: Date.now(),
      });

      return result;
    } catch (error) {
      const result: TaskResult = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };

      const currentTask = this.store.getState().tasks[taskId] as unknown as
        | Task
        | undefined;
      const retries = (currentTask?.retries || 0) + 1;
      const maxRetries = currentTask?.maxRetries || 0;

      if (retries <= maxRetries) {
        this.updateTaskState(taskId, {
          retries,
          status: TaskStatus.PENDING,
        });

        setTimeout(() => {
          this.execute(taskId);
        }, 1000 * retries);
      } else {
        this.updateTaskState(taskId, {
          status: TaskStatus.FAILED,
          result,
          completedAt: Date.now(),
        });
      }

      return result;
    }
  }

  /**
   * 取消任务
   * @param taskId 任务ID
   */
  cancel(taskId: string): void {
    const task = this.store.getState().tasks[taskId] as unknown as
      | Task
      | undefined;

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.status === TaskStatus.RUNNING) {
      throw new Error(`Cannot cancel a running task: ${taskId}`);
    }

    this.updateTaskState(taskId, {
      status: TaskStatus.CANCELLED,
      completedAt: Date.now(),
    });
  }

  /**
   * 获取任务状态
   * @param taskId 任务ID
   * @returns 任务状态
   */
  getStatus(taskId: string): TaskStatus | undefined {
    const task = this.store.getState().tasks[taskId] as unknown as
      | Task
      | undefined;
    return task?.status;
  }

  /**
   * 获取所有任务
   * @returns 任务映射
   */
  getAllTasks(): Record<string, Task> {
    return this.store.getState().tasks as unknown as Record<string, Task>;
  }

  /**
   * 获取待处理任务
   * @returns 待处理任务列表
   */
  getPendingTasks(): Task[] {
    const tasks = this.store.getState().tasks;
    return Object.values(tasks).filter(
      (task: any) => task.status === TaskStatus.PENDING
    ) as unknown as Task[];
  }

  /**
   * 获取运行中的任务
   * @returns 运行中的任务列表
   */
  getRunningTasks(): Task[] {
    const tasks = this.store.getState().tasks;
    return Object.values(tasks).filter(
      (task: any) => task.status === TaskStatus.RUNNING
    ) as unknown as Task[];
  }

  /**
   * 删除任务
   * @param taskId 任务ID
   */
  remove(taskId: string): void {
    this.taskExecutors.delete(taskId);
    this.store.setState((prev: AppState) => {
      const newTasks = { ...prev.tasks };
      delete newTasks[taskId];
      return { ...prev, tasks: newTasks };
    });
  }

  /**
   * 清空所有任务
   */
  clear(): void {
    const tasks = this.store.getState().tasks;
    for (const taskId of Object.keys(tasks)) {
      this.remove(taskId);
    }
  }

  /**
   * 批量创建任务
   * @param tasks 任务选项数组
   * @returns 任务ID数组
   */
  createBatch(tasks: TaskOptions[]): string[] {
    return tasks.map((task) => this.create(task));
  }

  /**
   * 批量执行任务
   * @param taskIds 任务ID数组
   * @returns 任务结果数组
   */
  async executeBatch(taskIds: string[]): Promise<TaskResult[]> {
    return Promise.all(taskIds.map((id) => this.execute(id)));
  }

  /**
   * 更新任务状态
   * @param taskId 任务ID
   * @param partial 部分更新字段
   */
  private updateTaskState(taskId: string, partial: Partial<Task>): void {
    this.store.setState((prev: AppState) => {
      const existing = prev.tasks[taskId] as unknown as Task | undefined;
      return {
        ...prev,
        tasks: {
          ...prev.tasks,
          [taskId]: {
            ...(existing || {}),
            ...partial,
            updatedAt: Date.now(),
          } as unknown as TaskState,
        },
      };
    });
  }
}

/**
 * 创建任务服务实例
 */
export function createTaskService(): TaskService {
  return TaskService.getInstance();
}

/**
 * 导出单例
 */
export const taskService = TaskService.getInstance();
