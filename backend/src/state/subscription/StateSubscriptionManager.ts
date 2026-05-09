//
/**
 * 状态订阅管理器实现（基于CC源码实现）
 * 提供状态订阅、通知、选择器、性能优化等功能
 */

import { 
  StateSubscription, 
  StateSelector, 
  StateChangeListener,
  SubscribeOptions
} from '../types/StateTypes.js';

/**
 * 订阅管理器选项（基于CC源码）
 */
export interface SubscriptionManagerOptions {
  /** 是否启用性能优化 */
  enablePerformanceOptimization?: boolean;
  
  /** 是否启用选择器缓存 */
  enableSelectorCaching?: boolean;
  
  /** 是否启用批量通知 */
  enableBatchNotification?: boolean;
  
  /** 批量通知间隔（毫秒） */
  batchNotificationInterval?: number;
  
  /** 最大订阅数量 */
  maxSubscriptions?: number;
}

/**
 * 订阅管理器统计信息（基于CC源码）
 */
export interface SubscriptionManagerStats {
  /** 订阅总数 */
  totalSubscriptions: number;
  
  /** 活跃订阅数 */
  activeSubscriptions: number;
  
  /** 选择器订阅数 */
  selectorSubscriptions: number;
  
  /** 通知总数 */
  totalNotifications: number;
  
  /** 批量通知数 */
  batchNotifications: number;
  
  /** 缓存命中率 */
  cacheHitRate: number;
  
  /** 平均通知延迟（毫秒） */
  averageNotificationDelay: number;
}

/**
 * 状态订阅管理器（基于CC源码）
 */
