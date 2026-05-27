import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type { SqliteTaskStore } from './db/SqliteTaskStore';
import type { TaskRegistry } from './TaskRegistry';
import type { TaskState, CleanupResult } from './types';
import { TaskStatus, isTerminalTaskStatus } from './types';

const logger = new Logger({ level: LogLevel.INFO });

export interface MaintenanceOptions {
  staleThresholdMs: number;
  maxHistoryDays: number;
  autoRecoverStuck: boolean;
  stuckTimeoutMs: number;
}

const DEFAULT_OPTIONS: MaintenanceOptions = {
  staleThresholdMs: 24 * 60 * 60 * 1000,
  maxHistoryDays: 30,
  autoRecoverStuck: true,
  stuckTimeoutMs: 30 * 60 * 1000,
};

export class TaskMaintenanceService {
  private registry: TaskRegistry;
  private store: SqliteTaskStore | null;
  private options: MaintenanceOptions;

  constructor(
    registry: TaskRegistry,
    store: SqliteTaskStore | null,
    options?: Partial<MaintenanceOptions>
  ) {
    this.registry = registry;
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async runCleanup(): Promise<CleanupResult> {
    const result: CleanupResult = {
      removedCount: 0,
      timedOutCount: 0,
      expiredCount: 0,
      recoveredCount: 0,
      errors: [],
    };

    try {
      const tasks = this.registry.getStates();

      const expiredCount = await this.removeExpiredHistory();
      result.expiredCount = expiredCount;

      if (this.options.autoRecoverStuck) {
        const recovered = await this.recoverStuckTasks(tasks);
        result.recoveredCount = recovered;
      }

      logger.info('[TaskMaintenance] 清理完成', {
        removed: result.removedCount,
        expired: result.expiredCount,
        recovered: result.recoveredCount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(msg);
      logger.error('[TaskMaintenance] 清理异常', e);
    }

    return result;
  }

  private async removeExpiredHistory(): Promise<number> {
    if (!this.store) return 0;

    const tasks = await this.store.loadTaskStates();
    const cutoff =
      Date.now() - this.options.maxHistoryDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const task of tasks) {
      if (
        isTerminalTaskStatus(task.status) &&
        (task.endTime ?? task.startTime) < cutoff
      ) {
        await this.store.deleteTaskState(task.id);
        this.registry.removeTask(task.id);
        removed++;
      }
    }

    return removed;
  }

  private async recoverStuckTasks(tasks: TaskState[]): Promise<number> {
    if (!this.store) return 0;

    const now = Date.now();
    let recovered = 0;

    for (const task of tasks) {
      if (
        task.status === TaskStatus.RUNNING &&
        now - task.startTime > this.options.stuckTimeoutMs
      ) {
        const updated: TaskState = {
          ...task,
          status: TaskStatus.FAILED,
          endTime: now,
          error: `自动恢复: 运行超时 (${this.options.stuckTimeoutMs / 60000}分钟)`,
        };

        await this.store.saveTaskState(updated);
        this.registry.updateState(task.id, updated);
        recovered++;
      }
    }

    return recovered;
  }
}
