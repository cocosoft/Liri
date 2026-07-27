/**
 * 工具并行调度器
 * 负责并行执行多个工具，管理执行状态和依赖关系
 */

import { Tool } from './types/Tool';
import { ToolResult, createToolResult } from './types/ToolResult';
import { ToolUseContext } from './types/ToolUseContext';
import { ToolExecutor, createToolExecutor } from './ToolExecutor';
import { v4 as uuidv4 } from 'uuid';
import { Logger, LogLevel } from '@modules/monitoring';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';

const logger = new Logger({
  module: 'tools:orchestrator',
  level: LogLevel.INFO,
});

/**
 * 工具执行任务
 */
export interface ToolExecutionTask {
  /** 任务ID */
  id: string;
  /** 工具实例 */
  tool: Tool;
  /** 工具输入 */
  input: Record<string, unknown>;
  /** 工具使用上下文 */
  context: ToolUseContext;
  /** 依赖的任务ID列表 */
  dependencies?: string[];
  /** 执行优先级（1-10，数字越小优先级越高） */
  priority?: number;
  /** 任务状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 执行结果 */
  result?: ToolResult;
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 重试次数 */
  retries?: number;
  /** 最大重试次数 */
  maxRetries?: number;
}

/**
 * 工具执行批次
 */
export interface ToolExecutionBatch {
  /** 批次ID */
  id: string;
  /** 任务列表 */
  tasks: ToolExecutionTask[];
  /** 批次状态 */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 完成的任务数 */
  completedTasks: number;
  /** 失败的任务数 */
  failedTasks: number;
  /** 取消的任务数 */
  cancelledTasks: number;
}

/**
 * 执行进度回调
 */
export type OrchestratorProgressCallback = (
  batch: ToolExecutionBatch,
  task: ToolExecutionTask
) => void;

/**
 * 工具并行调度器类
 */
export class ToolOrchestrator {
  /** 工具执行器 */
  private executor: ToolExecutor;
  /** 最大并发数 */
  private maxConcurrency: number;
  /** 正在执行的任务数 */
  private runningTasks: number = 0;
  /** 任务队列 */
  private taskQueue: ToolExecutionTask[] = [];
  /** 执行中的任务 */
  private executingTasks: Map<string, ToolExecutionTask> = new Map();
  /** 执行批次 */
  private batches: Map<string, ToolExecutionBatch> = new Map();
  /** 进度回调 */
  private progressCallback?: OrchestratorProgressCallback;
  /** 是否正在运行 */
  private isRunning: boolean = false;
  /** 中止控制器 */
  private abortController: AbortController | null = null;

