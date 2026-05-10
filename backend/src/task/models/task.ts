/**
 * 任务类
 */

import { Task, TaskStatus, TaskPriority, TaskType } from './types';

/**
 * 任务类
 */
export class TaskImpl implements Task {
  id: string;
  name: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  metadata?: Record<string, unknown>;

  /**
   * 构造函数
   * @param options 任务创建选项
   */
  constructor({
    name,
    description,
    type,
    priority = TaskPriority.MEDIUM,
    input,
    metadata,
  }: {
    name: string;
    description: string;
    type: TaskType;
    priority?: TaskPriority;
    input?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }) {
    this.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    this.name = name;
    this.description = description;
    this.type = type;
    this.status = TaskStatus.PENDING;
    this.priority = priority;
    this.input = input;
    this.metadata = metadata;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * 开始任务
   */
  start(): void {
    this.status = TaskStatus.IN_PROGRESS;
    this.startedAt = Date.now();
    this.updatedAt = Date.now();
  }

  /**
   * 完成任务
   * @param output 任务输出
   */
  complete(output?: Record<string, unknown>): void {
    this.status = TaskStatus.COMPLETED;
    this.output = output;
    this.completedAt = Date.now();
    this.duration = this.startedAt
      ? this.completedAt - this.startedAt
      : undefined;
    this.updatedAt = Date.now();
  }

  /**
   * 失败任务
   * @param error 错误信息
   */
  fail(error: string): void {
    this.status = TaskStatus.FAILED;
    this.error = error;
    this.completedAt = Date.now();
    this.duration = this.startedAt
      ? this.completedAt - this.startedAt
      : undefined;
    this.updatedAt = Date.now();
  }

  /**
   * 取消任务
   */
  cancel(): void {
    this.status = TaskStatus.CANCELLED;
    this.updatedAt = Date.now();
  }

  /**
   * 更新任务
   * @param updates 更新内容
   */
  update(updates: Partial<Task>): void {
    Object.assign(this, updates);
    this.updatedAt = Date.now();
  }

  /**
   * 序列化任务
   * @returns 序列化的数据
   */
  serialize(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      status: this.status,
      priority: this.priority,
      input: this.input,
      output: this.output,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      duration: this.duration,
      metadata: this.metadata,
    };
  }

  /**
   * 从序列化数据创建任务
   * @param data 序列化的数据
   * @returns 任务实例
   */
  static deserialize(data: Record<string, unknown>): Task {
    const task = new TaskImpl({
      name: data.name as string,
      description: data.description as string,
      type: data.type as TaskType,
      priority: data.priority as TaskPriority,
      input: data.input as Record<string, unknown> | undefined,
      metadata: data.metadata as Record<string, unknown> | undefined,
    });

    task.id = data.id as string;
    task.status = data.status as TaskStatus;
    task.output = data.output as Record<string, unknown> | undefined;
    task.error = data.error as string | undefined;
    task.createdAt = data.createdAt as number;
    task.updatedAt = data.updatedAt as number;
    task.startedAt = data.startedAt as number | undefined;
    task.completedAt = data.completedAt as number | undefined;
    task.duration = data.duration as number | undefined;

    return task;
  }
}

/**
 * 创建任务实例
 * @param options 任务创建选项
 * @returns 任务实例
 */
export function createTask(options: {
  name: string;
  description: string;
  type: TaskType;
  priority?: TaskPriority;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Task {
  return new TaskImpl(options);
}
