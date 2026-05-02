/**
 * 任务注册表
 * 基于CC源码 cc_code/backend/tasks/TaskRegistry.ts 实现
 */

import { BaseTask } from './BaseTask';
import {
  TaskType,
  TaskStatus,
  TaskState,
  TaskEvent,
  isTerminalTaskStatus,
} from './types';

const TASK_ID_PREFIXES: Record<string, string> = {
  [TaskType.LOCAL_BASH]: 'b',
  [TaskType.LOCAL_AGENT]: 'a',
  [TaskType.REMOTE_AGENT]: 'r',
  [TaskType.IN_PROCESS_TEAMMATE]: 't',
  [TaskType.DREAM]: 'd',
  [TaskType.WORKFLOW]: 'w',
  [TaskType.MONITOR_MCP]: 'm',
};

export class TaskRegistry {
  private tasks: Map<string, BaseTask> = new Map();
  private stateHistory: TaskState[] = [];
  private listeners: Set<(event: TaskEvent) => void> = new Set();

  register(task: BaseTask): string {
    const taskId = this.generateTaskId(task.type);
    this.tasks.set(taskId, task);

    task.on('stateChanged', (state: TaskState) => {
      this.stateHistory.push(state);
      this.notifyListeners({ type: 'stateChanged', taskId, state });

      if (isTerminalTaskStatus(state.status)) {
        this.notifyListeners({ type: 'taskEnded', taskId, state });
      }
    });

    task.on('progress', (progress: any) => {
      this.notifyListeners({ type: 'progress', taskId, progress });
    });

    task.on('output', (output: any) => {
      this.notifyListeners({ type: 'output', taskId, output });
    });

    this.notifyListeners({ type: 'taskRegistered', taskId });

    return taskId;
  }

  generateTaskId(type: TaskType): string {
    const prefix = TASK_ID_PREFIXES[type] || 'x';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}${timestamp}${random}`;
  }

  async kill(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      await task.kill();
    }
  }

  /**
   * 从注册表中移除任务
   * 不会终止任务，仅从注册表中移除
   */
  remove(taskId: string): void {
    this.tasks.delete(taskId);
  }

  getTask<T extends BaseTask>(taskId: string): T | undefined {
    return this.tasks.get(taskId) as T | undefined;
  }

  getAllTasks(): BaseTask[] {
    return Array.from(this.tasks.values());
  }

  getTaskByType(type: TaskType): BaseTask[] {
    return this.getAllTasks().filter((task) => task.type === type);
  }

  getRunningTasks(): BaseTask[] {
    return this.getAllTasks().filter(
      (task) => task.status === TaskStatus.RUNNING
    );
  }

  getTasksByStatus(status: TaskStatus): BaseTask[] {
    return this.getAllTasks().filter((task) => task.status === status);
  }

  addListener(listener: (event: TaskEvent) => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: (event: TaskEvent) => void): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(event: TaskEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Task event listener error:', error);
      }
    }
  }

  async shutdown(): Promise<void> {
    const killPromises = this.getRunningTasks().map((task) =>
      task.kill().catch((error) => ({
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      }))
    );

    await Promise.all(killPromises);
    this.tasks.clear();
  }

  getStateHistory(): TaskState[] {
    return [...this.stateHistory];
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  clearFinishedTasks(): void {
    for (const [taskId, task] of this.tasks.entries()) {
      if (isTerminalTaskStatus(task.status)) {
        this.tasks.delete(taskId);
      }
    }
  }
}

export const taskRegistry = new TaskRegistry();
