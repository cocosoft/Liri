/**
 * 事件系统
 * 基于发布-订阅模式的事件驱动通信机制
 */

import {
  getLogger as resolveCoreLogger,
  type ILogger,
} from '../loggerFacade.js';

let _logger: ILogger | null = null;
function getLogger(): ILogger {
  if (!_logger) {
    _logger = resolveCoreLogger('core:events');
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
 * `publishAndWait` 的投递结果（C2，2026-10-09）
 */
export interface PublishResult {
  /** 成功（未抛错）的监听器数 */
  delivered: number;
  /** 抛错的监听器数（错误已各自记日志，不向发布方抛） */
  failed: number;
}

/**
 * 事件系统接口
 *
 * ## 语义契约（C2，2026-10-09；详见 `.trae/specs/eventbus-semantics.md`）
 * - `publish` = **fire-and-forget**：同步遍历并**启动**监听器，**不 await**；监听器异常各自捕获。
 * - `publishAndWait` = **await-directed**：**按序 await** 全部监听器后返回投递结果。
 * - **durable 不由本总线提供**：需持久化的投递请走会话事件日志（`ChatSession.appendStreamEvent`）
 *   或 `SettlementOutbox` —— 本总线是**进程内内存**广播。
 * - **顺序契约**：任一发布路径均为**先精确匹配、后 `'*'` 通配**（数组序 = 订阅序）。
 */
export interface EventBus {
  subscribe<T = any>(
    event: string,
    listener: EventListener<T>
  ): EventSubscription;
  publish<T = any>(event: string, data?: T): void;
  /**
   * **await-directed** 发布（C2，2026-10-09）：按序 await 全部监听器，返回投递计数。
   *
   * 单监听器失败**不中断**其余（与 `publish` 同口径：各自捕获 + 记日志），**不抛错**。
   */
  publishAndWait<T = any>(event: string, data?: T): Promise<PublishResult>;
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
 * 历史载荷快照（C2/O4，2026-10-09）
 *
 * 顶层浅拷贝：数组 `slice`、普通对象展开、其余（含基本类型/函数/类实例）原样返回。
 * 目的：让历史记录**不持有**发布方/消费方传入的引用，防止后续改写污染历史。
 * （深拷贝在载荷可能含函数/循环引用时不安全；此处按 spec「深拷贝**或**快照」取快照口径。）
 */
function snapshotData(data: unknown): unknown {
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.slice();
  return { ...(data as Record<string, unknown>) };
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

    // C2/O4（2026-10-09）：存**快照**而非发布方传入的引用 ——
    // 防发布方随后改写同一对象而污染历史记录。
    this.#historyStore.push({
      event,
      data: snapshotData(data),
      timestamp: Date.now(),
    });

    if (this.#historyStore.length > this.#maxHistorySize) {
      this.#historyStore.splice(
        0,
        this.#historyStore.length - this.#maxHistorySize
      );
    }
  }

  /**
   * 执行单个监听器并处理错误。
   *
   * @returns `true` = 成功（未抛错）；`false` = 抛错（已记日志）
   */
  private async executeListener(
    listener: EventListener,
    event: string,
    data: unknown
  ): Promise<boolean> {
    try {
      const result = listener(data);

      if (result instanceof Promise) {
        await result;
      }
      return true;
    } catch (error) {
      getLogger().error(`[EventBus] Error in event listener for "${event}":`, {
        error: String(error),
      });
      return false;
    }
  }

  /**
   * 发布事件（**fire-and-forget**，C2）
   *
   * 同步遍历并**启动**监听器（不 await）；监听器异常各自捕获并记日志（不向发布方抛）。
   * 需要"等全部监听器完成"时用 `publishAndWait`。
   *
   * 顺序契约：**先精确匹配、后 `'*'` 通配**。
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
   * 发布事件并**等待**全部监听器完成（**await-directed**，C2，2026-10-09）。
   *
   * 与 `publish` 的差异仅在**是否 await**：本方法按序 `await` 每个精确监听器、再 `await`
   * 每个 `'*'` 监听器；任一监听器抛错 ⇒ `failed+1`，但**其余仍继续**（不中断、不整体抛错）。
   */
  async publishAndWait<T = any>(
    event: string,
    data?: T
  ): Promise<PublishResult> {
    this.recordHistory(event, data);
    this.eventLogger?.(`[EventBus] Publishing (await) event: ${event}`);

    const eventListeners = this.listeners.get(event);
    const wildcardListeners = this.listeners.get('*');
    let delivered = 0;
    let failed = 0;

    const runAll = async (target: Set<EventListener> | undefined) => {
      if (!target || target.size === 0) return;
      // 遍历快照（Array.from）⇒ 监听器在 await 期间新增/退订不影响本轮投递集合
      for (const listener of Array.from(target)) {
        const ok = await this.executeListener(listener, event, data);
        if (ok) delivered++;
        else failed++;
      }
    };

    // 顺序契约：先精确、后通配
    await runAll(eventListeners);
    await runAll(wildcardListeners);

    return { delivered, failed };
  }

  /**
   * 订阅一次事件
   * @param event 事件名称
   * @param listener 事件监听器
   * @returns 订阅对象
   */
  once<T = any>(event: string, listener: EventListener<T>): EventSubscription {
    // C2（2026-10-09）O3：`fired` 幂等守卫 —— 任何时序（重入/并发）下**至多触发一次**；
    // 守卫**先于** unsubscribe，避免"退订失败/重入"导致的重复触发。
    let fired = false;
    const wrappedListener: EventListener<T> = (data) => {
      if (fired) return;
      fired = true;
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
    // C2/O4（2026-10-09）：返回**快照**（新条目 + 数据快照）——
    // 防消费方经返回引用反改历史存储。
    let result = this.#historyEnabled
      ? this.#historyStore.map((e) => ({
          event: e.event,
          data: snapshotData(e.data),
          timestamp: e.timestamp,
        }))
      : [];

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
