//
/**
 * 状态事件系统
 * 管理状态变更事件的发布、订阅和路由
 */

import {
  BatchUpdateConfig,
  BatchUpdater,
  StateUpdater,
} from '../types/StateTypes';

/**
 * 事件类型
 */
export enum StateEventType {
  STATE_CHANGED = 'state_changed',
  BATCH_START = 'batch_start',
  BATCH_END = 'batch_end',
  ERROR = 'error',
  RESET = 'reset',
  STORE_CREATED = 'store_created',
  STORE_DESTROYED = 'store_destroyed',
  SNAPSHOT_CREATED = 'snapshot_created',
  SNAPSHOT_RESTORED = 'snapshot_restored',
}

/**
 * 状态事件
 */
export interface StateEvent {
  type: StateEventType;
  key: string;
  previousValue?: unknown;
  newValue?: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * 事件处理器
 */
export type EventHandler = (event: StateEvent) => void;

/**
 * 事件过滤器
 */
export interface EventFilter {
  name: string;
  filter: (event: StateEvent) => boolean;
}

/**
 * 事件路由规则
 */
export interface EventRoutingRule {
  name: string;
  sourceTypes: StateEventType[];
  targetHandler: EventHandler;
  filter?: EventFilter;
}

/**
 * 批量更新器实现（基于CC源码）
 */
export class BatchUpdaterImpl<T = any> implements BatchUpdater<T> {
  private updates: StateUpdater<T>[];
  private batchingActive: boolean;
  private config: BatchUpdateConfig;
  private onBatchStart?: () => void;
  private onBatchEnd?: () => void;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(
    config: BatchUpdateConfig = {},
    callbacks?: { onBatchStart?: () => void; onBatchEnd?: () => void }
  ) {
    this.updates = [];
    this.batchingActive = false;
    this.config = {
      interval: 16,
      maxBatchSize: 100,
      enabled: true,
      ...config,
    };
    this.onBatchStart = callbacks?.onBatchStart;
    this.onBatchEnd = callbacks?.onBatchEnd;
  }

  /**
   * 开始批量更新（基于CC源码）
   */
  beginBatch(): void {
    if (this.batchingActive) {
      return;
    }

    this.batchingActive = true;
    this.updates = [];

    this.onBatchStart?.();

    console.log('Batch update started');
  }

  /**
   * 结束批量更新（基于CC源码）
   */
  endBatch(): void {
    if (!this.batchingActive) {
      return;
    }

    this.batchingActive = false;

    this.onBatchEnd?.();

    console.log(`Batch update ended with ${this.updates.length} updates`);
  }

  /**
   * 批量更新状态（基于CC源码）
   */
  batchUpdate(updater: StateUpdater<T>): void {
    if (!this.batchingActive) {
      throw new Error('Batch update not started');
    }

    if (this.updates.length >= (this.config.maxBatchSize || 100)) {
      console.warn('Batch update size exceeded maximum');
      return;
    }

    this.updates.push(updater);
  }

  /**
   * 是否在批量更新中（基于CC源码）
   */
  isBatching(): boolean {
    return this.batchingActive;
  }

  /**
   * 获取批量更新队列大小（基于CC源码）
   */
  getBatchSize(): number {
    return this.updates.length;
  }

  /**
   * 获取批量更新（基于CC源码）
   */
  getBatchUpdates(): StateUpdater<T>[] {
    return [...this.updates];
  }

  /**
   * 清空批量更新队列（基于CC源码）
   */
  clearBatch(): void {
    this.updates = [];
  }

  /**
   * 应用批量更新（基于CC源码）
   */
  applyBatch(initialState: T): T {
    let state = initialState;

    for (const updater of this.updates) {
      state = updater(state);
    }

    return state;
  }
}

/**
 * 状态事件系统（基于CC源码）
 */
export class StateEventSystem {
  private handlers: Map<StateEventType, Set<EventHandler>>;
  private filters: Map<string, EventFilter>;
  private routingRules: EventRoutingRule[];
  private eventHistory: StateEvent[];
  private maxHistorySize: number;
  private isEnabled: boolean;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: { maxHistorySize?: number; enabled?: boolean } = {}) {
    this.handlers = new Map();
    this.filters = new Map();
    this.routingRules = [];
    this.eventHistory = [];
    this.maxHistorySize = options.maxHistorySize || 1000;
    this.isEnabled = options.enabled !== undefined ? options.enabled : true;
  }

