/**
 * 消息队列
 * 提供会话消息的 FIFO 排队、优先级排序和批量出队功能
 * 配合 DeliveryRouter 实现可靠的消息投递
 */
import type { EnhancedMessage } from './MessageService.js';
import { MessagePriority } from '../types/message.js';

const PRIORITY_ORDER: Record<MessagePriority, number> = {
  [MessagePriority.CRITICAL]: 0,
  [MessagePriority.HIGH]: 1,
  [MessagePriority.NORMAL]: 2,
  [MessagePriority.LOW]: 3,
};

export interface MessageQueueStats {
  total: number;
  byPriority: Record<MessagePriority, number>;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
}

export class MessageQueue {
  private high: EnhancedMessage[] = [];
  private normal: EnhancedMessage[] = [];
  private low: EnhancedMessage[] = [];
  private critical: EnhancedMessage[] = [];

  private queueMap(): Map<MessagePriority, EnhancedMessage[]> {
    return new Map([
      [MessagePriority.CRITICAL, this.critical],
      [MessagePriority.HIGH, this.high],
      [MessagePriority.NORMAL, this.normal],
      [MessagePriority.LOW, this.low],
    ]);
  }

  private priorityArray(priority: MessagePriority): EnhancedMessage[] {
    switch (priority) {
      case MessagePriority.CRITICAL:
        return this.critical;
      case MessagePriority.HIGH:
        return this.high;
      case MessagePriority.NORMAL:
        return this.normal;
      case MessagePriority.LOW:
        return this.low;
    }
  }

  enqueue(message: EnhancedMessage): void {
    const priority = message.priority || MessagePriority.NORMAL;
    const bucket = this.priorityArray(priority);
    bucket.push(message);
  }

  enqueueBatch(messages: EnhancedMessage[]): void {
    for (const msg of messages) {
      this.enqueue(msg);
    }
  }

  dequeue(): EnhancedMessage | null {
    for (const priority of [
      MessagePriority.CRITICAL,
      MessagePriority.HIGH,
      MessagePriority.NORMAL,
      MessagePriority.LOW,
    ]) {
      const bucket = this.priorityArray(priority);
      if (bucket.length > 0) {
        return bucket.shift() || null;
      }
    }
    return null;
  }

  batchDequeue(size: number): EnhancedMessage[] {
    const result: EnhancedMessage[] = [];
    while (result.length < size) {
      const msg = this.dequeue();
      if (msg === null) break;
      result.push(msg);
    }
    return result;
  }

  peek(): EnhancedMessage | null {
    for (const priority of [
      MessagePriority.CRITICAL,
      MessagePriority.HIGH,
      MessagePriority.NORMAL,
      MessagePriority.LOW,
    ]) {
      const bucket = this.priorityArray(priority);
      if (bucket.length > 0) {
        return bucket[0];
      }
    }
    return null;
  }

  size(): number {
    return (
      this.critical.length +
      this.high.length +
      this.normal.length +
      this.low.length
    );
  }

  isEmpty(): boolean {
    return this.size() === 0;
  }

  clear(): void {
    this.critical = [];
    this.high = [];
    this.normal = [];
    this.low = [];
  }

  getAll(): EnhancedMessage[] {
    return [...this.critical, ...this.high, ...this.normal, ...this.low];
  }

  getStats(): MessageQueueStats {
    const byPriority: Record<string, number> = {
      [MessagePriority.CRITICAL]: this.critical.length,
      [MessagePriority.HIGH]: this.high.length,
      [MessagePriority.NORMAL]: this.normal.length,
      [MessagePriority.LOW]: this.low.length,
    };

    const all = this.getAll();
    let oldestTimestamp: number | null = null;
    let newestTimestamp: number | null = null;

    for (const msg of all) {
      const ts = msg.createdAt?.getTime();
      if (ts) {
        if (oldestTimestamp === null || ts < oldestTimestamp)
          oldestTimestamp = ts;
        if (newestTimestamp === null || ts > newestTimestamp)
          newestTimestamp = ts;
      }
    }

    return {
      total: all.length,
      byPriority: byPriority as Record<MessagePriority, number>,
      oldestTimestamp,
      newestTimestamp,
    };
  }

  remove(messageId: string): boolean {
    for (const [, bucket] of this.queueMap()) {
      const idx = bucket.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        bucket.splice(idx, 1);
        return true;
      }
    }
    return false;
  }
}
