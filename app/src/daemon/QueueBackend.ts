import { join } from 'path';
import { Logger, LogLevel } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';
import { TaskPriority } from './TaskPriority';
import type { Task, TaskResult } from './types';

const logger = new Logger({
  module: 'daemon:queueBackend',
  level: LogLevel.INFO,
});

export interface QueuedTaskEntry {
  task: Task;
  resolve: (result: TaskResult) => void;
  controller: AbortController;
  retries: number;
}

export interface QueueBackend {
  enqueue(entry: QueuedTaskEntry, priority: TaskPriority): Promise<void> | void;
  dequeue(priority: TaskPriority): QueuedTaskEntry | undefined;
  remove(taskId: string): QueuedTaskEntry | undefined;
  peek(priority: TaskPriority): QueuedTaskEntry | undefined;
  contains(taskId: string): boolean;
  pendingCount(): number;
  pendingByPriority(): Map<TaskPriority, number>;
  flush(): Promise<void> | void;
}

export class InMemoryQueueBackend implements QueueBackend {
  private queues: Map<TaskPriority, QueuedTaskEntry[]>;

  constructor() {
    this.queues = new Map();
    for (const p of Object.values(TaskPriority).filter(
      (v) => typeof v === 'number'
    )) {
      this.queues.set(p as TaskPriority, []);
    }
  }

  enqueue(entry: QueuedTaskEntry, priority: TaskPriority): void {
    const queue = this.queues.get(priority);
    if (queue) queue.push(entry);
  }

  dequeue(priority: TaskPriority): QueuedTaskEntry | undefined {
    return this.queues.get(priority)?.shift();
  }

  remove(taskId: string): QueuedTaskEntry | undefined {
    for (const [, queue] of this.queues) {
      const idx = queue.findIndex((e) => e.task.id === taskId);
      if (idx !== -1) return queue.splice(idx, 1)[0];
    }
    return undefined;
  }

  peek(priority: TaskPriority): QueuedTaskEntry | undefined {
    const queue = this.queues.get(priority);
    return queue && queue.length > 0 ? queue[0] : undefined;
  }

  contains(taskId: string): boolean {
    for (const [, queue] of this.queues) {
      if (queue.some((e) => e.task.id === taskId)) return true;
    }
    return false;
  }

  pendingCount(): number {
    let count = 0;
    for (const [, queue] of this.queues) count += queue.length;
    return count;
  }

  pendingByPriority(): Map<TaskPriority, number> {
    const result = new Map<TaskPriority, number>();
    for (const [p, queue] of this.queues) {
      result.set(p, queue.length);
    }
    return result;
  }

  flush(): void {
    for (const [, queue] of this.queues) {
      queue.length = 0;
    }
  }
}

export class SqliteQueueBackend implements QueueBackend {
  private entries: Map<string, QueuedTaskEntry> = new Map();
  private priorityOrder: TaskPriority[][] = [
    [TaskPriority.CRITICAL],
    [TaskPriority.HIGH],
    [TaskPriority.NORMAL],
    [TaskPriority.LOW],
  ];
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || resolveDbPath();
  }

  enqueue(entry: QueuedTaskEntry, priority: TaskPriority): void {
    this.entries.set(entry.task.id, entry);
  }

  dequeue(priority: TaskPriority): QueuedTaskEntry | undefined {
    for (const [id, entry] of this.entries) {
      if (entry.task.priority === priority) {
        this.entries.delete(id);
        return entry;
      }
    }
    return undefined;
  }

  remove(taskId: string): QueuedTaskEntry | undefined {
    const entry = this.entries.get(taskId);
    if (entry) this.entries.delete(taskId);
    return entry;
  }

  peek(priority: TaskPriority): QueuedTaskEntry | undefined {
    for (const [, entry] of this.entries) {
      if (entry.task.priority === priority) return entry;
    }
    return undefined;
  }

  contains(taskId: string): boolean {
    return this.entries.has(taskId);
  }

  pendingCount(): number {
    return this.entries.size;
  }

  pendingByPriority(): Map<TaskPriority, number> {
    const result = new Map<TaskPriority, number>();
    for (const p of Object.values(TaskPriority).filter(
      (v) => typeof v === 'number'
    )) {
      result.set(p as TaskPriority, 0);
    }
    for (const [, entry] of this.entries) {
      const p = entry.task.priority;
      result.set(p, (result.get(p) || 0) + 1);
    }
    return result;
  }

  flush(): void {
    this.entries.clear();
  }
}
