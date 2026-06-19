import { Logger, LogLevel } from '@modules/monitoring';
import type { SqliteTaskStore } from './db/SqliteTaskStore';
import type { TaskRegistry } from './TaskRegistry';
import type {
  TaskState,
  AuditIssueType,
  AuditIssue,
  AuditReport,
} from './types';
import { TaskStatus, isTerminalTaskStatus } from './types';

const logger = new Logger({ level: LogLevel.INFO });

/** 审计选项 */
export interface AuditOptions {
  stuckThresholdMs: number;
  checkOrphans: boolean;
  checkStuck: boolean;
}

const DEFAULT_OPTIONS: AuditOptions = {
  stuckThresholdMs: 30 * 60 * 1000,
  checkOrphans: true,
  checkStuck: true,
};

/** 审计服务 */
export class TaskAuditService {
  private store: SqliteTaskStore | null;
  private registry: TaskRegistry;
  private options: AuditOptions;

  constructor(
    registry: TaskRegistry,
    store: SqliteTaskStore | null,
    options?: Partial<AuditOptions>
  ) {
    this.registry = registry;
    this.store = store;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async runAudit(): Promise<AuditReport> {
    const startTime = Date.now();
    const tasks = await this.collectAllTasks();
    const issues: AuditIssue[] = [];

    if (this.options.checkOrphans) {
      issues.push(...this.findOrphanSubtasks(tasks));
    }

    if (this.options.checkStuck) {
      issues.push(...this.findStuckTasks(tasks));
    }

    issues.push(...this.findInconsistentStatus(tasks));
    issues.push(...this.findMissingParent(tasks));

    const orphanCount = issues.filter(
      (i) => i.type === 'orphan_subtask'
    ).length;
    const stuckCount = issues.filter((i) => i.type === 'stuck_running').length;
    const inconsistentCount = issues.filter(
      (i) => i.type === 'inconsistent_status'
    ).length;

    logger.info('[TaskAudit] 审计完成', {
      totalTasks: tasks.length,
      issueCount: issues.length,
    });

    return {
      timestamp: startTime,
      totalTasks: tasks.length,
      issues,
      summary: { orphanCount, stuckCount, inconsistentCount },
    };
  }

  private async collectAllTasks(): Promise<TaskState[]> {
    if (this.store) {
      try {
        return await this.store.loadTaskStates();
      } catch (e) {
        logger.warn('[TaskAudit] SQLite 读取失败，回退到 Registry', e);
      }
    }
    return this.registry.getStates();
  }

  private findOrphanSubtasks(tasks: TaskState[]): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const parentIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      const parentId = task.metadata?.parentTaskId as string | undefined;
      if (parentId && !parentIds.has(parentId)) {
        issues.push({
          type: 'orphan_subtask',
          taskId: task.id,
          severity: 'warning',
          message: `子任务 ${task.id} 的父任务 ${parentId} 不存在`,
        });
      }
    }

    return issues;
  }

  private findStuckTasks(tasks: TaskState[]): AuditIssue[] {
    const now = Date.now();
    const issues: AuditIssue[] = [];

    for (const task of tasks) {
      if (
        task.status === TaskStatus.RUNNING &&
        now - task.startTime > this.options.stuckThresholdMs
      ) {
        issues.push({
          type: 'stuck_running',
          taskId: task.id,
          severity: 'error',
          message: `任务 ${task.id} 运行超过 ${this.options.stuckThresholdMs / 60000} 分钟未完成`,
        });
      }
    }

    return issues;
  }

  private findInconsistentStatus(tasks: TaskState[]): AuditIssue[] {
    const issues: AuditIssue[] = [];

    for (const task of tasks) {
      if (isTerminalTaskStatus(task.status) && !task.endTime) {
        issues.push({
          type: 'inconsistent_status',
          taskId: task.id,
          severity: 'warning',
          message: `任务 ${task.id} 状态为 ${task.status} 但缺少 endTime`,
        });
      }
    }

    return issues;
  }

  private findMissingParent(tasks: TaskState[]): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const knownIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      const blocks = task.metadata?.blocks as string[] | undefined;
      if (blocks) {
        for (const blockedId of blocks) {
          if (!knownIds.has(blockedId)) {
            issues.push({
              type: 'missing_parent',
              taskId: task.id,
              severity: 'warning',
              message: `任务 ${task.id} 依赖的任务 ${blockedId} 不存在`,
            });
          }
        }
      }
    }

    return issues;
  }

  async queryAuditLog(
    taskId?: string,
    limit: number = 100
  ): Promise<unknown[]> {
    if (!this.store) {
      logger.warn('[TaskAudit] SQLite 未配置，无法查询审计日志');
      return [];
    }
    return this.store.queryAuditLog(taskId, limit);
  }
}
