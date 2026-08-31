/**
 * 任务基类
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import {
  isTerminalTaskStatus,
  createProgressTracker,
  TaskStatus,
} from './types';
import type {
  TaskState,
  TaskType,
  ProgressTracker,
  AgentProgress,
  ToolActivity,
  TaskContext,
} from './types';

// 直连实现文件避免 barrel 循环（@modules/monitoring、@modules/error barrel 会拉入
// tasks 相关模块 → 触发 NoteTask extends BaseTask 时的 TDZ；参照 paths.ts 先例）
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error/handleError';
const logger = getLogger('tasks:BaseTask');

// 注意：@modules/config barrel 会拉入 tasks 相关模块（循环 import），
// 阈值读取用惰性 require（首次调用时 configManager 已初始化），避免模块加载期循环。
let _circuitBreakerThreshold: number | undefined;
/** P1-1（2026-08-31）：任务级熔断阈值（连续失败次数，达阈值自动置 BLOCKED）。默认 3，TASK_CIRCUIT_BREAKER_THRESHOLD 可覆盖。 */
export function getCircuitBreakerThreshold(): number {
  if (_circuitBreakerThreshold === undefined) {
    try {
      const { configManager } =
        require('@modules/config') as typeof import('@modules/config');
      _circuitBreakerThreshold =
        Number(configManager.env('TASK_CIRCUIT_BREAKER_THRESHOLD')) || 3;
    } catch {
      _circuitBreakerThreshold = 3;
    }
  }
  return _circuitBreakerThreshold;
}

export abstract class BaseTask extends EventEmitter {
  abstract readonly type: TaskType;
  protected state: TaskState;
  protected progressTracker: ProgressTracker;
  protected abortController: AbortController;
  protected taskContext: TaskContext | null = null;

  constructor(
    id: string,
    description: string,
    outputFile: string,
    taskType: TaskType
  ) {
    super();
    this.abortController = new AbortController();
    this.progressTracker = createProgressTracker();
    this.state = {
      id,
      type: taskType,
      status: TaskStatus.PENDING,
      description,
      startTime: Date.now(),
      toolUseCount: 0,
      tokenCount: 0,
      outputFile,
      outputOffset: 0,
      notified: false,
      metadata: undefined,
    };
  }

  setTaskContext(ctx: TaskContext): void {
    this.taskContext = ctx;
  }

  abstract spawn(): Promise<void>;
  abstract kill(): Promise<void>;

  /**
   * 释放任务持有的资源。
   * 由 TaskRegistry.remove() 自动调用，子类可重写以释放子进程、文件句柄等。
   */
  async cleanup(): Promise<void> {
    // 默认空实现，子类按需重写
  }

  get id(): string {
    return this.state.id;
  }

  get status(): TaskStatus {
    return this.state.status;
  }

  get taskType(): TaskType {
    return this.state.type;
  }

  get taskState(): TaskState {
    return { ...this.state };
  }

  getProgress(): AgentProgress {
    // 优先使用内存 ProgressTracker，重启后回退到 TaskState 持久化数据
    const activities =
      this.progressTracker.recentActivities.length > 0
        ? this.progressTracker.recentActivities.slice(0, 5)
        : this.state.toolActivities || [];
    return {
      toolUseCount:
        this.progressTracker.toolUseCount || this.state.toolUseCount || 0,
      tokenCount:
        this.progressTracker.latestInputTokens +
          this.progressTracker.cumulativeOutputTokens ||
        this.state.tokenCount ||
        0,
      lastActivity: activities[0],
      recentActivities: activities,
    };
  }

  // BUG-8 fix: 从 protected 改为 public，TaskRegistry 不需要字符串索引绕过
  public updateState(updates: Partial<TaskState>): void {
    this.state = { ...this.state, ...updates };
    this.emit('stateChanged', this.state);
  }

