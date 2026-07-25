import { Logger, LogLevel } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel/OTelTracing.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { handleError } from '@modules/error';
import type { SqliteTaskStore } from './db/SqliteTaskStore';
import type { TaskState } from './types';
import { TaskStatus } from './types';

const logger = new Logger({
  module: 'tasks:persistentQueue',
  level: LogLevel.INFO,
});

/** 饥饿保护：等待超过此时间（ms）的任务自动提升优先级 */
const AGING_THRESHOLD_MS = 30 * 60 * 1000; // 30 分钟
/** 饥饿保护：单次提升的优先级增量 */
const AGING_PRIORITY_BOOST = 5;
/** 最大饥饿时间（ms），超时强制出队 */
const MAX_STARVATION_MS = 2 * 60 * 60 * 1000; // 2 小时

export interface QueueEntry {
  taskId: string;
  status: QueueStatus;
  enqueuedAt: number;
  dequeuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  priority: number;
}

export type QueueStatus =
  | 'queued'
  | 'dequeued'
  | 'running'
  | 'completed'
  | 'failed';

export interface QueueStats {
  total: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
}

export class PersistentTaskQueue {
  private store: SqliteTaskStore;
  private entries: Map<string, QueueEntry> = new Map();
  private queue: string[] = [];

  constructor(store: SqliteTaskStore) {
    this.store = store;
  }

  async init(): Promise<void> {
    try {
      const tasks = await this.store.loadTaskStates();
      const pending = tasks.filter(
        (t) =>
          t.status === TaskStatus.PENDING || t.status === TaskStatus.RUNNING
      );

      for (const task of pending) {
        const entry: QueueEntry = {
          taskId: task.id,
          status: 'queued',
          enqueuedAt: task.startTime,
          priority: 0,
        };
        this.entries.set(task.id, entry);
        this.queue.push(task.id);
      }

      logger.info('[PersistentTaskQueue] 初始化完成', {
        restored: pending.length,
      });
    } catch (e) {
      await handleError(e, {
        module: 'tasks:persistentQueue',
        action: 'init',
      });
      logger.error('[PersistentTaskQueue] 初始化失败', e);
    }
  }

  async enqueue(taskId: string, priority: number = 0): Promise<void> {
    const otel = getOTelTracing();
    const span = otel.startSpan('queue.enqueue', {
      'task.id': taskId,
      priority: priority,
    });

    const entry: QueueEntry = {
      taskId,
      status: 'queued',
      enqueuedAt: Date.now(),
      priority,
    };

    this.entries.set(taskId, entry);
    this.queue.push(taskId);
    this.queue.sort((a, b) => {
      const pa = this.entries.get(a)?.priority ?? 0;
      const pb = this.entries.get(b)?.priority ?? 0;
      return pb - pa;
    });

    await this.appendAuditLog(taskId, 'enqueue', { priority });
    logger.info('[PersistentTaskQueue] 入队', { taskId, priority });

    otel.endSpan(span, SpanStatusCode.OK);
  }

  async dequeue(): Promise<string | null> {
    // 饥饿保护：先对等待超时的任务提升优先级
    this.applyAging();

    const otel = getOTelTracing();
    const span = otel.startSpan('queue.dequeue', {
      'queue.size': this.queue.length,
    });

    for (let i = 0; i < this.queue.length; i++) {
      const taskId = this.queue[i];
      const entry = this.entries.get(taskId);

      if (entry && entry.status === 'queued') {
        entry.status = 'dequeued';
        entry.dequeuedAt = Date.now();
        this.queue.splice(i, 1);

        await this.appendAuditLog(taskId, 'dequeue', {});

        span.setAttribute('task.id', taskId);
        otel.endSpan(span, SpanStatusCode.OK);
        return taskId;
      }
    }

    otel.endSpan(span, SpanStatusCode.OK);
    return null;
  }

  /**
   * 饥饿保护：等待超时的任务自动提升优先级
   */
  private applyAging(): void {
    const now = Date.now();

    for (const [taskId, entry] of this.entries) {
      if (entry.status !== 'queued') continue;

      const waitTime = now - entry.enqueuedAt;

      // 超过最大饥饿时间：强制提升到最高优先级
      if (waitTime > MAX_STARVATION_MS) {
        entry.priority = Number.MAX_SAFE_INTEGER;
        logger.warn('Task forced to front due to max starvation', {
          taskId,
          waitTimeMs: waitTime,
        });
        continue;
      }

      // 超过老化阈值：逐步提升优先级
      if (waitTime > AGING_THRESHOLD_MS) {
        const boosts = Math.floor(waitTime / AGING_THRESHOLD_MS);
        entry.priority += boosts * AGING_PRIORITY_BOOST;
        logger.info('Task priority boosted due to aging', {
          taskId,
          waitTimeMs: waitTime,
          newPriority: entry.priority,
        });
      }
    }

    // 重新排序
    this.queue.sort((a, b) => {
      const pa = this.entries.get(a)?.priority ?? 0;
      const pb = this.entries.get(b)?.priority ?? 0;
      return pb - pa;
    });
  }

  async markRunning(taskId: string): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry) return;

    entry.status = 'running';
    entry.startedAt = Date.now();
    await this.appendAuditLog(taskId, 'started', {});
  }

  async markCompleted(taskId: string, error?: string): Promise<void> {
    const entry = this.entries.get(taskId);
    if (!entry) return;

    entry.status = error ? 'failed' : 'completed';
    entry.completedAt = Date.now();
    entry.error = error;
    this.entries.delete(taskId);

    await this.appendAuditLog(taskId, error ? 'failed' : 'completed', {
      error,
    });
  }

  async stats(): Promise<QueueStats> {
    const all = Array.from(this.entries.values());
    return {
      total: all.length,
      queued: all.filter((e) => e.status === 'queued').length,
      running: all.filter((e) => e.status === 'running').length,
      completed: 0,
      failed: 0,
    };
  }

  isPending(taskId: string): boolean {
    return this.entries.has(taskId);
  }

  private async appendAuditLog(
    taskId: string,
    eventType: string,
    detail: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.store.appendAuditLog(taskId, `queue_${eventType}`, detail);
    } catch (err) {
      // 审计日志写入失败不中断主流程
      await handleError(err, {
        module: 'tasks:persistentQueue',
        action: 'appendAuditLog',
        context: { taskId, eventType },
      });
    }
  }
}
