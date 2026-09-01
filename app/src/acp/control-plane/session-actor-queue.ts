import { handleError } from '@modules/error';

type Task<T = void> = () => Promise<T>;

interface QueuedTask<T> {
  task: Task<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export class SessionActorQueue {
  private queue: QueuedTask<unknown>[] = [];
  private running = false;
  private sessionKey: string;

  constructor(sessionKey: string) {
    this.sessionKey = sessionKey;
  }

  enqueue<T>(task: Task<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as Task<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      if (!this.running) {
        this.processNext();
      }
    });
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    this.running = true;
    const item = this.queue.shift()!;

    try {
      const result = await item.task();
      item.resolve(result);
    } catch (error) {
      void handleError(error, { module: 'acp:actor', action: 'processNext' });
      item.reject(error);
    }

    setImmediate(() => this.processNext());
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  clear(): void {
    this.queue = [];
    this.running = false;
  }
}

const actorQueues = new Map<string, SessionActorQueue>();

export function getSessionActorQueue(sessionKey: string): SessionActorQueue {
  let queue = actorQueues.get(sessionKey);
  if (!queue) {
    queue = new SessionActorQueue(sessionKey);
    actorQueues.set(sessionKey, queue);
  }
  return queue;
}

export function clearSessionActorQueue(sessionKey: string): void {
  const queue = actorQueues.get(sessionKey);
  if (queue) {
    queue.clear();
    actorQueues.delete(sessionKey);
  }
}