  protected updateProgress(
    toolUseCount: number,
    inputTokens: number,
    outputTokens: number
  ): void {
    this.progressTracker.toolUseCount = toolUseCount;
    this.progressTracker.latestInputTokens = inputTokens;
    this.progressTracker.cumulativeOutputTokens += outputTokens;

    this.state.toolUseCount = toolUseCount;
    this.state.tokenCount =
      this.progressTracker.latestInputTokens +
      this.progressTracker.cumulativeOutputTokens;

    this.emit('progress', this.getProgress());
  }

  protected addActivity(activity: ToolActivity): void {
    this.progressTracker.recentActivities.unshift(activity);
    if (this.progressTracker.recentActivities.length > 10) {
      this.progressTracker.recentActivities.pop();
    }
    // 持久化最近活动到 TaskState，支持进度恢复
    this.state.toolActivities = this.progressTracker.recentActivities.slice(
      0,
      5
    );
  }

  protected setStatus(status: TaskStatus, error?: string): void {
    // P1-1（2026-08-31）：任务级熔断——FAILED 递增连续失败计数，其他状态重置；
    // 达到阈值自动降级为 BLOCKED（非终态，等待人工处理），避免长任务反复失败空转。
    const threshold = getCircuitBreakerThreshold();
    const consecutiveFailures =
      status === TaskStatus.FAILED
        ? (this.state.consecutiveFailures ?? 0) + 1
        : 0;

    const nextStatus =
      status === TaskStatus.FAILED && consecutiveFailures >= threshold
        ? TaskStatus.BLOCKED
        : status;

    const updates: Partial<TaskState> = {
      status: nextStatus,
      consecutiveFailures,
      error,
    };
    if (nextStatus === TaskStatus.BLOCKED) {
      updates.circuitBreakReason = `连续失败 ${consecutiveFailures} 次触发任务熔断（阈值 ${threshold}）`;
      logger.warn('任务熔断：连续失败达阈值，自动置 BLOCKED', {
        taskId: this.state.id,
        consecutiveFailures,
        threshold,
        reason: updates.circuitBreakReason,
        error,
      });
    } else if (status !== TaskStatus.FAILED) {
      // 非失败状态清除熔断原因（计数已重置为 0）
      updates.circuitBreakReason = undefined;
    }

    this.updateState({
      ...updates,
      endTime: isTerminalTaskStatus(nextStatus) ? Date.now() : undefined,
    });
  }

  protected emitProgress(): void {
    this.emit('progress', this.getProgress());
  }

  protected getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }

  protected async writeOutput(chunk: string): Promise<void> {
    if (!this.state.outputFile) return;
    try {
      await fs.appendFile(this.state.outputFile, chunk, 'utf-8');
      this.state.outputOffset += Buffer.byteLength(chunk, 'utf-8');
    } catch (err) {
      // 写入失败时不抛出异常，仅跳过本次写入
      void handleError(err, {
        module: 'tasks:BaseTask',
        action: 'writeOutput',
      });
    }
  }

  protected async readOutput(): Promise<string> {
    if (!this.state.outputFile) return '';
    try {
      const content = await fs.readFile(this.state.outputFile, 'utf-8');
      return content;
    } catch (err) {
      void handleError(err, {
        module: 'tasks:BaseTask',
        action: 'readOutput',
      });
      return '';
    }
  }

  protected async clearOutput(): Promise<void> {
    if (!this.state.outputFile) return;
    try {
      await fs.writeFile(this.state.outputFile, '', 'utf-8');
      this.state.outputOffset = 0;
    } catch (err) {
      // 清空失败时不抛出异常，仅跳过
      void handleError(err, {
        module: 'tasks:BaseTask',
        action: 'clearOutput',
      });
    }
    if (this.taskContext?.getAppState) {
      const appState = this.taskContext.getAppState();
      const tasks = (appState as Record<string, unknown>)['tasks'] as
        | Record<string, unknown>
        | undefined;
      if (tasks && typeof tasks === 'object') {
        const taskEntry = tasks[this.state.id] as
          | Record<string, unknown>
          | undefined;
        if (taskEntry) {
          taskEntry.outputOffset = 0;
        }
      }
    }
  }
}