  /**
   * 构造函数
   * @param executor 工具执行器实例
   * @param maxConcurrency 最大并发数
   */
  constructor(executor?: ToolExecutor, maxConcurrency: number = 5) {
    this.executor = executor || createToolExecutor();
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 设置进度回调
   * @param callback 进度回调函数
   */
  setProgressCallback(callback: OrchestratorProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * 设置最大并发数
   * @param maxConcurrency 最大并发数
   */
  setMaxConcurrency(maxConcurrency: number): void {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * 获取最大并发数
   * @returns 最大并发数
   */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * 创建执行批次
   * @param tasks 任务列表
   * @returns 批次ID
   */
  createBatch(
    tasks: Array<{
      tool: Tool;
      input: Record<string, unknown>;
      context: ToolUseContext;
      dependencies?: string[];
      priority?: number;
      maxRetries?: number;
    }>
  ): string {
    const batchId = uuidv4();
    const batchTasks: ToolExecutionTask[] = tasks.map((task) => ({
      id: uuidv4(),
      tool: task.tool,
      input: task.input,
      context: task.context,
      dependencies: task.dependencies,
      priority: task.priority || 5,
      status: 'pending',
      maxRetries: task.maxRetries || 0,
      retries: 0,
    }));

    const batch: ToolExecutionBatch = {
      id: batchId,
      tasks: batchTasks,
      status: 'pending',
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
    };

    this.batches.set(batchId, batch);
    return batchId;
  }

  /**
   * 执行批次
   * @param batchId 批次ID
   * @returns 批次执行结果
   */
  async executeBatch(batchId: string): Promise<ToolExecutionBatch> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new AppError(
        `Batch not found: ${batchId}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    batch.status = 'running';
    batch.startTime = Date.now();

    this.taskQueue.push(...batch.tasks);
    this.taskQueue.sort((a, b) => (a.priority || 5) - (b.priority || 5));

    this.isRunning = true;
    this.abortController = new AbortController();

    try {
      await this.processQueue(batchId);

      if (batch.failedTasks > 0) {
        batch.status = 'failed';
      } else if (batch.cancelledTasks > 0) {
        batch.status = 'cancelled';
      } else {
        batch.status = 'completed';
      }
    } catch (error) {
      batch.status = 'failed';
      await handleError(error, {
        module: 'tools:orchestrator',
        action: 'executeBatch',
      });
      logger.error('Batch execution failed:', { error });
    } finally {
      batch.endTime = Date.now();
      this.isRunning = false;
      this.abortController = null;
    }

    return batch;
  }

  /**
   * 并行执行多个工具
   * @param tools 工具列表
   * @param inputs 输入列表
   * @param context 工具使用上下文
   * @returns 执行结果列表
   */
  async executeParallel(
    tools: Tool[],
    inputs: Record<string, unknown>[],
    context: ToolUseContext
  ): Promise<ToolResult[]> {
    if (tools.length !== inputs.length) {
      throw new AppError(
        'Tools and inputs length must match',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const tasks = tools.map((tool, index) => ({
      tool,
      input: inputs[index],
      context,
    }));

    const batchId = this.createBatch(tasks);
    const batch = await this.executeBatch(batchId);

    return batch.tasks.map((task) => task.result!);
  }

  /**
   * 处理任务队列
   * @param batchId 批次ID
   */
  private async processQueue(batchId: string): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;

    while (
      this.taskQueue.length > 0 &&
      this.runningTasks < this.maxConcurrency
    ) {
      const executableTasks = this.findExecutableTasks(batchId);
      if (executableTasks.length === 0) break;

      for (const task of executableTasks) {
        if (this.runningTasks >= this.maxConcurrency) break;

        this.taskQueue = this.taskQueue.filter((t) => t.id !== task.id);

        this.executeTask(task, batchId);
      }
    }

    if (this.runningTasks > 0) {
      await this.waitForTasksCompletion();
    }
  }

  /**
   * 找到所有可执行的任务
   * @param batchId 批次ID
   * @returns 可执行的任务列表
   */
  private findExecutableTasks(batchId: string): ToolExecutionTask[] {
    const batch = this.batches.get(batchId);
    if (!batch) return [];

    const executableTasks: ToolExecutionTask[] = [];
    const batchTaskMap = new Map(batch.tasks.map((t) => [t.id, t]));

    for (const task of this.taskQueue) {
      if (!batchTaskMap.has(task.id)) continue;

      if (task.dependencies && task.dependencies.length > 0) {
        let allDependenciesCompleted = true;
        for (const depId of task.dependencies) {
          const depTask = batchTaskMap.get(depId);
          if (!depTask || depTask.status !== 'completed') {
            allDependenciesCompleted = false;
            break;
          }
        }
        if (!allDependenciesCompleted) continue;
      }

      executableTasks.push(task);
    }

    return executableTasks.sort(
      (a, b) => (a.priority || 5) - (b.priority || 5)
    );
  }

  /**
   * 等待任务完成
   */
  private async waitForTasksCompletion(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.runningTasks === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
    });
  }

  /**
   * 找到下一个可执行的任务
   * @param batchId 批次ID
   * @returns 可执行的任务
   */
  private findNextExecutableTask(
    batchId: string
  ): ToolExecutionTask | undefined {
    return this.taskQueue.find((task) => {
      const batch = this.batches.get(batchId);
      if (!batch) return false;

      const isInBatch = batch.tasks.some((t) => t.id === task.id);
      if (!isInBatch) return false;

      if (task.dependencies && task.dependencies.length > 0) {
        const batchTasks = batch.tasks;
        for (const depId of task.dependencies) {
          const depTask = batchTasks.find((t) => t.id === depId);
          if (!depTask || depTask.status !== 'completed') {
            return false;
          }
        }
      }

      return true;
    });
  }

  /**
   * 执行单个任务
   * @param task 任务
   * @param batchId 批次ID
   */
  private async executeTask(
    task: ToolExecutionTask,
    batchId: string
  ): Promise<void> {
    const batch = this.batches.get(batchId);
    if (!batch) return;

    this.runningTasks++;
    this.executingTasks.set(task.id, task);
    task.status = 'running';
    task.startTime = Date.now();

    this.notifyProgress(batch, task);

    try {
      const result = await this.executor.execute(
        task.tool,
        task.input,
        task.context
      );

      task.result = result;
      task.status = 'completed';
      task.endTime = Date.now();

      batch.completedTasks++;
    } catch (error) {
      await handleError(error, {
        module: 'tools:orchestrator',
        action: 'executeTask',
      });
      if (task.retries! < (task.maxRetries || 0)) {
        task.retries!++;
        task.status = 'pending';
        task.startTime = undefined;
        this.taskQueue.push(task);
      } else {
        task.status = 'failed';
        task.endTime = Date.now();
        const errorMessage =
          error instanceof Error ? error.message : 'Execution failed';
        task.result = createToolResult(null, {
          newMessages: [
            {
              role: 'system',
              content: `Error: ${errorMessage}`,
            },
          ],
        });

        batch.failedTasks++;
      }
    } finally {
      this.runningTasks--;
      this.executingTasks.delete(task.id);

      this.notifyProgress(batch, task);

      if (this.isRunning) {
        this.processQueue(batchId);
      }
    }
  }

  /**
   * 通知进度
   * @param batch 批次
   * @param task 任务
   */
  private notifyProgress(
    batch: ToolExecutionBatch,
    task: ToolExecutionTask
  ): void {
    if (this.progressCallback) {
      this.progressCallback(batch, task);
    }
  }

  /**
   * 取消批次执行
   * @param batchId 批次ID
   */
  cancelBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;

    batch.status = 'cancelled';

    for (const task of batch.tasks) {
      if (task.status === 'running') {
        task.status = 'cancelled';
        task.endTime = Date.now();
        batch.cancelledTasks++;
      } else if (task.status === 'pending') {
        this.taskQueue = this.taskQueue.filter((t) => t.id !== task.id);
        task.status = 'cancelled';
        batch.cancelledTasks++;
      }
    }

    for (const [taskId, task] of this.executingTasks.entries()) {
      if (batch.tasks.some((t) => t.id === taskId)) {
        task.status = 'cancelled';
        task.endTime = Date.now();
        batch.cancelledTasks++;
      }
    }

    this.executingTasks.clear();
    this.runningTasks = 0;
  }

  /**
   * 取消所有执行
   */
  cancelAll(): void {
    for (const batchId of this.batches.keys()) {
      this.cancelBatch(batchId);
    }

    this.taskQueue = [];
    this.executingTasks.clear();
    this.runningTasks = 0;
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * 获取批次状态
   * @param batchId 批次ID
   * @returns 批次
   */
  getBatch(batchId: string): ToolExecutionBatch | undefined {
    return this.batches.get(batchId);
  }

  /**
   * 获取所有批次
   * @returns 批次列表
   */
  getBatches(): ToolExecutionBatch[] {
    return Array.from(this.batches.values());
  }

  /**
   * 获取执行统计信息
   * @returns 统计信息
   */
  getStats(): {
    runningTasks: number;
    queuedTasks: number;
    maxConcurrency: number;
    activeBatches: number;
  } {
    return {
      runningTasks: this.runningTasks,
      queuedTasks: this.taskQueue.length,
      maxConcurrency: this.maxConcurrency,
      activeBatches: Array.from(this.batches.values()).filter(
        (batch) => batch.status === 'running' || batch.status === 'pending'
      ).length,
    };
  }

  /**
   * 清理已完成的批次
   */
  cleanupCompletedBatches(): void {
    this.batches = new Map(
      Array.from(this.batches.entries()).filter(
        ([_, batch]) =>
          batch.status !== 'completed' && batch.status !== 'failed'
      )
    );
  }

  /**
   * 检查是否正在运行
   * @returns 是否正在运行
   */
  isExecuting(): boolean {
    return this.isRunning;
  }

  /**
   * 获取工具执行器
   * @returns 工具执行器实例
   */
  getExecutor(): ToolExecutor {
    return this.executor;
  }

  /**
   * 设置工具执行器
   * @param executor 工具执行器实例
   */
  setExecutor(executor: ToolExecutor): void {
    this.executor = executor;
  }
}

/**
 * 创建工具并行调度器实例
 * @param executor 工具执行器实例
 * @param maxConcurrency 最大并发数
 * @returns 工具并行调度器实例
 */
export function createToolOrchestrator(
  executor?: ToolExecutor,
  maxConcurrency: number = 5
): ToolOrchestrator {
  return new ToolOrchestrator(executor, maxConcurrency);
}
