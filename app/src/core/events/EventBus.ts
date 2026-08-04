/**
 * 事件系统
 * 基于发布-订阅模式的事件驱动通信机制
 */

import { Logger, LogLevel } from '@modules/monitoring';

let _logger: Logger | null = null;
function getLogger(): Logger {
  if (!_logger) {
    _logger = new Logger({ level: LogLevel.INFO });
  }
  return _logger;
}

/**
 * 事件监听器接口
 */
export interface EventListener<T = any> {
  (event: T): void | Promise<void>;
}

/**
 * 事件订阅接口
 */
export interface EventSubscription {
  unsubscribe(): void;
}

/**
 * 事件系统接口
 */
export interface EventBus {
  subscribe<T = any>(
    event: string,
    listener: EventListener<T>
  ): EventSubscription;
  publish<T = any>(event: string, data?: T): void;
  once<T = any>(event: string, listener: EventListener<T>): EventSubscription;
  unsubscribe(event: string, listener: EventListener): void;
  unsubscribeAll(event?: string): void;
  hasListeners(event: string): boolean;
  listenerCount(event: string): number;
}

/**
 * 事件历史条目
 */
export interface HistoryEntry {
  event: string;
  data: unknown;
  timestamp: number;
}

/**
 * 事件系统类
 */
export class EventBusImpl implements EventBus {
  private listeners: Map<string, Set<EventListener>> = new Map();
  private eventLogger?: (message: string) => void;
  #historyEnabled: boolean;
  #maxHistorySize: number;
  #historyStore: HistoryEntry[] = [];

  constructor(
    eventLogger?: (message: string) => void,
    options?: {
      /** 是否启用事件历史记录 */
      historyEnabled?: boolean;
      /** 最大历史记录条数 */
      maxHistorySize?: number;
    }
  ) {
    this.eventLogger = eventLogger;
    this.#historyEnabled = options?.historyEnabled ?? false;
    this.#maxHistorySize = options?.maxHistorySize ?? 1000;
  }

  /**
   * 订阅事件
   * @param event 事件名称
   * @param listener 事件监听器
   * @returns 订阅对象
   */
  subscribe<T = any>(
    event: string,
    listener: EventListener<T>
  ): EventSubscription {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(listener);

    this.eventLogger?.(`[EventBus] Subscribed to event: ${event}`);

    return {
      unsubscribe: () => {
        this.unsubscribe(event, listener);
      },
    };
  }

  /**
   * 订阅事件（subscribe 的别名，兼容 InternalEventBus 调用方）
   * @param event 事件名称
   * @param listener 事件监听器
   * @returns 订阅对象
   */
  on<T = any>(event: string, listener: EventListener<T>): EventSubscription {
    return this.subscribe(event, listener);
  }

  /**
   * 记录事件到历史
   */
  private recordHistory(event: string, data: unknown): void {
    if (!this.#historyEnabled) return;

    this.#historyStore.push({ event, data, timestamp: Date.now() });

    if (this.#historyStore.length > this.#maxHistorySize) {
      this.#historyStore.splice(
        0,
        this.#historyStore.length - this.#maxHistorySize
      );
    }
  }

  /**
   * 执行单个监听器并处理错误
   */
  private async executeListener(
    listener: EventListener,
    event: string,
    data: unknown
  ): Promise<void> {
    try {
      const result = listener(data);

      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      getLogger().error(`[EventBus] Error in event listener for "${event}":`, {
        error: String(error),
      });
    }
  }

  /**
   * 发布事件
   * @param event 事件名称
   * @param data 事件数据
   */
  publish<T = any>(event: string, data?: T): void {
    this.recordHistory(event, data);

    this.eventLogger?.(`[EventBus] Publishing event: ${event}`);

    // 获取精确匹配的监听器和通配符(*)监听器
    const eventListeners = this.listeners.get(event);
    const wildcardListeners = this.listeners.get('*');

    if (
      (!eventListeners || eventListeners.size === 0) &&
      (!wildcardListeners || wildcardListeners.size === 0)
    ) {
      return;
    }

    // 先执行精确匹配的监听器
    if (eventListeners && eventListeners.size > 0) {
      for (const listener of eventListeners) {
        this.executeListener(listener, event, data);
      }
    }

    // 再执行通配符监听器
    if (wildcardListeners && wildcardListeners.size > 0) {
      for (const listener of wildcardListeners) {
        this.executeListener(listener, event, data);
      }
    }
  }

  /**
   * 订阅一次事件
   * @param event 事件名称
   * @param listener 事件监听器
   * @returns 订阅对象
   */
  once<T = any>(event: string, listener: EventListener<T>): EventSubscription {
    const wrappedListener: EventListener<T> = (data) => {
      this.unsubscribe(event, wrappedListener);
      return listener(data);
    };

    return this.subscribe(event, wrappedListener);
  }

  /**
   * 取消订阅
   * @param event 事件名称
   * @param listener 事件监听器
   */
  unsubscribe(event: string, listener: EventListener): void {
    const eventListeners = this.listeners.get(event);

    if (eventListeners) {
      eventListeners.delete(listener);

      if (eventListeners.size === 0) {
        this.listeners.delete(event);
      }

      this.eventLogger?.(`[EventBus] Unsubscribed from event: ${event}`);
    }
  }

