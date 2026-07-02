import { promises as fs } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { Logger, LogLevel } from '@modules/monitoring';
import type { SqliteTaskStore } from './db/SqliteTaskStore';

const logger = new Logger({ module: 'tasks:registry', level: LogLevel.INFO });

/** LOST 检测：运行中任务超过此时间（ms）无 progress 更新则标记为 LOST */
const LOST_TIMEOUT_MS = 30 * 60 * 1000; // 30 分钟

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
  'lost',
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
  lost: number;
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
    case 'lost':
      return TaskStatus.LOST;
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
    case TaskStatus.LOST:
      return 'lost';
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
  [TaskType.CRON]: 'c',
  [TaskType.DAEMON_PROCESS]: 'p',
};

export class TaskRegistry {
  private tasks: Map<string, BaseTask> = new Map();
  private stateHistory: TaskState[] = [];
  private listeners: Set<(event: TaskEvent) => void> = new Set();
  private persistDir: string | null = null;
  private sqliteStore: SqliteTaskStore | null = null;

  private tasksByOwnerKey: Map<string, Set<string>> = new Map();
  private tasksBySessionKey: Map<string, Set<string>> = new Map();
  private tasksByType: Map<TaskType, Set<string>> = new Map();
  private tasksByStatus: Map<TaskStatus, Set<string>> = new Map();
  private taskCurrentStatus: Map<string, TaskStatus> = new Map();
  /** 记录每个任务最近一次 progress/state 更新的时间戳，用于 LOST 检测 */
  private lastProgressTime: Map<string, number> = new Map();

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
    if (existingTaskId) {
      (task as any).state = { ...(task as any).state, id: existingTaskId };
    }

    this.updateIndexes(task, taskId);

    task.on('stateChanged', (state: TaskState) => {
      const prevStatus = this.taskCurrentStatus.get(taskId);
      this.lastProgressTime.set(taskId, Date.now());
      this.stateHistory.push(state);
      this.notifyListeners({ type: 'stateChanged', taskId, state });

      // 审计日志：状态变更时写入
      if (prevStatus !== undefined && prevStatus !== state.status) {
        this.writeAuditLog(taskId, 'state_change', prevStatus, state.status);
      }

      if (prevStatus !== undefined && prevStatus !== state.status) {
        this.tasksByStatus.get(prevStatus)?.delete(taskId);
      }
      this.tasksByStatus.get(state.status)?.add(taskId);
      this.taskCurrentStatus.set(taskId, state.status);

      if (isTerminalTaskStatus(state.status)) {
        this.notifyListeners({ type: 'taskEnded', taskId, state });
      }
      this.saveTasks();
    });

    task.on('progress', (progress: any) => {
      this.lastProgressTime.set(taskId, Date.now());
      this.notifyListeners({ type: 'progress', taskId, progress });
    });

    task.on('output', (output: any) => {
      this.notifyListeners({ type: 'output', taskId, output });
    });

    this.notifyListeners({ type: 'taskRegistered', taskId });

