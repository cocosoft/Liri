import { join } from 'path';
import { getLogger } from '@modules/monitoring';
import { TaskPriority } from './types';
import type { Task, TaskResult } from './types';

const logger = getLogger('daemon:queueBackend');

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
