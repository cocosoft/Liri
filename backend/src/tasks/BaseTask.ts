/**
 * 任务基类
 * 基于CC源码 cc_code/backend/tasks/BaseTask.ts 实现
 */

import { EventEmitter } from 'events';
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
} from './types';

export abstract class BaseTask extends EventEmitter {
  abstract readonly type: TaskType;
  protected state: TaskState;
  protected progressTracker: ProgressTracker;
  protected abortController: AbortController;

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
      notified: false,
    };
  }

  abstract spawn(): Promise<void>;
  abstract kill(): Promise<void>;

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
    return {
      toolUseCount: this.progressTracker.toolUseCount,
      tokenCount:
        this.progressTracker.latestInputTokens +
        this.progressTracker.cumulativeOutputTokens,
      lastActivity: this.progressTracker.recentActivities[0],
      recentActivities: this.progressTracker.recentActivities.slice(0, 5),
    };
  }

  protected updateState(updates: Partial<TaskState>): void {
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
  }

  protected setStatus(status: TaskStatus, error?: string): void {
    this.updateState({
      status,
      endTime: isTerminalTaskStatus(status) ? Date.now() : undefined,
      error,
    });
  }

  protected emitProgress(): void {
    this.emit('progress', this.getProgress());
  }

  protected getAbortSignal(): AbortSignal {
    return this.abortController.signal;
  }
}
