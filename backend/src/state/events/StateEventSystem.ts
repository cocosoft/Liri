//
/**
 * 状态事件系统实现（基于CC源码实现）
 * 提供状态变更事件、批量更新、事件过滤、路由等功能
 */

import { 
  StateChangeEvent, 
  BatchUpdateConfig, 
  BatchUpdater,
  StateChangeListener,
  StateUpdater
} from '../types/StateTypes.js';

/**
 * 状态事件类型（基于CC源码）
 */
export enum StateEventType {
  /** 状态变更 */
  STATE_CHANGED = 'state_changed',
  
  /** 批量更新开始 */
  BATCH_START = 'batch_start',
  
  /** 批量更新结束 */
  BATCH_END = 'batch_end',
  
  /** 存储创建 */
  STORE_CREATED = 'store_created',
  
  /** 存储销毁 */
  STORE_DESTROYED = 'store_destroyed',
  
  /** 快照创建 */
  SNAPSHOT_CREATED = 'snapshot_created',
  
  /** 快照恢复 */
  SNAPSHOT_RESTORED = 'snapshot_restored',
  
  /** 持久化开始 */
  PERSISTENCE_START = 'persistence_start',
  
  /** 持久化结束 */
  PERSISTENCE_END = 'persistence_end',
  
  /** 错误发生 */
  ERROR = 'error'
}

/**
 * 状态事件（基于CC源码）
 */
export interface StateEvent {
  /** 事件类型 */
  type: StateEventType;
  
  /** 事件源 */
  source: string;
  
  /** 时间戳 */
  timestamp: Date;
  
  /** 事件数据 */
  data?: any;
  
  /** 元数据 */
  metadata?: Record<string, any>;
}

/**
 * 事件处理器（基于CC源码）
 */
export type EventHandler = (event: StateEvent) => void;

/**
 * 事件过滤器（基于CC源码）
 */
export type EventFilter = (event: StateEvent) => boolean;

/**
 * 事件路由规则（基于CC源码）
 */
export interface EventRoutingRule {
  /** 规则名称 */
  name: string;
  
  /** 匹配条件 */
  condition: (event: StateEvent) => boolean;
  
  /** 目标处理器 */
  target: EventHandler;
  
  /** 优先级 */
  priority?: number;
}

/**
 * 批量更新器实现（基于CC源码）
 */
export class BatchUpdaterImpl<T = any> implements BatchUpdater<T> {
  private updates: StateUpdater<T>[];
  private isBatching: boolean;
  private config: BatchUpdateConfig;
  private onBatchStart?: () => void;
  private onBatchEnd?: () => void;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(config: BatchUpdateConfig = {}, callbacks?: { onBatchStart?: () => void; onBatchEnd?: () => void }) {
    this.updates = [];
    this.isBatching = false;
    this.config = {
      interval: 16, // 默认16ms，约60fps
      maxBatchSize: 100,
      enabled: true,
      ...config
    };
    this.onBatchStart = callbacks?.onBatchStart;
    this.onBatchEnd = callbacks?.onBatchEnd;
  }

  /**
   * 开始批量更新（基于CC源码）
   */
  beginBatch(): void {
    if (this.isBatching) {
      return;
    }

    this.isBatching = true;
    this.updates = [];
    
    this.onBatchStart?.();
    
    console.log('Batch update started');
  }

  /**
   * 结束批量更新（基于CC源码）
   */
  endBatch(): void {
    if (!this.isBatching) {
      return;
    }

    this.isBatching = false;
    
    this.onBatchEnd?.();
    
    console.log(`Batch update ended with ${this.updates.length} updates`);
  }

