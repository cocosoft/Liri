/**
 * 协调器模块
 * 支持多Agent协作，实现任务的并行处理和结果汇总
 */

import { randomUUID } from 'crypto';
import { lazySingleton } from '../utils/common';
import { logger } from '@modules/utils/log.js';

export interface CoordinatorTask {
  id: string;
  description: string;
  prompt: string;
  subagentType?: string;
  priority?: number; // 任务优先级，数字越大优先级越高
  status:
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'stopped'
    | 'timed_out';
  result?: string;
  error?: string;
  startTime?: number;
  endTime?: number;
  timeoutId?: NodeJS.Timeout;
  usage?: {
    totalTokens?: number;
    toolUses?: number;
    durationMs?: number;
  };
}

export interface CoordinatorConfig {
  maxConcurrentTasks: number;
  defaultSubagentType: string;
  timeoutMs: number;
  enableParallelExecution: boolean;
  stopOnError: boolean;
  checkIntervalMs: number; // 任务状态检查间隔
}

const DEFAULT_CONFIG: CoordinatorConfig = {
  maxConcurrentTasks: 5,
  defaultSubagentType: 'general',
  timeoutMs: 600000,
  enableParallelExecution: true,
  stopOnError: false,
  checkIntervalMs: 100, // 默认100ms检查一次
};

export class Coordinator {
  private config: CoordinatorConfig;
  private _agentTool: any = null;
  private tasks: Map<string, CoordinatorTask> = new Map();
  private taskQueue: string[] = [];
  private runningTasks: Set<string> = new Set();
  private taskStatusCache: Map<string, CoordinatorTask> = new Map();

  private get agentTool(): any {
    if (!this._agentTool) {
      const modPath = '@modules/tools/AgentTool/AgentTool';
      const { AgentTool } = require(modPath);
      this._agentTool = new AgentTool();
    }
    return this._agentTool;
  }

  constructor(config?: Partial<CoordinatorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 添加任务到协调器
   */
  addTask(task: Omit<CoordinatorTask, 'id' | 'status' | 'timeoutId'>): string {
    const id = `task-${Date.now()}-${randomUUID().substring(0, 8)}`;
    const newTask: CoordinatorTask = {
      ...task,
      id,
      status: 'pending',
      subagentType: task.subagentType || this.config.defaultSubagentType,
      priority: task.priority || 0,
    };

    this.tasks.set(id, newTask);
    this.taskQueue.push(id);
    // 按优先级排序任务队列
    this.taskQueue.sort((a, b) => {
      const taskA = this.tasks.get(a);
      const taskB = this.tasks.get(b);
      return (taskB?.priority || 0) - (taskA?.priority || 0);
    });

    logger.info(
      `Coordinator: Added task ${id} - ${task.description} (priority: ${newTask.priority})`
    );
    return id;
  }

  /**
   * 批量添加任务
   */
  addTasks(
    tasks: Omit<CoordinatorTask, 'id' | 'status' | 'timeoutId'>[]
  ): string[] {
    return tasks.map((task) => this.addTask(task));
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): CoordinatorTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): CoordinatorTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取待处理任务
   */
  getPendingTasks(): CoordinatorTask[] {
    return this.getAllTasks().filter((t) => t.status === 'pending');
  }

  /**
   * 获取运行中任务
   */
  getRunningTasks(): CoordinatorTask[] {
    return this.getAllTasks().filter((t) => t.status === 'running');
  }

  /**
   * 获取已完成任务
   */
  getCompletedTasks(): CoordinatorTask[] {
    return this.getAllTasks().filter((t) => t.status === 'completed');
  }

  /**
   * 获取失败任务
   */
  getFailedTasks(): CoordinatorTask[] {
    return this.getAllTasks().filter(
      (t) => t.status === 'failed' || t.status === 'timed_out'
    );
  }

