/**
 * SessionLifecycleEventBus — 会话生命周期事件总线
 * 事件驱动架构，支持发布/订阅模式
 */

import type { SessionLifecycleEvent, SessionEventType } from './SessionLifecycleEvent';

export type EventHandler = (event: SessionLifecycleEvent) => void | Promise<void>;

export interface Subscription {
  type: SessionEventType | '*';
  handler: EventHandler;
  unsubscribe: () => void;
}

export class SessionLifecycleEventBus {
  private handlers: Map<SessionEventType | '*', Set<EventHandler>> = new Map();
  private history: SessionLifecycleEvent[] = [];
  private maxHistory: number = 1000;

  constructor(maxHistory?: number) {
    if (maxHistory !== undefined) this.maxHistory = maxHistory;
  }

  emit(event: SessionLifecycleEvent): void {
    this.addToHistory(event);

    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        this.invokeHandler(handler, event);
      }
    }

    const wildcardHandlers = this.handlers.get('*');
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        this.invokeHandler(handler, event);
      }
    }
  }

  on(type: SessionEventType | '*', handler: EventHandler): Subscription {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    const subscription: Subscription = {
      type,
      handler,
      unsubscribe: () => {
        this.handlers.get(type)?.delete(handler);
        if (this.handlers.get(type)?.size === 0) {
          this.handlers.delete(type);
        }
      },
    };

    return subscription;
  }

  off(type: SessionEventType | '*', handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
    if (this.handlers.get(type)?.size === 0) {
      this.handlers.delete(type);
    }
  }

  clear(): void {
    this.handlers.clear();
  }

  getHistory(filter?: SessionEventType): SessionLifecycleEvent[] {
    if (filter) {
      return this.history.filter((e) => e.type === filter);
    }
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private addToHistory(event: SessionLifecycleEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  private invokeHandler(handler: EventHandler, event: SessionLifecycleEvent): void {
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