  /**
   * 批量更新状态（基于CC源码）
   */
  batchUpdate(updater: StateUpdater<T>): void {
    if (!this.isBatching) {
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
    return this.isBatching;
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
    this.isEnabled = options.enabled !== false;
  }

  /**
   * 注册事件处理器（基于CC源码）
   */
  registerHandler(eventType: StateEventType, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  /**
   * 注销事件处理器（基于CC源码）
   */
  unregisterHandler(eventType: StateEventType, handler: EventHandler): boolean {
    const handlers = this.handlers.get(eventType);
    if (!handlers) {
      return false;
    }

    return handlers.delete(handler);
  }

  /**
   * 添加事件过滤器（基于CC源码）
   */
  addFilter(name: string, filter: EventFilter): () => void {
    this.filters.set(name, filter);

    return () => {
      this.filters.delete(name);
    };
  }

  /**
   * 移除事件过滤器（基于CC源码）
   */
  removeFilter(name: string): boolean {
    return this.filters.delete(name);
  }

  /**
   * 添加事件路由规则（基于CC源码）
   */
  addRoutingRule(rule: EventRoutingRule): () => void {
    this.routingRules.push(rule);
    
    // 按优先级排序
    this.routingRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    return () => {
      const index = this.routingRules.indexOf(rule);
      if (index >= 0) {
        this.routingRules.splice(index, 1);
      }
    };
  }

  /**
   * 移除事件路由规则（基于CC源码）
   */
  removeRoutingRule(ruleName: string): boolean {
    const index = this.routingRules.findIndex(rule => rule.name === ruleName);
    if (index === -1) {
      return false;
    }

    this.routingRules.splice(index, 1);
    return true;
  }

  /**
   * 发布事件（基于CC源码）
   */
  publishEvent(event: Omit<StateEvent, 'timestamp'>): void {
    if (!this.isEnabled) {
      return;
    }

    const fullEvent: StateEvent = {
      ...event,
      timestamp: new Date()
    };

    // 应用过滤器
    if (!this.applyFilters(fullEvent)) {
      return;
    }

    // 添加到历史记录
    this.addToHistory(fullEvent);

    // 应用路由规则
    const routedEvents = this.applyRoutingRules(fullEvent);

    // 处理所有事件（包括路由后的事件）
    const allEvents = [fullEvent, ...routedEvents];

    for (const evt of allEvents) {
      this.processEvent(evt);
    }
  }

  /**
   * 获取事件历史（基于CC源码）
   */
  getEventHistory(): StateEvent[] {
    return [...this.eventHistory];
  }

  /**
   * 清空事件历史（基于CC源码）
   */
  clearEventHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 获取事件统计（基于CC源码）
   */
  getEventStats(): { total: number; byType: Record<StateEventType, number>; recent: number } {
    const byType: Record<StateEventType, number> = {} as any;
    
    for (const event of this.eventHistory) {
      byType[event.type] = (byType[event.type] || 0) + 1;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = this.eventHistory.filter(event => event.timestamp > oneHourAgo).length;

    return {
      total: this.eventHistory.length,
      byType,
      recent
    };
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
   * 销毁事件系统（基于CC源码）
   */
  destroy(): void {
    this.handlers.clear();
    this.filters.clear();
    this.routingRules = [];
    this.eventHistory = [];
    this.isEnabled = false;
  }

  /**
   * 应用事件过滤器（基于CC源码）
   */
  private applyFilters(event: StateEvent): boolean {
    if (this.filters.size === 0) {
      return true;
    }

    for (const filter of this.filters.values()) {
      if (!filter(event)) {
        return false;
      }
    }

    return true;
  }

  /**
   * 应用路由规则（基于CC源码）
   */
  private applyRoutingRules(event: StateEvent): StateEvent[] {
    if (this.routingRules.length === 0) {
      return [];
    }

    const routedEvents: StateEvent[] = [];

    for (const rule of this.routingRules) {
      if (rule.condition(event)) {
        const routedEvent: StateEvent = {
          ...event,
          source: `${event.source}->${rule.name}`,
          metadata: {
            ...event.metadata,
            routedBy: rule.name
          }
        };
        
        routedEvents.push(routedEvent);
      }
    }

    return routedEvents;
  }

  /**
   * 处理事件（基于CC源码）
   */
  private processEvent(event: StateEvent): void {
    const handlers = this.handlers.get(event.type);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error(`Event handler failed for type ${event.type}:`, error);
      }
    }
  }

  /**
   * 添加到历史记录（基于CC源码）
   */
  private addToHistory(event: StateEvent): void {
    this.eventHistory.push(event);
    
    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }
}

/**
 * 状态变更监听器包装器（基于CC源码）
 */
export class StateChangeListenerWrapper<T = any> {
  private listener: StateChangeListener<T>;
  private eventSystem: StateEventSystem;
  private storeName: string;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(listener: StateChangeListener<T>, eventSystem: StateEventSystem, storeName: string) {
    this.listener = listener;
    this.eventSystem = eventSystem;
    this.storeName = storeName;
  }

  /**
   * 包装的监听器（基于CC源码）
   */
  wrappedListener(state: T): void {
    // 发布状态变更事件
    this.eventSystem.publishEvent({
      type: StateEventType.STATE_CHANGED,
      source: this.storeName,
      data: { state }
    });

    // 调用原始监听器
    this.listener(state);
  }

  /**
   * 获取原始监听器（基于CC源码）
   */
  getOriginalListener(): StateChangeListener<T> {
    return this.listener;
  }
}

/**
 * 创建批量更新器（基于CC源码）
 */
export function createBatchUpdater<T>(
  config?: BatchUpdateConfig,
  callbacks?: { onBatchStart?: () => void; onBatchEnd?: () => void }
): BatchUpdater<T> {
  return new BatchUpdaterImpl(config, callbacks);
}

/**
 * 创建状态事件系统（基于CC源码）
 */
export function createStateEventSystem(
  options?: { maxHistorySize?: number; enabled?: boolean }
): StateEventSystem {
  return new StateEventSystem(options);
}

/**
 * 创建状态变更监听器包装器（基于CC源码）
 */
export function createStateChangeListenerWrapper<T>(
  listener: StateChangeListener<T>,
  eventSystem: StateEventSystem,
  storeName: string
): StateChangeListenerWrapper<T> {
  return new StateChangeListenerWrapper(listener, eventSystem, storeName);
}

export default {
  StateEventType,
  BatchUpdaterImpl,
  StateEventSystem,
  StateChangeListenerWrapper,
  createBatchUpdater,
  createStateEventSystem,
  createStateChangeListenerWrapper,
};