/**
 * Agent Internal Events
 * 对标OpenClaw agents/internal-events.ts
 * Agent内部事件系统
 */

export type EventPriority = 'low' | 'normal' | 'high';

export interface AgentEvent {
  id: string;
  type: string;
  source: string;
  target?: string;
  data?: unknown;
  priority: EventPriority;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface EventSubscription {
  id: string;
  type: string | '*';
  handler: EventHandler;
  priority: EventPriority;
  once: boolean;
}

export interface EventHandler {
  (event: AgentEvent): Promise<void> | void;
}

export interface EventStats {
  totalEmitted: number;
  totalHandled: number;
  activeSubscriptions: number;
  eventsByType: Record<string, number>;
}

export class InternalEventBus {
  private subscriptions: Map<string, EventSubscription[]> = new Map();
  private history: AgentEvent[] = [];
  private stats: EventStats;
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 1000) {
    this.maxHistorySize = maxHistorySize;
    this.stats = {
      totalEmitted: 0,
      totalHandled: 0,
      activeSubscriptions: 0,
      eventsByType: {},
    };
  }

  subscribe(
    type: string,
    handler: EventHandler,
    options?: { priority?: EventPriority; once?: boolean },
  ): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const subscription: EventSubscription = {
      id,
      type,
      handler,
      priority: options?.priority ?? 'normal',
      once: options?.once ?? false,
    };

    const existing = this.subscriptions.get(type) ?? [];
    existing.push(subscription);
    this.subscriptions.set(type, existing);

    if (type !== '*') {
      const wildcard = this.subscriptions.get('*') ?? [];
      this.stats.activeSubscriptions = this.countAllSubscriptions();
    }

    this.stats.activeSubscriptions = this.countAllSubscriptions();

    return id;
  }

  subscribeOnce(type: string, handler: EventHandler, priority?: EventPriority): string {
    return this.subscribe(type, handler, { priority, once: true });
  }

  unsubscribe(id: string): boolean {
    for (const [, subs] of this.subscriptions) {
      const index = subs.findIndex((s) => s.id === id);
      if (index !== -1) {
        subs.splice(index, 1);
        this.stats.activeSubscriptions = this.countAllSubscriptions();
        return true;
      }
    }

    return false;
  }

  async emit(type: string, data?: unknown, options?: { source?: string; target?: string; priority?: EventPriority }): Promise<AgentEvent> {
    const event: AgentEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      source: options?.source ?? 'system',
      target: options?.target,
      data,
      priority: options?.priority ?? 'normal',
      timestamp: Date.now(),
    };

    this.stats.totalEmitted++;
    this.stats.eventsByType[type] = (this.stats.eventsByType[type] ?? 0) + 1;

    this.addToHistory(event);

    const handlers = [
      ...(this.subscriptions.get(type) ?? []),
      ...(this.subscriptions.get('*') ?? []),
    ];

    handlers.sort((a, b) => {
      const priorityOrder: Record<EventPriority, number> = { high: 3, normal: 2, low: 1 };
      return (priorityOrder[b.priority] ?? 0) - (priorityOrder[a.priority] ?? 0);
    });

    const toRemove: string[] = [];

    for (const sub of handlers) {
      try {
        await sub.handler(event);
        this.stats.totalHandled++;

        if (sub.once) {
          toRemove.push(sub.id);
        }
      } catch (error) {
        console.error(`Event handler error for ${type}:`, error);
      }
    }

    for (const id of toRemove) {
      this.unsubscribe(id);
    }

    return event;
  }

  async emitAsync(type: string, data?: unknown, options?: { source?: string; target?: string; priority?: EventPriority }): Promise<AgentEvent> {
    return this.emit(type, data, options);
  }

  getHistory(filter?: { type?: string; source?: string; limit?: number }): AgentEvent[] {
    let result = [...this.history];

    if (filter?.type) {
      result = result.filter((e) => e.type === filter.type);
    }

    if (filter?.source) {
      result = result.filter((e) => e.source === filter.source);
    }

    result.reverse();

    if (filter?.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  clearHistory(): void {
    this.history = [];
  }

  getStats(): EventStats {
    return { ...this.stats };
  }

  hasSubscribers(type: string): boolean {
    const direct = this.subscriptions.get(type);
    const wildcard = this.subscriptions.get('*');

    return (direct !== undefined && direct.length > 0) ||
      (wildcard !== undefined && wildcard.length > 0);
  }

  subscriberCount(type: string): number {
    const direct = this.subscriptions.get(type)?.length ?? 0;
    const wildcard = this.subscriptions.get('*')?.length ?? 0;
    return direct + wildcard;
  }

  private addToHistory(event: AgentEvent): void {
    this.history.push(event);

    if (this.history.length > this.maxHistorySize) {
      this.history.splice(0, this.history.length - this.maxHistorySize);
    }
  }

  private countAllSubscriptions(): number {
    let count = 0;
    for (const subs of this.subscriptions.values()) {
      count += subs.length;
    }
    return count;
  }
}

export function createEventBus(maxHistorySize?: number): InternalEventBus {
  return new InternalEventBus(maxHistorySize);
}
