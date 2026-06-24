/**
 * SessionLifecycleEventBus — 会话生命周期事件总线
 *
 * 继承自 EventBusImpl，添加类型安全的事件类型、通配符支持与事件历史。
 * 无需重新实现 EventBus 接口——所有标准方法（subscribe/publish/once/unsubscribe 等）均继承自父类。
 * 本层仅提供：
 *   1. 类型安全的事件类型（SessionEventType）
 *   2. 通配符 '*' 支持（监听所有事件）
 *   3. 事件历史记录
 */

import {
  EventBusImpl,
  type EventSubscription,
  type EventListener as CoreEventListener,
} from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type {
  SessionLifecycleEvent,
  SessionEventType,
} from './SessionLifecycleEvent';

export type EventHandler = (
  event: SessionLifecycleEvent
) => void | Promise<void>;

export interface Subscription {
  type: SessionEventType | '*';
  handler: EventHandler;
  unsubscribe: () => void;
}

const logger = getLogger('SessionLifecycleEventBus');

export class SessionLifecycleEventBus extends EventBusImpl {
  /** 通配符处理器（'*' 监听所有事件），EventBusImpl 原生不支持通配符 */
  private wildcardHandlers = new Set<EventHandler>();

  /** 事件历史记录 */
  private history: SessionLifecycleEvent[] = [];
  private maxHistory: number = 1000;

  constructor(maxHistory?: number) {
    super();
    if (maxHistory !== undefined) this.maxHistory = maxHistory;
  }

  /**
   * 发布会话生命周期事件（带通配符分发与历史记录）
   */
  emit(event: SessionLifecycleEvent): void {
    this.addToHistory(event);

    // 委托父类 EventBusImpl 分发（以事件类型名为 key）
    super.publish(event.type, event);

    // 通配符处理器接收所有事件
    for (const handler of this.wildcardHandlers) {
      this.invokeHandler(handler, event);
    }
  }

  /**
   * 发布事件（标准 EventBus 接口覆盖）
   * 将通用 publish 调用包装为 SessionLifecycleEvent 后交由 emit 处理
   */
  override publish<T = any>(event: string, data?: T): void {
    this.emit({
      type: event as SessionEventType,
      sessionKey: '',
      sessionId: '',
      timestamp: Date.now(),
      metadata: data as Record<string, unknown>,
    } as SessionLifecycleEvent);
  }

  /**
   * 订阅特定类型事件或通配符 '*' 事件
   */
  override on<T = any>(
    event: string,
    listener: CoreEventListener<T>
  ): EventSubscription {
    const type = event as SessionEventType | '*';

    if (type === '*') {
      const handler = listener as unknown as EventHandler;
      this.wildcardHandlers.add(handler);
      return {
        unsubscribe: () => {
          this.wildcardHandlers.delete(handler);
        },
      };
    }

    return super.subscribe(type, listener);
  }

  /**
   * 移除指定处理器
   */
  off(type: SessionEventType | '*', handler: EventHandler): void {
    if (type === '*') {
      this.wildcardHandlers.delete(handler);
      return;
    }
    super.unsubscribe(type, handler as any);
  }

  /**
   * 清除所有处理器和事件历史
   */
  clear(): void {
    super.unsubscribeAll();
    this.wildcardHandlers.clear();
  }

  /**
   * 获取事件历史
   */
  override getHistory(filter?: {
    event?: string;
    limit?: number;
  }): import('@modules/core/events/EventBus').HistoryEntry[] {
    let result = [...this.history];

    if (filter?.event) {
      result = result.filter((e) => e.type === filter.event);
    }

    if (filter?.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result.map((e) => ({
      event: e.type,
      data: e,
      timestamp: e.timestamp,
    }));
  }

  /**
   * 获取原始 SessionLifecycleEvent 历史
   * 当需要访问 SessionLifecycleEvent 特有字段时使用
   */
  getSessionHistory(filter?: SessionEventType): SessionLifecycleEvent[] {
    if (filter) {
      return this.history.filter((e) => e.type === filter);
    }
    return [...this.history];
  }

  /**
   * 清空事件历史
   */
  override clearHistory(): void {
    this.history = [];
  }

  private addToHistory(event: SessionLifecycleEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  private invokeHandler(
    handler: EventHandler,
    event: SessionLifecycleEvent
  ): void {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger.error('Session lifecycle event handler error', {
            error: String(err),
          });
        });
      }
    } catch (err) {
      logger.error('Session lifecycle event handler error', {
        error: String(err),
      });
    }
  }
}

let globalEventBus: SessionLifecycleEventBus | null = null;

export function getGlobalEventBus(): SessionLifecycleEventBus {
  if (!globalEventBus) {
    globalEventBus = new SessionLifecycleEventBus();
  }
  return globalEventBus;
}

export function resetGlobalEventBus(): void {
  globalEventBus = null;
}
