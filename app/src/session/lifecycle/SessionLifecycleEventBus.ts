/**
 * SessionLifecycleEventBus — 会话生命周期事件总线
 *
 * 基于 core/events/EventBusImpl 实现的类型安全事件总线。
 * 事件分发委托给 EventBusImpl，本层仅提供：
 *   1. 类型安全的事件类型（SessionEventType）
 *   2. 通配符 '*' 支持（监听所有事件）
 *   3. 事件历史记录
 */

import {
  EventBusImpl,
  EventBus as CoreEventBus,
} from '@modules/core/events/EventBus';
import type { EventSubscription } from '@modules/core/events/EventBus';
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

export class SessionLifecycleEventBus implements CoreEventBus {
  /** 底层事件总线，处理实际的事件订阅与分发 */
  private coreBus = new EventBusImpl();

  /** 通配符处理器（'*' 监听所有事件），EventBusImpl 原生不支持通配符 */
  private wildcardHandlers = new Set<EventHandler>();

  /** 事件历史记录 */
  private history: SessionLifecycleEvent[] = [];
  private maxHistory: number = 1000;

  constructor(maxHistory?: number) {
    if (maxHistory !== undefined) this.maxHistory = maxHistory;
  }

  /**
   * 发布事件
   */
  emit(event: SessionLifecycleEvent): void {
    this.addToHistory(event);

    // 委托给核心 EventBusImpl 分发（类型化事件名）
    this.coreBus.publish(event.type, event);

    // 通配符处理器接收所有事件
    for (const handler of this.wildcardHandlers) {
      this.invokeHandler(handler, event);
    }
  }

  /**
   * 订阅特定类型事件或通配符 '*' 事件
   */
  on(type: SessionEventType | '*', handler: EventHandler): Subscription {
    if (type === '*') {
      this.wildcardHandlers.add(handler);
      return {
        type,
        handler,
        unsubscribe: () => {
          this.wildcardHandlers.delete(handler);
        },
      };
    }

    const sub = this.coreBus.subscribe(type, handler as any);

    return {
      type,
      handler,
      unsubscribe: () => sub.unsubscribe(),
    };
  }

  /**
   * 移除指定处理器
   */
  off(type: SessionEventType | '*', handler: EventHandler): void {
    if (type === '*') {
      this.wildcardHandlers.delete(handler);
      return;
    }
    this.coreBus.unsubscribe(type, handler as any);
  }

  /**
   * 清除所有处理器和事件历史
   */
  clear(): void {
    this.coreBus.unsubscribeAll();
    this.wildcardHandlers.clear();
  }

  /**
   * 获取事件历史
   */
  getHistory(filter?: SessionEventType): SessionLifecycleEvent[] {
    if (filter) {
      return this.history.filter((e) => e.type === filter);
    }
    return [...this.history];
  }

  /**
   * 清空事件历史
   */
  clearHistory(): void {
    this.history = [];
  }

  // ========== Core EventBus 接口实现 ==========

  /**
   * 订阅事件（标准 EventBus 接口）
   */
  subscribe<T = any>(event: string, listener: (event: T) => void | Promise<void>): EventSubscription {
    const sub = this.on(event as SessionEventType, listener as EventHandler);
    return { unsubscribe: () => sub.unsubscribe() };
  }

  /**
   * 发布事件（标准 EventBus 接口）
   */
  publish<T = any>(event: string, data?: T): void {
    this.emit({
      type: event as SessionEventType,
      sessionKey: '',
      sessionId: '',
      timestamp: Date.now(),
      metadata: data as Record<string, unknown>,
    } as SessionLifecycleEvent);
  }

  /**
   * 订阅一次事件
   */
  once<T = any>(event: string, listener: (event: T) => void | Promise<void>): EventSubscription {
    return this.coreBus.once(event, listener);
  }

  /**
   * 取消订阅
   */
  unsubscribe(event: string, listener: (event: any) => void | Promise<void>): void {
    this.off(event as SessionEventType, listener as EventHandler);
  }

  /**
   * 取消所有订阅
   */
  unsubscribeAll(event?: string): void {
    if (event) {
      this.coreBus.unsubscribeAll(event);
    } else {
      this.clear();
    }
  }

  /**
   * 检查是否有监听器
   */
  hasListeners(event: string): boolean {
    return this.coreBus.hasListeners(event);
  }

  /**
   * 获取监听器数量
   */
  listenerCount(event: string): number {
    return this.coreBus.listenerCount(event);
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
          console.error(`Session lifecycle event handler error: ${err}`);
        });
      }
    } catch (err) {
      console.error(`Session lifecycle event handler error: ${err}`);
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
