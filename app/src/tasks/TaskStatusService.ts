import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { SqliteTaskStore } from './db/SqliteTaskStore';
import type { TaskRegistry } from './TaskRegistry';
import type { TaskState, SnapshotOptions, TaskStatusSnapshot } from './types';
import { TaskStatus, isTerminalTaskStatus } from './types';

const logger = new Logger({ level: LogLevel.INFO });

const DEFAULT_OPTIONS: SnapshotOptions = {
  recentThresholdMs: 5 * 60 * 1000,
  expiredThresholdMs: 7 * 24 * 60 * 60 * 1000,
};

export class TaskStatusService {
  private registry: TaskRegistry;
  private store: SqliteTaskStore | null;

  constructor(registry: TaskRegistry, store: SqliteTaskStore | null) {
    this.registry = registry;
    this.store = store;
  }

  async takeSnapshot(options?: SnapshotOptions): Promise<TaskStatusSnapshot> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const now = Date.now();
    const tasks = await this.collectTasks();

    const active = tasks.filter((t) => !isTerminalTaskStatus(t.status));
    const recent = tasks.filter(
      (t) =>
        isTerminalTaskStatus(t.status) &&
        (t.endTime ?? t.startTime) >
          now - (opts.recentThresholdMs ?? DEFAULT_OPTIONS.recentThresholdMs!)
    );
    const expired = tasks.filter(
      (t) =>
        isTerminalTaskStatus(t.status) &&
        (t.endTime ?? t.startTime) <
          now - (opts.expiredThresholdMs ?? DEFAULT_OPTIONS.expiredThresholdMs!)
    );

    const byStatus: Record<string, number> = {};
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    }

    return {
      active,
      recent,
      expired,
      summary: { total: tasks.length, byStatus },
    };
  }

  private async collectTasks(): Promise<TaskState[]> {
    if (this.store) {
      try {
        return await this.store.loadTaskStates();
      } catch (e) {
        logger.warn('[TaskStatus] SQLite 读取失败，回退到 Registry', e);
      }
    }
    return this.registry.getStates();
  }
}
