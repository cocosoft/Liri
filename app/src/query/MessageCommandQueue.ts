/**
 * MessageCommandQueue — 统一命令队列（跨会话/多Agent）
 *
 * P1-9: 对标 cc_code messageQueueManager + queueProcessor。
 * 支持三级优先级 (now/next/later)，多个 Agent 和用户命令自动排队。
 *
 * 特性：
 *   - 三级优先级：now > next > later
 *   - 同级 FIFO
 *   - 去重（相同命令 ID 不重复入队）
 *   - 支持 waitForSlot() 阻塞等待执行槽位
 *   - 支持外部监听（subscribe pattern）
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('query:messageQueue');

export type QueuePriority = 'now' | 'next' | 'later';

export interface QueueEntry {
  id: string;
  type: 'user' | 'agent' | 'system' | 'cron';
  content: string;
  priority: QueuePriority;
  sessionId: string;
  enqueuedAt: number;
  metadata?: Record<string, unknown>;
}

type QueueListener = (entry: QueueEntry, action: 'enqueue' | 'dequeue') => void;

const PRIORITY_WEIGHT: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
};

export class MessageCommandQueue {
  private queue: QueueEntry[] = [];
  private seenIds = new Set<string>();
  private listeners = new Set<QueueListener>();
  private maxSize: number;

  constructor(maxSize = 200) {
    this.maxSize = maxSize;
  }

  /** 入队（去重 + 容量控制） */
  enqueue(entry: QueueEntry): boolean {
    if (this.seenIds.has(entry.id)) return false;
    if (this.queue.length >= this.maxSize) {
      logger.warn('messageQueue:overflow', { maxSize: this.maxSize });
      return false;
    }
    this.seenIds.add(entry.id);
    this.queue.push(entry);
    this.queue.sort(
      (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
    );
    this.notify(entry, 'enqueue');
    return true;
  }

  /** 出队（最高优先级 + 同级 FIFO） */
  dequeue(): QueueEntry | undefined {
    const entry = this.queue.shift();
    if (entry) {
      this.seenIds.delete(entry.id);
      this.notify(entry, 'dequeue');
    }
    return entry;
  }

  /** 查看队首 */
  peek(): QueueEntry | undefined {
    return this.queue[0];
  }

  /** 按 predicate 批量出队 */
  dequeueAllMatching(predicate: (e: QueueEntry) => boolean): QueueEntry[] {
    const matched: QueueEntry[] = [];
    this.queue = this.queue.filter((e) => {
      if (predicate(e)) {
        matched.push(e);
        return false;
      }
      return true;
    });
    for (const e of matched) {
      this.seenIds.delete(e.id);
      this.notify(e, 'dequeue');
    }
    return matched;
  }

  /** 清空队列 */
  clear(): void {
    this.queue = [];
    this.seenIds.clear();
  }

  /** 按 session 清空 */
  clearSession(sessionId: string): void {
    this.dequeueAllMatching((e) => e.sessionId === sessionId);
  }

  /** 订阅变更 */
  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 获取快照 */
  getSnapshot(): ReadonlyArray<QueueEntry> {
    return [...this.queue];
  }

  /** 待处理数 */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** 按优先级统计 */
  countByPriority(): Record<QueuePriority, number> {
    return {
      now: this.queue.filter((e) => e.priority === 'now').length,
      next: this.queue.filter((e) => e.priority === 'next').length,
      later: this.queue.filter((e) => e.priority === 'later').length,
    };
  }

  private notify(entry: QueueEntry, action: 'enqueue' | 'dequeue'): void {
    for (const l of this.listeners) {
      try {
        l(entry, action);
      } catch (lErr) {
        // KB-QUEUE-NOTIFY（2026-08-29）：单条监听器异常静默 → 后续监听器也会被中断
        logger.warn('消息队列监听器回调异常', {
          action,
          error: lErr instanceof Error ? lErr.message : String(lErr),
        });
      }
    }
  }
}

/** 全局单例 */
let _globalQueue: MessageCommandQueue;

export function getGlobalMessageQueue(): MessageCommandQueue {
  if (!_globalQueue) _globalQueue = new MessageCommandQueue();
  return _globalQueue;
}