  /**
   * 发布事件（基于CC源码）
   */
  emit(event: StateEvent): void {
    if (!this.isEnabled) return;

    const eventWithTimestamp = {
      ...event,
      timestamp: event.timestamp || Date.now(),
    };

    this.eventHistory.push(eventWithTimestamp);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    const handlers = this.handlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(eventWithTimestamp);
        } catch (error) {
          console.error('Event handler error:', error);
        }
      }
    }

    this.applyRoutingRules(eventWithTimestamp);
  }

  /**
   * 订阅事件（基于CC源码）
   */
  subscribe(type: StateEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    this.handlers.get(type)!.add(handler);

    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * 取消订阅事件（基于CC源码）
   */
  unsubscribe(type: StateEventType, handler: EventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  /**
   * 添加过滤器（基于CC源码）
   */
  addFilter(filter: EventFilter): void {
    this.filters.set(filter.name, filter);
  }

  /**
   * 移除过滤器（基于CC源码）
   */
  removeFilter(name: string): void {
    this.filters.delete(name);
  }

  /**
   * 添加路由规则（基于CC源码）
   */
  addRoutingRule(rule: EventRoutingRule): void {
    this.routingRules.push(rule);
  }

  /**
   * 移除路由规则（基于CC源码）
   */
  removeRoutingRule(name: string): void {
    this.routingRules = this.routingRules.filter((r) => r.name !== name);
  }

  /**
   * 应用路由规则（基于CC源码）
   */
  private applyRoutingRules(event: StateEvent): void {
    for (const rule of this.routingRules) {
      if (rule.sourceTypes.includes(event.type)) {
        if (rule.filter) {
          const filterFn = this.filters.get(rule.filter.name);
          if (filterFn && !filterFn.filter(event)) {
            continue;
          }
        }
        try {
          rule.targetHandler(event);
        } catch (error) {
          console.error('Routing rule error:', error);
        }
      }
    }
  }

  /**
   * 获取事件历史（基于CC源码）
   */
  getHistory(): StateEvent[] {
    return [...this.eventHistory];
  }

  /**
   * 清除事件历史（基于CC源码）
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 启用事件系统（基于CC源码）
   */
  enable(): void {
    this.isEnabled = true;
  }

  /**
   * 禁用事件系统（基于CC源码）
   */
  disable(): void {
    this.isEnabled = false;
  }

  /**
   * 获取系统状态（基于CC源码）
   */
  getStatus(): {
    enabled: boolean;
    handlerCount: number;
    filterCount: number;
    routingRuleCount: number;
    historySize: number;
  } {
    let handlerCount = 0;
    for (const handlers of this.handlers.values()) {
      handlerCount += handlers.size;
    }

    return {
      enabled: this.isEnabled,
      handlerCount,
      filterCount: this.filters.size,
      routingRuleCount: this.routingRules.length,
      historySize: this.eventHistory.length,
    };
  }

  /**
   * 销毁事件系统（基于CC源码）
   */
  destroy(): void {
    this.handlers.clear();
    this.filters.clear();
    this.routingRules = [];
    this.eventHistory = [];
  }

  /**
   * 创建批量更新器（基于CC源码）
   */
  createBatchUpdater<T>(
    config?: BatchUpdateConfig,
    callbacks?: { onBatchStart?: () => void; onBatchEnd?: () => void }
  ): BatchUpdater<T> {
    return new BatchUpdaterImpl<T>(config, callbacks);
  }
}

/**
 * 创建批量更新器实例
 */
export function createBatchUpdater<T>(
  config?: BatchUpdateConfig,
  callbacks?: { onBatchStart?: () => void; onBatchEnd?: () => void }
): BatchUpdater<T> {
  return new BatchUpdaterImpl<T>(config, callbacks);
}