  /**
   * 取消所有订阅
   * @param event 可选的事件名称
   */
  unsubscribeAll(event?: string): void {
    if (event) {
      const eventListeners = this.listeners.get(event);
      if (eventListeners) {
        eventListeners.clear();
        this.listeners.delete(event);
        this.eventLogger?.(
          `[EventBus] Unsubscribed all listeners from event: ${event}`
        );
      }
    } else {
      this.listeners.clear();
      this.eventLogger?.(
        '[EventBus] Unsubscribed all listeners from all events'
      );
    }
  }

  /**
   * 检查是否有监听器
   * @param event 事件名称
   * @returns 是否有监听器
   */
  hasListeners(event: string): boolean {
    const eventListeners = this.listeners.get(event);
    return eventListeners !== undefined && eventListeners.size > 0;
  }

  /**
   * 获取监听器数量
   * @param event 事件名称
   * @returns 监听器数量
   */
  listenerCount(event: string): number {
    const eventListeners = this.listeners.get(event);
    return eventListeners ? eventListeners.size : 0;
  }

  /**
   * 获取所有事件名称
   * @returns 事件名称数组
   */
  getEventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  /**
   * 获取事件历史记录
   * @param filter 可选的过滤条件
   * @returns 历史记录数组
   */
  getHistory(filter?: { event?: string; limit?: number }): HistoryEntry[] {
    let result = this.#historyEnabled ? [...this.#historyStore] : [];

    if (filter?.event) {
      result = result.filter((e) => e.event === filter.event);
    }

    result.reverse();

    if (filter?.limit && filter.limit > 0) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 清空事件历史记录
   */
  clearHistory(): void {
    this.#historyStore = [];
  }
}

/**
 * 全局事件总线
 */
export const globalEventBus = new EventBusImpl();

/**
 * 创建事件总线实例
 */
export function createEventBus(logger?: (message: string) => void): EventBus {
  return new EventBusImpl(logger);
}

/**
 * 成本记录事件
 */
export interface CostRecordedEvent {
  /** 模型名称 */
  model: string;
  /** 输入令牌数 */
  inputTokens: number;
  /** 输出令牌数 */
  outputTokens: number;
  /** 缓存读取令牌数 */
  cacheReadInputTokens: number;
  /** 缓存创建令牌数 */
  cacheCreationInputTokens: number;
  /** 成本（美元） */
  costUSD: number;
  /** 时间戳 */
  timestamp: number;
  /** 会话ID */
  sessionId?: string;
  /** [v1.2] 请求唯一标识，用于与 model_usage_logs 表对账 */
  requestId?: string;
}

/**
 * 预定义的系统事件名称
 */
export const SystemEvents = {
  APP_INITIALIZED: 'app:initialized',
  APP_SHUTDOWN: 'app:shutdown',
  APP_ERROR: 'app:error',

  PLUGIN_LOADED: 'plugin:loaded',
  PLUGIN_UNLOADED: 'plugin:unloaded',
  PLUGIN_ENABLED: 'plugin:enabled',
  PLUGIN_DISABLED: 'plugin:disabled',
  PLUGIN_ERROR: 'plugin:error',

  MODULE_INITIALIZED: 'module:initialized',
  MODULE_ERROR: 'module:error',

  STATE_CHANGED: 'state:changed',
  STATE_RESET: 'state:reset',

  MCP_CLIENT_CONNECTED: 'mcp:client:connected',
  MCP_CLIENT_DISCONNECTED: 'mcp:client:disconnected',
  MCP_CLIENT_ERROR: 'mcp:client:error',

  TASK_CREATED: 'task:created',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_CANCELLED: 'task:cancelled',
  TASK_PROGRESS: 'task:progress',

  COST_RECORDED: 'cost:recorded',

  DREAM_STARTED: 'dream:started',
  DREAM_COMPLETED: 'dream:completed',
  DREAM_FAILED: 'dream:failed',

  BUDDY_GROWTH: 'buddy:growth',
  BUDDY_ACHIEVEMENT: 'buddy:achievement',

  NOTIFICATION_SHOWN: 'notification:shown',
  NOTIFICATION_DISMISSED: 'notification:dismissed',

  USER_INTERACTION: 'user:interaction',

  CONFIG_CHANGED: 'config:changed',
  CONFIG_RESET: 'config:reset',

  PERMISSION_GRANTED: 'permission:granted',
  PERMISSION_DENIED: 'permission:denied',

  // 通道事件（从 ChannelEventBus 桥接，仅 3 个跨域事件）
  CHANNEL_CRITICAL_ERROR: 'channel:critical_error',
  CHANNEL_MESSAGE_RECEIVED: 'channel:message_received',
  CHANNEL_CONNECTED_COUNT_CHANGED: 'channel:connected_count_changed',
} as const;

/**
 * 类型安全的发布-订阅帮助类
 */
export class TypedEventBus<T extends Record<string, unknown>> {
  private bus: EventBus;

  constructor(bus?: EventBus) {
    this.bus = bus || new EventBusImpl();
  }

  /**
   * 订阅事件
   */
  on<K extends keyof T>(
    event: K,
    listener: EventListener<T[K]>
  ): EventSubscription {
    return this.bus.subscribe(event as string, listener);
  }

  /**
   * 订阅一次事件
   */
  once<K extends keyof T>(
    event: K,
    listener: EventListener<T[K]>
  ): EventSubscription {
    return this.bus.once(event as string, listener);
  }

  /**
   * 发布事件
   */
  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.bus.publish(event as string, data);
  }

  /**
   * 取消订阅
   */
  off<K extends keyof T>(event: K, listener: EventListener<T[K]>): void {
    this.bus.unsubscribe(event as string, listener);
  }
}
