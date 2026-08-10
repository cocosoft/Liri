/**
 * 工具执行调度器
 * 负责管理和调度多个工具的并行执行
 */

import { Tool } from '../types/Tool.js';
import { ToolResult } from '../types/ToolResult.js';
import { ToolUseContext } from '../types/ToolUseContext.js';
import { createCachedToolExecutor } from '../cache/CachedToolExecutor.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:scheduler:ToolScheduler');

/**
 * 工具执行任务
 */
export interface ToolTask {
  id: string;
  tool: Tool;
  input: Record<string, unknown>;
  context: ToolUseContext;
  priority: number;
  createdAt: number;
}

/**
 * 工具执行结果
 */
export interface ToolTaskResult {
  taskId: string;
  toolName: string;
  result: ToolResult;
  error: string | null;
  executionTime: number;
}

/**
 * 工具调度器类
 */
export class ToolScheduler {
  /** 任务队列 */
  private taskQueue: ToolTask[] = [];
  /** 正在执行的任务 */
  private runningTasks: Map<string, Promise<ToolTaskResult>> = new Map();
  /** 最大并发数 */
  private maxConcurrency: number;
  /** 是否正在运行 */
  private isRunning: boolean = false;
  /** 任务完成回调 */
  private onTaskComplete?: (result: ToolTaskResult) => void;
  /** 任务错误回调 */
  private onTaskError?: (error: Error, task: ToolTask) => void;
  /** 调度器完成回调 */
  private onSchedulerComplete?: () => void;

  /**
   * 构造函数
   * @param maxConcurrency 最大并发数
   */
  constructor(maxConcurrency: number = 4) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 添加任务到队列
   * @param tool 工具实例
   * @param input 工具输入
   * @param context 工具使用上下文
   * @param priority 任务优先级（数字越小优先级越高）
   * @returns 任务ID
   */
  addTask(
    tool: Tool,
    input: Record<string, unknown>,
    context: ToolUseContext,
    priority: number = 0
  ): string {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const task: ToolTask = {
      id: taskId,
      tool,
      input,
      context,
      priority,
      createdAt: Date.now(),
    };

    this.taskQueue.push(task);
    // 按优先级排序
    this.taskQueue.sort((a, b) => a.priority - b.priority);

    // 如果调度器正在运行，尝试执行任务
    if (this.isRunning) {
      this.processQueue();
    }

    return taskId;
  }

  /**
   * 开始调度
   */
  start(): void {
    if (!this.isRunning) {
      this.isRunning = true;
      this.processQueue();
    }
  }

  /**
   * 停止调度
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * 处理任务队列
   */
  private async processQueue(): Promise<void> {
    if (!this.isRunning) return;

    // 检查是否有空闲槽位
    while (
      this.runningTasks.size < this.maxConcurrency &&
      this.taskQueue.length > 0
    ) {
      // 取出任务
      const task = this.taskQueue.shift();
      if (!task) break;

      // 执行任务
      const taskPromise = this.executeTask(task);
      this.runningTasks.set(task.id, taskPromise);

      // 任务完成后处理
      taskPromise
        .then((result) => {
          this.runningTasks.delete(task.id);
          this.onTaskComplete?.(result);
          this.processQueue(); // 继续处理队列

          // 检查是否所有任务都已完成
          if (this.runningTasks.size === 0 && this.taskQueue.length === 0) {
            this.onSchedulerComplete?.();
          }
        })
        .catch((error) => {
          this.runningTasks.delete(task.id);
          this.onTaskError?.(error, task);
          this.processQueue(); // 继续处理队列
        });
    }
  }

  /**
   * 执行单个任务
   * @param task 任务
   * @returns 任务执行结果
   */
  private async executeTask(task: ToolTask): Promise<ToolTaskResult> {
    const startTime = Date.now();
    const executor = createCachedToolExecutor();

    try {
      const result = await executor.execute(
        task.tool,
        task.input,
        task.context
      );
      const executionTime = Date.now() - startTime;

      return {
        taskId: task.id,
        toolName: task.tool.name,
        result,
        error: null,
        executionTime,
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return {
        taskId: task.id,
        toolName: task.tool.name,
        result: null as any,
        error: errorMessage,
        executionTime,
      };
    }
  }

  /**
   * 取消任务
   * @param taskId 任务ID
   * @returns 是否取消成功
   */
  cancelTask(taskId: string): boolean {
    // 从队列中移除
    const queueIndex = this.taskQueue.findIndex((task) => task.id === taskId);
    if (queueIndex !== -1) {
      this.taskQueue.splice(queueIndex, 1);
      return true;
    }

    // 正在执行的任务暂时无法取消
    return false;
  }

  /**
   * 清空任务队列
   */
  clearQueue(): void {
    this.taskQueue = [];
  }

  /**
   * 获取队列大小
   * @returns 队列大小
   */
  getQueueSize(): number {
    return this.taskQueue.length;
  }

  /**
   * 获取正在执行的任务数量
   * @returns 正在执行的任务数量
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size;
  }

  /**
   * 获取任务状态
   * @param taskId 任务ID
   * @returns 任务状态
   */
  getTaskStatus(taskId: string): 'queued' | 'running' | 'not_found' {
    if (this.runningTasks.has(taskId)) {
      return 'running';
    }

    if (this.taskQueue.some((task) => task.id === taskId)) {
      return 'queued';
    }

    return 'not_found';
  }

  /**
   * 设置最大并发数
   * @param maxConcurrency 最大并发数
   */
  setMaxConcurrency(maxConcurrency: number): void {
    this.maxConcurrency = maxConcurrency;
    if (this.isRunning) {
      this.processQueue();
    }
  }

  /**
   * 设置任务完成回调
   * @param callback 回调函数
   */
  setOnTaskComplete(callback: (result: ToolTaskResult) => void): void {
    this.onTaskComplete = callback;
  }

  /**
   * 设置任务错误回调
   * @param callback 回调函数
   */
  setOnTaskError(callback: (error: Error, task: ToolTask) => void): void {
    this.onTaskError = callback;
  }

  /**
   * 设置调度器完成回调
   * @param callback 回调函数
   */
  setOnSchedulerComplete(callback: () => void): void {
    this.onSchedulerComplete = callback;
  }
}

/**
 * 创建工具调度器实例
 * @param maxConcurrency 最大并发数
 * @returns 工具调度器实例
 */
export function createToolScheduler(maxConcurrency: number = 4): ToolScheduler {
  return new ToolScheduler(maxConcurrency);
}
