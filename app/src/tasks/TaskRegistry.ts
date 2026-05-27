import { promises as fs } from 'fs';
import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { SqliteTaskStore } from './db/SqliteTaskStore';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 任务注册表
 */

import { BaseTask } from './BaseTask';
import { NoteTask } from './NoteTask';
import {
  TaskType,
  TaskStatus,
  TaskState,
  TaskEvent,
  isTerminalTaskStatus,
} from './types';

const VALID_DISPLAY_STATUSES = [
  'pending',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const;
export type DisplayStatus = (typeof VALID_DISPLAY_STATUSES)[number];

export interface TaskInfo {
  id: string;
  description: string;
  status: TaskStatus;
  displayStatus: DisplayStatus;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface TaskStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

export function displayToTaskStatus(s: DisplayStatus): TaskStatus {
  switch (s) {
    case 'pending':
      return TaskStatus.PENDING;
    case 'in_progress':
      return TaskStatus.RUNNING;
    case 'completed':
      return TaskStatus.COMPLETED;
    case 'failed':
      return TaskStatus.FAILED;
    case 'cancelled':
      return TaskStatus.KILLED;
  }
}

export function taskStatusToDisplay(s: TaskStatus): DisplayStatus {
  switch (s) {
    case TaskStatus.PENDING:
      return 'pending';
    case TaskStatus.RUNNING:
      return 'in_progress';
    case TaskStatus.COMPLETED:
      return 'completed';
    case TaskStatus.FAILED:
      return 'failed';
    case TaskStatus.KILLED:
      return 'cancelled';
  }
}

function taskToInfo(task: BaseTask): TaskInfo {
  const s = task.taskState;
  return {
    id: s.id,
    description: s.description,
    status: s.status,
    displayStatus: taskStatusToDisplay(s.status),
    createdAt: s.startTime,
    metadata: s.metadata,
  };
}

const TASK_ID_PREFIXES: Record<string, string> = {
  [TaskType.LOCAL_BASH]: 'b',
  [TaskType.LOCAL_AGENT]: 'a',
  [TaskType.REMOTE_AGENT]: 'r',
  [TaskType.IN_PROCESS_TEAMMATE]: 't',
  [TaskType.DREAM]: 'd',
  [TaskType.WORKFLOW]: 'w',
  [TaskType.MONITOR_MCP]: 'm',
  [TaskType.BACKGROUND_AGENT]: 'g',
};

export class TaskRegistry {
  private tasks: Map<string, BaseTask> = new Map();
  private stateHistory: TaskState[] = [];
  private listeners: Set<(event: TaskEvent) => void> = new Set();
  private persistDir: string | null = null;
  private sqliteStore: SqliteTaskStore | null = null;

  setPersistDir(dir: string): void {
    this.persistDir = dir;
  }

  /** 设置 SQLite 持久化存储（替代 JSON 文件） */
  setSqliteStore(store: SqliteTaskStore): void {
    this.sqliteStore = store;
  }

  /** 持久化文件名 */
  private get persistFilePath(): string | null {
    return this.persistDir ? join(this.persistDir, 'tasks.json') : null;
  }

  /** 保存所有任务状态到磁盘 */
  async saveTasks(): Promise<void> {
    if (this.sqliteStore) {
      try {
        const states = Array.from(this.tasks.entries()).map(
          ([id, task]) => task.taskState
        );
        await this.sqliteStore.saveTaskStates(states);
        return;
      } catch (error) {
        logger.error(
          'Failed to persist tasks via SQLite',
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
    }

    const filePath = this.persistFilePath;
    if (!filePath) return;
    try {
      await fs.mkdir(this.persistDir!, { recursive: true });
      const tasksData = Array.from(this.tasks.entries()).map(
        ([id, task]) => task.taskState
      );
      await fs.writeFile(filePath, JSON.stringify(tasksData, null, 2), 'utf-8');
    } catch (error) {
      logger.error(
        'Failed to persist tasks',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /** 从磁盘加载任务状态 */
  async loadTasks(): Promise<TaskState[]> {
    if (this.sqliteStore) {
      try {
        const states = await this.sqliteStore.loadTaskStates();
        this.stateHistory = states;
        return states;
      } catch (error) {
        logger.error(
          'Failed to load tasks via SQLite',
          error instanceof Error ? error : new Error(String(error))
        );
        return [];
      }
    }

    const filePath = this.persistFilePath;
    if (!filePath) return [];
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const tasksData: TaskState[] = JSON.parse(content);
      this.stateHistory = tasksData;
      return tasksData;
    } catch {
      return [];
    }
  }

  register(task: BaseTask, existingTaskId?: string): string {
    const taskId = existingTaskId || this.generateTaskId(task.type);
    this.tasks.set(taskId, task);
    // 如果使用现有 ID，将其写回 task.state.id 保持一致
    if (existingTaskId) {
      (task as any).state = { ...(task as any).state, id: existingTaskId };
    }

    task.on('stateChanged', (state: TaskState) => {
      this.stateHistory.push(state);
      this.notifyListeners({ type: 'stateChanged', taskId, state });

      if (isTerminalTaskStatus(state.status)) {
        this.notifyListeners({ type: 'taskEnded', taskId, state });
      }
      this.saveTasks();
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
   * 先调用 task.cleanup() 释放资源，再从注册表中移除
   */
  async remove(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      await task.cleanup();
    }
    this.tasks.delete(taskId);
    await this.saveTasks();
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
        logger.error(
          'Task event listener error',
          error instanceof Error ? error : new Error(String(error))
        );
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
    await this.saveTasks();
    this.tasks.clear();
  }

  getStates(): TaskState[] {
    return this.getAllTasks().map((t) => t.taskState);
  }

  updateState(taskId: string, updates: Partial<TaskState>): void {
    const task = this.tasks.get(taskId) as
      | { updateState?: (u: Partial<TaskState>) => void }
      | undefined;
    if (task && typeof task.updateState === 'function') {
      task.updateState(updates);
    }
  }

  getStateHistory(): TaskState[] {
    return [...this.stateHistory];
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  async clearFinishedTasks(): Promise<void> {
    for (const [taskId, task] of this.tasks.entries()) {
      if (isTerminalTaskStatus(task.status)) {
        this.tasks.delete(taskId);
      }
    }
    await this.saveTasks();
  }

  registerNoteTask(description: string): NoteTask {
    const task = new NoteTask(description, description);
    this.register(task, undefined);
    return task;
  }

  getAllTaskInfos(): TaskInfo[] {
    return this.getAllTasks().map(taskToInfo);
  }

  getTaskInfo(taskId: string): TaskInfo | undefined {
    const task = this.getTask(taskId);
    return task ? taskToInfo(task) : undefined;
  }

  getTasksInfoByDisplayStatus(status: DisplayStatus): TaskInfo[] {
    const ts = displayToTaskStatus(status);
    return this.getTasksByStatus(ts).map(taskToInfo);
  }

  getTaskStats(): TaskStats {
    const all = this.getAllTasks();
    return {
      total: all.length,
      pending: all.filter((t) => t.status === TaskStatus.PENDING).length,
      running: all.filter((t) => t.status === TaskStatus.RUNNING).length,
      completed: all.filter((t) => t.status === TaskStatus.COMPLETED).length,
      failed: all.filter((t) => t.status === TaskStatus.FAILED).length,
      cancelled: all.filter((t) => t.status === TaskStatus.KILLED).length,
    };
  }

  async removeTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    await task.kill();
    await this.remove(taskId);
    return true;
  }

  killAll(): Promise<void[]> {
    const running = this.getRunningTasks();
    return Promise.all(running.map((t) => t.kill().catch(() => {})));
  }
}

export const taskRegistry = new TaskRegistry();