    return taskId;
  }

  private updateIndexes(task: BaseTask, taskId: string): void {
    const keySet = <T>(map: Map<T, Set<string>>, key: T) => {
      let set = map.get(key);
      if (!set) {
        set = new Set();
        map.set(key, set);
      }
      set.add(taskId);
    };

    keySet(this.tasksByType, task.type);
    keySet(this.tasksByStatus, task.status);
    this.taskCurrentStatus.set(taskId, task.status);

    const meta = task.taskState.metadata;
    if (meta?.ownerKey) {
      keySet(this.tasksByOwnerKey, meta.ownerKey as string);
    }
    if (meta?.sessionKey) {
      keySet(this.tasksBySessionKey, meta.sessionKey as string);
    }
  }

  private removeFromIndexes(taskId: string): void {
    const removeFrom = <T>(map: Map<T, Set<string>>, key: T) => {
      const set = map.get(key);
      if (set) {
        set.delete(taskId);
        if (set.size === 0) map.delete(key);
      }
    };

    for (const [, set] of this.tasksByOwnerKey) set.delete(taskId);
    for (const [, set] of this.tasksBySessionKey) set.delete(taskId);
    for (const [, set] of this.tasksByType) set.delete(taskId);
    this.tasksByStatus.forEach((set) => set.delete(taskId));
    this.taskCurrentStatus.delete(taskId);
  }

  generateTaskId(type: TaskType): string {
    const prefix = TASK_ID_PREFIXES[type] || 'x';
    const timestamp = Date.now().toString(36);
    const rand = randomBytes(4).toString('hex');
    return `${prefix}_${timestamp}_${rand}`;
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
    this.removeFromIndexes(taskId);
    await this.saveTasks();
  }

  getTask<T extends BaseTask>(taskId: string): T | undefined {
    return this.tasks.get(taskId) as T | undefined;
  }

  getAllTasks(): BaseTask[] {
    return Array.from(this.tasks.values());
  }

  getTaskByType(type: TaskType): BaseTask[] {
    const ids = this.tasksByType.get(type);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is BaseTask => t !== undefined);
  }

  getRunningTasks(): BaseTask[] {
    return this.getTasksByStatus(TaskStatus.RUNNING);
  }

  getTasksByStatus(status: TaskStatus): BaseTask[] {
    const ids = this.tasksByStatus.get(status);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is BaseTask => t !== undefined);
  }

  getTasksByOwnerKey(ownerKey: string): BaseTask[] {
    const ids = this.tasksByOwnerKey.get(ownerKey);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is BaseTask => t !== undefined);
  }

  getTasksBySessionKey(sessionKey: string): BaseTask[] {
    const ids = this.tasksBySessionKey.get(sessionKey);
    if (!ids || ids.size === 0) return [];
    return Array.from(ids)
      .map((id) => this.tasks.get(id))
      .filter((t): t is BaseTask => t !== undefined);
  }

  getTaskCountByType(): Record<TaskType, number> {
    const result: Record<string, number> = {};
    for (const [type, ids] of this.tasksByType) {
      result[type] = ids.size;
    }
    return result as Record<TaskType, number>;
  }

  getTaskCountByStatus(): Record<TaskStatus, number> {
    const result: Record<string, number> = {};
    for (const [status, ids] of this.tasksByStatus) {
      result[status] = ids.size;
    }
    return result as Record<TaskStatus, number>;
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
      lost: all.filter((t) => t.status === TaskStatus.LOST).length,
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

  // ─── 审计日志 ───────────────────────────────────────

  /**
   * 写入任务审计日志（SQLite 优先，文件降级）
   */
  private async writeAuditLog(
    taskId: string,
    eventType: string,
    oldStatus: TaskStatus | undefined,
    newStatus: TaskStatus
  ): Promise<void> {
    const entry = {
      taskId,
      eventType,
      oldStatus: oldStatus ?? null,
      newStatus,
      timestamp: Date.now(),
    };

    if (this.sqliteStore) {
      try {
        await this.sqliteStore.writeAuditLog(entry);
        return;
      } catch (error) {
        logger.warn('Audit log write to SQLite failed, falling back to file', {
          taskId,
          error: String(error),
        });
      }
    }

    // 文件降级路径
    if (this.persistDir) {
      try {
        const auditPath = join(this.persistDir, 'audit.jsonl');
        await fs.appendFile(auditPath, JSON.stringify(entry) + '\n', 'utf-8');
      } catch {
        // 降级路径也失败，不阻塞主流程
      }
    }
  }

  /**
   * 查询指定任务的审计日志
   */
  async getAuditLogs(taskId: string): Promise<
    Array<{
      taskId: string;
      eventType: string;
      oldStatus: string | null;
      newStatus: string;
      timestamp: number;
    }>
  > {
    if (this.sqliteStore) {
      return this.sqliteStore.queryAuditLogs(taskId);
    }
    return [];
  }

  // ─── LOST 状态检测 ──────────────────────────────────

  /**
   * 检测运行中超过 LOST_TIMEOUT_MS 无更新的任务，自动标记为 LOST。
   * 返回被标记为 LOST 的任务 ID 列表。
   */
  async detectLostTasks(): Promise<string[]> {
    const now = Date.now();
    const running = this.getRunningTasks();
    const lostIds: string[] = [];

    for (const task of running) {
      const lastTime =
        this.lastProgressTime.get(task.id) ?? task.taskState.startTime;
      if (now - lastTime > LOST_TIMEOUT_MS) {
        const taskId = task.id;
        await task.kill();
        task['updateState']?.({
          status: TaskStatus.LOST,
          endTime: now,
          error: 'Task lost: no progress update for 30 minutes',
        });
        this.writeAuditLog(
          taskId,
          'lost_detected',
          TaskStatus.RUNNING,
          TaskStatus.LOST
        );
        lostIds.push(taskId);
        logger.warn('Task marked as LOST', { taskId, idleMs: now - lastTime });
      }
    }

    return lostIds;
  }

  /**
   * 尝试恢复 LOST 任务（重置状态为 PENDING）
   */
  async recoverLostTask(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== TaskStatus.LOST) return false;

    task['updateState']?.({
      status: TaskStatus.PENDING,
      endTime: undefined,
      error: undefined,
    });
    this.lastProgressTime.set(taskId, Date.now());
    this.writeAuditLog(
      taskId,
      'recovered',
      TaskStatus.LOST,
      TaskStatus.PENDING
    );
    return true;
  }

  /** 获取所有 LOST 状态的任务 */
  getLostTasks(): BaseTask[] {
    return this.getTasksByStatus(TaskStatus.LOST);
  }
}

export const taskRegistry = new TaskRegistry();