  /**
   * 停止任务
   */
  stopTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }

    if (task.timeoutId) {
      clearTimeout(task.timeoutId);
      task.timeoutId = undefined;
    }

    if (task.status === 'running') {
      const success = this.agentTool.stopAgent(taskId);
      if (success) {
        task.status = 'stopped';
        task.endTime = Date.now();
        this.runningTasks.delete(taskId);
        logger.info(`Coordinator: Stopped task ${taskId}`);
        return true;
      }
      return false;
    }

    if (task.status === 'pending') {
      task.status = 'stopped';
      this.taskQueue = this.taskQueue.filter((id) => id !== taskId);
      logger.info(`Coordinator: Removed pending task ${taskId}`);
      return true;
    }

    return false;
  }

  /**
   * 停止所有任务
   */
  stopAllTasks(): number {
    let stopped = 0;
    for (const taskId of this.tasks.keys()) {
      if (this.stopTask(taskId)) {
        stopped++;
      }
    }
    return stopped;
  }

  /**
   * 执行单个任务
   */
  private async executeTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'pending') {
      return;
    }

    task.status = 'running';
    task.startTime = Date.now();
    this.runningTasks.add(taskId);

    // 设置任务超时
    task.timeoutId = setTimeout(() => {
      if (task.status === 'running') {
        task.status = 'timed_out';
        task.error = `Task timed out after ${this.config.timeoutMs}ms`;
        task.endTime = Date.now();
        this.runningTasks.delete(taskId);
        logger.error(`Coordinator: Task ${taskId} timed out`);
      }
    }, this.config.timeoutMs);

    logger.info(`Coordinator: Executing task ${taskId}`);

    try {
      const result = await this.agentTool.execute({
        description: task.description,
        prompt: task.prompt,
        subagent_type: task.subagentType,
      });

      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
        task.timeoutId = undefined;
      }

      if (result.status === 'success') {
        task.status = 'completed';
        task.result = result.output || (result.result as string) || '';
        task.usage = {
          totalTokens: result.metadata?.totalTokens as number,
          toolUses: result.metadata?.toolUses as number,
          durationMs: result.executionTime,
        };
        logger.info(`Coordinator: Task ${taskId} completed`);
      } else {
        task.status = 'failed';
        task.error = result.error || result.errorOutput;
        logger.error(`Coordinator: Task ${taskId} failed - ${task.error}`);
      }
    } catch (error) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
        task.timeoutId = undefined;
      }
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      logger.error(
        `Coordinator: Task ${taskId} failed with exception - ${task.error}`
      );
    } finally {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
        task.timeoutId = undefined;
      }
      task.endTime = Date.now();
      this.runningTasks.delete(taskId);
    }
  }

  /**
   * 执行所有任务
   */
  async executeAll(): Promise<{
    completed: number;
    failed: number;
    stopped: number;
    timedOut: number;
    results: CoordinatorTask[];
  }> {
    const results: CoordinatorTask[] = [];

    while (this.taskQueue.length > 0 || this.runningTasks.size > 0) {
      // 启动新的并行任务
      while (
        this.runningTasks.size < this.config.maxConcurrentTasks &&
        this.taskQueue.length > 0
      ) {
        const taskId = this.taskQueue.shift()!;
        this.executeTask(taskId);
      }

      // 等待一段时间再检查
      await new Promise((resolve) =>
        setTimeout(resolve, this.config.checkIntervalMs)
      );

      // 清理已完成的任务
      for (const [id, task] of this.tasks.entries()) {
        if (task.status !== 'running' && !results.find((r) => r.id === id)) {
          results.push(task);
        }
      }

      // 检查是否需要停止
      if (this.config.stopOnError) {
        const hasFailures = this.getFailedTasks().length > 0;
        if (hasFailures) {
          logger.warn('Coordinator: Stopping due to error (stopOnError=true)');
          this.stopAllTasks();
          break;
        }
      }
    }

    // 获取所有结果
    results.push(
      ...this.getAllTasks().filter((t) => !results.find((r) => r.id === t.id))
    );

    const completed = results.filter((t) => t.status === 'completed').length;
    const failed = results.filter((t) => t.status === 'failed').length;
    const stopped = results.filter((t) => t.status === 'stopped').length;
    const timedOut = results.filter((t) => t.status === 'timed_out').length;

    return { completed, failed, stopped, timedOut, results };
  }

  /**
   * 执行并行任务（简化版本）
   */
  async executeParallel(
    tasks: Array<{
      description: string;
      prompt: string;
      subagentType?: string;
      priority?: number;
    }>
  ): Promise<CoordinatorTask[]> {
    const taskIds = this.addTasks(tasks);
    const { results } = await this.executeAll();
    return results.filter((r) => taskIds.includes(r.id));
  }

  /**
   * 获取执行统计
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    stopped: number;
    timedOut: number;
    averageDuration?: number;
  } {
    const allTasks = this.getAllTasks();
    const completedTasks = allTasks.filter(
      (t) => t.status === 'completed' && t.startTime && t.endTime
    );

    let averageDuration: number | undefined;
    if (completedTasks.length > 0) {
      const totalDuration = completedTasks.reduce((sum, t) => {
        return sum + ((t.endTime || 0) - (t.startTime || 0));
      }, 0);
      averageDuration = totalDuration / completedTasks.length;
    }

    return {
      total: allTasks.length,
      pending: allTasks.filter((t) => t.status === 'pending').length,
      running: allTasks.filter((t) => t.status === 'running').length,
      completed: completedTasks.length,
      failed: allTasks.filter((t) => t.status === 'failed').length,
      stopped: allTasks.filter((t) => t.status === 'stopped').length,
      timedOut: allTasks.filter((t) => t.status === 'timed_out').length,
      averageDuration,
    };
  }

  /**
   * 生成汇总报告
   */
  generateReport(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    lines.push('═'.repeat(60));
    lines.push('COORDINATOR EXECUTION REPORT');
    lines.push('═'.repeat(60));
    lines.push('');
    lines.push('Summary:');
    lines.push(`  Total tasks: ${stats.total}`);
    lines.push(`  Pending: ${stats.pending}`);
    lines.push(`  Running: ${stats.running}`);
    lines.push(`  Completed: ${stats.completed}`);
    lines.push(`  Failed: ${stats.failed}`);
    lines.push(`  Stopped: ${stats.stopped}`);
    lines.push(`  Timed out: ${stats.timedOut}`);
    if (stats.averageDuration) {
      lines.push(
        `  Average duration: ${(stats.averageDuration / 1000).toFixed(2)}s`
      );
    }
    lines.push('');

    // 列出失败的任务
    const failedTasks = this.getAllTasks().filter((t) => t.status === 'failed');
    if (failedTasks.length > 0) {
      lines.push('Failed Tasks:');
      for (const task of failedTasks) {
        lines.push(`  - ${task.description}: ${task.error}`);
      }
      lines.push('');
    }

    // 列出超时的任务
    const timedOutTasks = this.getAllTasks().filter(
      (t) => t.status === 'timed_out'
    );
    if (timedOutTasks.length > 0) {
      lines.push('Timed Out Tasks:');
      for (const task of timedOutTasks) {
        lines.push(`  - ${task.description}`);
      }
      lines.push('');
    }

    // 列出已停止的任务
    const stoppedTasks = this.getAllTasks().filter(
      (t) => t.status === 'stopped'
    );
    if (stoppedTasks.length > 0) {
      lines.push('Stopped Tasks:');
      for (const task of stoppedTasks) {
        lines.push(`  - ${task.description}`);
      }
      lines.push('');
    }

    lines.push('═'.repeat(60));

    return lines.join('\n');
  }

  /**
   * 清除所有任务
   */
  clear(): void {
    this.stopAllTasks();
    this.tasks.clear();
    this.taskQueue = [];
    this.runningTasks.clear();
    this.taskStatusCache.clear();
    logger.info('Coordinator: Cleared all tasks');
  }

  /**
   * 获取任务队列长度
   */
  getQueueLength(): number {
    return this.taskQueue.length;
  }

  /**
   * 获取运行中任务数量
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size;
  }
}

/**
 * 创建协调器实例
 */
export function createCoordinator(
  config?: Partial<CoordinatorConfig>
): Coordinator {
  return new Coordinator(config);
}

/**
 * 全局协调器实例（懒加载）
 */
export const coordinator = lazySingleton(() => new Coordinator());
