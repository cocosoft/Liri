/**
 * 消息投递路由器
 * 负责可靠的消息投递，支持重试策略、指数退避、失败队列
 * 配合 MessageQueue 实现无丢失的消息传递
 */
import type { EnhancedMessage, MessageRouteTarget } from './MessageService.js';
import { MessageStatus, MessagePriority } from '../types/message.js';
import { MessageQueue } from './MessageQueue.js';
import type { MessageQueueStats } from './MessageQueue.js';

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000;
const DEFAULT_MAX_RETRIES = 5;

export interface DeliveryRouterConfig {
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  maxRetries: number;
}

export interface DeliveryResult {
  messageId: string;
  success: boolean;
  attempt: number;
  error?: string;
}

export interface DeliveryRouterStats {
  pending: number;
  inFlight: number;
  failed: number;
  delivered: number;
  queueStats: MessageQueueStats;
}

type DeliveryHandler = (message: EnhancedMessage) => Promise<boolean>;

export class DeliveryRouter {
  private queue: MessageQueue;
  private config: DeliveryRouterConfig;
  private deliveryHandler: DeliveryHandler | null = null;
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private inFlight: Set<string> = new Set();
  private failed: EnhancedMessage[] = [];
  private delivered: EnhancedMessage[] = [];
  private maxFailedHistory: number = 200;
  private maxDeliveredHistory: number = 500;

  constructor(config?: Partial<DeliveryRouterConfig>) {
    this.queue = new MessageQueue();
    this.config = {
      baseRetryDelayMs: config?.baseRetryDelayMs ?? BASE_RETRY_DELAY_MS,
      maxRetryDelayMs: config?.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS,
      maxRetries: config?.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
  }

  setDeliveryHandler(handler: DeliveryHandler): void {
    this.deliveryHandler = handler;
  }

  async enqueueAndDeliver(
    message: EnhancedMessage,
    target: MessageRouteTarget,
    targetId?: string
  ): Promise<DeliveryResult> {
    message.routeInfo = {
      target,
      targetId,
      priority: message.priority || MessagePriority.NORMAL,
      timestamp: Date.now(),
      deliveryAttempts: 0,
      delivered: false,
    };
    message.status = MessageStatus.PENDING;

    this.queue.enqueue(message);

    return this.deliver(message);
  }

  private async deliver(message: EnhancedMessage): Promise<DeliveryResult> {
    if (!this.deliveryHandler) {
      return {
        messageId: message.id,
        success: false,
        attempt: message.routeInfo?.deliveryAttempts || 0,
        error: '未设置投递处理器',
      };
    }

    const attempt = (message.routeInfo?.deliveryAttempts || 0) + 1;
    if (message.routeInfo) {
      message.routeInfo.deliveryAttempts = attempt;
    }
    message.status = MessageStatus.PROCESSING;
    this.inFlight.add(message.id);

    try {
      const ok = await this.deliveryHandler(message);

      if (ok) {
        message.status = MessageStatus.COMPLETED;
        if (message.routeInfo) {
          message.routeInfo.delivered = true;
          message.routeInfo.deliveredAt = Date.now();
        }
        this.inFlight.delete(message.id);
        this.delivered.push(message);
        if (this.delivered.length > this.maxDeliveredHistory) {
          this.delivered = this.delivered.slice(-this.maxDeliveredHistory);
        }
        this.queue.remove(message.id);

        return { messageId: message.id, success: true, attempt };
      }

      throw new Error('投递返回失败');
    } catch (err) {
      this.inFlight.delete(message.id);

      if (attempt >= this.config.maxRetries) {
        message.status = MessageStatus.FAILED;
        message.errorDetails = {
          error: String(err),
          lastAttempt: attempt,
          timestamp: Date.now(),
        };
        this.failed.push(message);
        if (this.failed.length > this.maxFailedHistory) {
          this.failed = this.failed.slice(-this.maxFailedHistory);
        }
        this.queue.remove(message.id);

        return {
          messageId: message.id,
          success: false,
          attempt,
          error: String(err),
        };
      }

      message.status = MessageStatus.PENDING;
      const delay = this.calculateDelay(attempt);
      const timer = setTimeout(() => {
        this.retryTimers.delete(message.id);
        this.deliver(message);
      }, delay);
      this.retryTimers.set(message.id, timer);

      return {
        messageId: message.id,
        success: false,
        attempt,
        error: String(err),
      };
    }
  }

  private calculateDelay(attempt: number): number {
    const exponential = this.config.baseRetryDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, this.config.maxRetryDelayMs);
    const jitter = Math.random() * 0.1 * capped;
    return Math.floor(capped + jitter);
  }

  cancelRetry(messageId: string): boolean {
    const timer = this.retryTimers.get(messageId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(messageId);
      this.queue.remove(messageId);
      return true;
    }
    return false;
  }

  cancelAllRetries(): void {
    for (const [id, timer] of this.retryTimers) {
      clearTimeout(timer);
      this.queue.remove(id);
    }
    this.retryTimers.clear();
  }

  getFailedMessages(): EnhancedMessage[] {
    return [...this.failed];
  }

  getDeliveredMessages(): EnhancedMessage[] {
    return [...this.delivered];
  }

  retryFailed(messageId: string): Promise<DeliveryResult> {
    const msg = this.failed.find((m) => m.id === messageId);
    if (!msg) {
      return Promise.resolve({
        messageId,
        success: false,
        attempt: 0,
        error: '消息不在失败队列中',
      });
    }

    this.failed = this.failed.filter((m) => m.id !== messageId);
    msg.status = MessageStatus.PENDING;
    this.queue.enqueue(msg);

    return this.deliver(msg);
  }

  retryAllFailed(): Promise<DeliveryResult[]> {
    const messages = [...this.failed];
    this.failed = [];
    return Promise.all(
      messages.map((msg) => {
        msg.status = MessageStatus.PENDING;
        this.queue.enqueue(msg);
        return this.deliver(msg);
      })
    );
  }

  getStats(): DeliveryRouterStats {
    return {
      pending: this.queue.size(),
      inFlight: this.inFlight.size,
      failed: this.failed.length,
      delivered: this.delivered.length,
      queueStats: this.queue.getStats(),
    };
  }

  clearHistory(): void {
    this.failed = [];
    this.delivered = [];
  }

  getQueue(): MessageQueue {
    return this.queue;
  }
}