export class StateSubscriptionManager<T = any> {
  private subscriptions: Map<string, StateSubscription<T>>;
  private options: SubscriptionManagerOptions;
  private isBatchNotification: boolean;
  private batchQueue: Array<{ subscription: StateSubscription<T>; value: any }>;
  private batchTimer?: NodeJS.Timeout;
  private stats: {
    totalSubscriptions: number;
    activeSubscriptions: number;
    selectorSubscriptions: number;
    totalNotifications: number;
    batchNotifications: number;
    cacheHits: number;
    cacheMisses: number;
    notificationDelays: number[];
  };

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: SubscriptionManagerOptions = {}) {
    this.subscriptions = new Map();
    this.options = {
      enablePerformanceOptimization: true,
      enableSelectorCaching: true,
      enableBatchNotification: true,
      batchNotificationInterval: 16, // 约60fps
      maxSubscriptions: 1000,
      ...options
    };
    this.isBatchNotification = false;
    this.batchQueue = [];
    
    this.stats = {
      totalSubscriptions: 0,
      activeSubscriptions: 0,
      selectorSubscriptions: 0,
      totalNotifications: 0,
      batchNotifications: 0,
      cacheHits: 0,
      cacheMisses: 0,
      notificationDelays: []
    };
  }

  /**
   * 创建订阅（基于CC源码）
   */
  createSubscription(
    listener: StateChangeListener<T>,
    options: SubscribeOptions<T> = {}
  ): StateSubscription<T> {
    // 检查订阅数量限制
    if (this.subscriptions.size >= (this.options.maxSubscriptions || 1000)) {
      throw new Error('Maximum subscription limit reached');
    }

    const subscription: StateSubscription<T> = {
      id: this.generateSubscriptionId(),
      listener,
      selector: options.selector,
      equalityFn: options.equalityFn || Object.is,
      priority: options.priority || 0,
      active: true
    };

    this.subscriptions.set(subscription.id, subscription);
    
    // 更新统计信息
    this.stats.totalSubscriptions++;
    this.stats.activeSubscriptions++;
    
    if (options.selector) {
      this.stats.selectorSubscriptions++;
    }

    // 如果要求立即触发，调用监听器
    if (options.fireImmediately) {
      const selectedValue = options.selector ? options.selector({} as T) : {} as T;
      subscription.lastSelectedValue = selectedValue;
      listener(selectedValue);
    }

    console.log(`Subscription created: ${subscription.id}`);
    return subscription;
  }

  /**
   * 删除订阅（基于CC源码）
   */
  deleteSubscription(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    subscription.active = false;
    this.subscriptions.delete(subscriptionId);
    
    // 更新统计信息
    this.stats.activeSubscriptions--;
    
    if (subscription.selector) {
      this.stats.selectorSubscriptions--;
    }

    console.log(`Subscription deleted: ${subscriptionId}`);
    return true;
  }

  /**
   * 通知订阅者（基于CC源码）
   */
  notifySubscribers(newState: T, oldState: T): void {
    const startTime = performance.now();

    if (this.subscriptions.size === 0) {
      return;
    }

    // 按优先级排序订阅
    const sortedSubscriptions = Array.from(this.subscriptions.values())
      .filter(sub => sub.active)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (this.options.enableBatchNotification && this.options.batchNotificationInterval) {
      // 批量通知模式
      this.batchNotify(sortedSubscriptions, newState, oldState);
    } else {
      // 立即通知模式
      this.immediateNotify(sortedSubscriptions, newState, oldState);
    }

    // 更新统计信息
    const endTime = performance.now();
    const delay = endTime - startTime;
    this.stats.totalNotifications++;
    this.stats.notificationDelays.push(delay);
    
    // 限制延迟记录数量
    if (this.stats.notificationDelays.length > 100) {
      this.stats.notificationDelays.shift();
    }
  }

  /**
   * 获取订阅（基于CC源码）
   */
  getSubscription(subscriptionId: string): StateSubscription<T> | undefined {
    return this.subscriptions.get(subscriptionId);
  }

  /**
   * 获取所有订阅（基于CC源码）
   */
  getAllSubscriptions(): StateSubscription<T>[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * 获取活跃订阅（基于CC源码）
   */
  getActiveSubscriptions(): StateSubscription<T>[] {
    return Array.from(this.subscriptions.values()).filter(sub => sub.active);
  }

  /**
   * 暂停订阅（基于CC源码）
   */
  pauseSubscription(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    subscription.active = false;
    return true;
  }

  /**
   * 恢复订阅（基于CC源码）
   */
  resumeSubscription(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    subscription.active = true;
    return true;
  }

  /**
   * 更新订阅优先级（基于CC源码）
   */
  updateSubscriptionPriority(subscriptionId: string, priority: number): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return false;
    }

    subscription.priority = priority;
    return true;
  }

  /**
   * 清理所有订阅（基于CC源码）
   */
  clearAllSubscriptions(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.active = false;
    }
    
    this.subscriptions.clear();
    this.stats.activeSubscriptions = 0;
    this.stats.selectorSubscriptions = 0;
    
    console.log('All subscriptions cleared');
  }

  /**
   * 获取统计信息（基于CC源码）
   */
  getStats(): SubscriptionManagerStats {
    const totalCacheAccess = this.stats.cacheHits + this.stats.cacheMisses;
    const cacheHitRate = totalCacheAccess > 0 ? this.stats.cacheHits / totalCacheAccess : 0;
    
    const averageNotificationDelay = this.stats.notificationDelays.length > 0
      ? this.stats.notificationDelays.reduce((sum, delay) => sum + delay, 0) / this.stats.notificationDelays.length
      : 0;

    return {
      totalSubscriptions: this.stats.totalSubscriptions,
      activeSubscriptions: this.stats.activeSubscriptions,
      selectorSubscriptions: this.stats.selectorSubscriptions,
      totalNotifications: this.stats.totalNotifications,
      batchNotifications: this.stats.batchNotifications,
      cacheHitRate,
      averageNotificationDelay
    };
  }

  /**
   * 重置统计信息（基于CC源码）
   */
  resetStats(): void {
    this.stats = {
      totalSubscriptions: this.subscriptions.size,
      activeSubscriptions: this.getActiveSubscriptions().length,
      selectorSubscriptions: this.getAllSubscriptions().filter(sub => sub.selector).length,
      totalNotifications: 0,
      batchNotifications: 0,
      cacheHits: 0,
      cacheMisses: 0,
      notificationDelays: []
    };
  }

  /**
   * 销毁管理器（基于CC源码）
   */
  destroy(): void {
    this.clearAllSubscriptions();
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }
    
    this.batchQueue = [];
    this.isBatchNotification = false;
  }

  /**
   * 批量通知（基于CC源码）
   */
  private batchNotify(
    subscriptions: StateSubscription<T>[],
    newState: T,
    oldState: T
  ): void {
    // 添加到批量队列
    for (const subscription of subscriptions) {
      const value = this.getSubscriptionValue(subscription, newState, oldState);
      if (value !== undefined) {
        this.batchQueue.push({ subscription, value });
      }
    }

    // 启动批量定时器
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatchQueue();
      }, this.options.batchNotificationInterval);
    }
  }

  /**
   * 立即通知（基于CC源码）
   */
  private immediateNotify(
    subscriptions: StateSubscription<T>[],
    newState: T,
    oldState: T
  ): void {
    for (const subscription of subscriptions) {
      const value = this.getSubscriptionValue(subscription, newState, oldState);
      if (value !== undefined) {
        try {
          subscription.listener(value);
        } catch (error) {
          console.error(`Subscription listener failed: ${subscription.id}`, error);
        }
      }
    }
  }

  /**
   * 处理批量队列（基于CC源码）
   */
  private processBatchQueue(): void {
    if (this.batchQueue.length === 0) {
      this.batchTimer = undefined;
      return;
    }

    const batch = [...this.batchQueue];
    this.batchQueue = [];
    this.batchTimer = undefined;

    // 按订阅分组，避免重复通知
    const subscriptionMap = new Map<string, any>();
    
    for (const item of batch) {
      subscriptionMap.set(item.subscription.id, item.value);
    }

    // 通知每个订阅
    for (const [subscriptionId, value] of subscriptionMap) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription && subscription.active) {
        try {
          subscription.listener(value);
        } catch (error) {
          console.error(`Batch subscription listener failed: ${subscriptionId}`, error);
        }
      }
    }

    this.stats.batchNotifications++;
  }

  /**
   * 获取订阅值（基于CC源码）
   */
  private getSubscriptionValue(
    subscription: StateSubscription<T>,
    newState: T,
    oldState: T
  ): any {
    let value: any;
    
    if (subscription.selector) {
      // 使用选择器
      value = subscription.selector(newState);
      
      // 检查值是否变化
      if (subscription.lastSelectedValue !== undefined) {
        if (subscription.equalityFn?.(value, subscription.lastSelectedValue)) {
          // 值没有变化，跳过通知
          return undefined;
        }
      }
      
      subscription.lastSelectedValue = value;
    } else {
      // 不使用选择器，直接传递状态
      value = newState;
    }
    
    return value;
  }

  /**
   * 生成订阅ID（基于CC源码）
   */
  private generateSubscriptionId(): string {
    return `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * 选择器优化器（基于CC源码）
 */
export class SelectorOptimizer<T = any> {
  private cache: Map<string, { value: any; timestamp: number }>;
  private maxCacheSize: number;
  private cacheTtl: number;

  /**
   * 构造函数（基于CC源码）
   */
  constructor(options: { maxCacheSize?: number; cacheTtl?: number } = {}) {
    this.cache = new Map();
    this.maxCacheSize = options.maxCacheSize || 100;
    this.cacheTtl = options.cacheTtl || 60000; // 1分钟
  }

  /**
   * 优化选择器（基于CC源码）
   */
  optimizeSelector(selector: StateSelector<T, any>): StateSelector<T, any> {
    const cacheKey = this.generateCacheKey(selector);
    
    return (state: T) => {
      // 检查缓存
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
        return cached.value;
      }

      // 执行选择器
      const value = selector(state);
      
      // 更新缓存
      this.cache.set(cacheKey, { value, timestamp: Date.now() });
      
      // 清理过期缓存
      this.cleanupCache();
      
      return value;
    };
  }

  /**
   * 清理缓存（基于CC源码）
   */
  private cleanupCache(): void {
    const now = Date.now();
    
    // 清理过期缓存
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.cacheTtl) {
        this.cache.delete(key);
      }
    }

    // 清理超过最大大小的缓存
    if (this.cache.size > this.maxCacheSize) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp); // 按时间排序
      
      const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
      for (const [key] of toRemove) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 生成缓存键（基于CC源码）
   */
  private generateCacheKey(selector: StateSelector<T, any>): string {
    return selector.toString().replace(/\s+/g, '');
  }

  /**
   * 清空缓存（基于CC源码）
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存统计（基于CC源码）
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.cache.size,
      hitRate: 0 // 需要外部统计
    };
  }
}

/**
 * 创建状态订阅管理器（基于CC源码）
 */
export function createStateSubscriptionManager<T>(
  options?: SubscriptionManagerOptions
): StateSubscriptionManager<T> {
  return new StateSubscriptionManager(options);
}

/**
 * 创建选择器优化器（基于CC源码）
 */
export function createSelectorOptimizer<T>(
  options?: { maxCacheSize?: number; cacheTtl?: number }
): SelectorOptimizer<T> {
  return new SelectorOptimizer(options);
}

export default {
  StateSubscriptionManager,
  SelectorOptimizer,
  createStateSubscriptionManager,
  createSelectorOptimizer,
};