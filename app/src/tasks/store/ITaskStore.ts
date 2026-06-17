import type { TaskState } from '../types';

/** 任务存储抽象接口 — JSON/SQLite 双模式统一契约 */
export interface ITaskStore {
  loadTaskStates(): Promise<TaskState[]>;
  saveTaskStates(states: TaskState[]): Promise<void>;
  saveTaskState(state: TaskState): Promise<void>;
  deleteTaskState(taskId: string): Promise<void>;
  getTaskState(taskId: string): Promise<TaskState | null>;
  healthCheck(): Promise<boolean>;
  writeAuditLog?(entry: {
    taskId: string;
    eventType: string;
    oldStatus: string | null;
    newStatus: string;
    timestamp: number;
  }): Promise<void>;
  queryAuditLogs?(taskId: string): Promise<
    Array<{
      taskId: string;
      eventType: string;
      oldStatus: string | null;
      newStatus: string;
      timestamp: number;
    }>
  >;
  cleanupExpiredTasks?(retentionDays?: number): Promise<number>;
  rebuildIndexes?(): Promise<void>;
}
