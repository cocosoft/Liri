/**
 * 通知系统实现
 * 参考CC源码 cc_code/backend/context/notifications.tsx 实现
 */

/**
 * 通知优先级
 */
export type NotificationPriority = 'low' | 'medium' | 'high' | 'immediate';

/**
 * 基础通知
 */
export interface BaseNotification {
  /** 通知唯一键 */
  key: string;
  /** 此通知会使哪些通知失效 */
  invalidates?: string[];
  /** 优先级 */
  priority: NotificationPriority;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 合并函数 */
  fold?: (accumulator: Notification, incoming: Notification) => Notification;
}

/**
 * 文本通知
 */
export interface TextNotification extends BaseNotification {
  text: string;
  /** 颜色 */
  color?: string;
}

/**
 * 通知类型
 */
export type Notification = TextNotification;

/**
 * 通知状态
 */
export interface NotificationState {
  /** 当前显示的通知 */
  current: Notification | null;
  /** 通知队列 */
  queue: Notification[];
}

/**
 * 通知管理器
 */
export class NotificationManager {
  private state: NotificationState;
  private listeners: Set<(state: NotificationState) => void>;
  private currentTimeoutId: NodeJS.Timeout | null;
  private readonly DEFAULT_TIMEOUT_MS = 8000;

  constructor() {
    this.state = {
      current: null,
      queue: [],
    };
    this.listeners = new Set();
    this.currentTimeoutId = null;
  }

  /**
   * 获取当前状态
   */
  getState(): NotificationState {
    return { ...this.state };
  }

  /**
   * 订阅状态变更
   */
  subscribe(listener: (state: NotificationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知状态变更
   */
  private notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (error) {
        console.error('Error in notification listener:', error);
      }
    }
  }

  /**
   * 获取下一个通知
   */
  private getNext(queue: Notification[]): Notification | null {
    if (queue.length === 0) return null;
    
    // 按优先级排序，优先级高的在前
    const sortedQueue = [...queue].sort((a, b) => {
      const priorityOrder = {
        immediate: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return sortedQueue[0];
  }

  /**
   * 处理队列
   */
  private processQueue() {
    if (this.state.current !== null) return;

    const next = this.getNext(this.state.queue);
    if (!next) return;

    // 从队列中移除
    this.state.queue = this.state.queue.filter(n => n !== next);
    this.state.current = next;
    this.notifyListeners();

    // 设置超时
    this.currentTimeoutId = setTimeout(() => {
      this.currentTimeoutId = null;
      
      // 检查是否还是当前通知
      if (this.state.current?.key === next.key) {
        this.state.current = null;
        
        // 使相关通知失效
        if (next.invalidates) {
          this.state.queue = this.state.queue.filter(
            n => !next.invalidates?.includes(n.key)
          );
        }
        
        this.notifyListeners();
        this.processQueue();
      }
    }, next.timeoutMs ?? this.DEFAULT_TIMEOUT_MS);
  }

  /**
   * 添加通知
   */
  addNotification(notification: Notification): void {
    // 处理立即优先级通知
    if (notification.priority === 'immediate') {
      // 清除现有超时
      if (this.currentTimeoutId) {
        clearTimeout(this.currentTimeoutId);
        this.currentTimeoutId = null;
      }

      // 使相关通知失效
      if (notification.invalidates) {
        this.state.queue = this.state.queue.filter(
          n => !notification.invalidates?.includes(n.key)
        );
      }

      // 设置为当前通知
      this.state.current = notification;
      this.state.queue = this.state.queue.filter(n => n.key !== notification.key);
      this.notifyListeners();

      // 设置超时
      this.currentTimeoutId = setTimeout(() => {
        this.currentTimeoutId = null;
        
        // 检查是否还是当前通知
        if (this.state.current?.key === notification.key) {
          this.state.current = null;
          this.notifyListeners();
          this.processQueue();
        }
      }, notification.timeoutMs ?? this.DEFAULT_TIMEOUT_MS);
    } else {
      // 检查是否已存在相同键的通知
      const existingIndex = this.state.queue.findIndex(
        n => n.key === notification.key
      );

      if (existingIndex >= 0) {
        // 如果存在，使用fold函数合并
        if (notification.fold) {
          this.state.queue[existingIndex] = notification.fold(
            this.state.queue[existingIndex],
            notification
          );
        }
      } else {
        // 否则添加到队列
        this.state.queue.push(notification);
      }

      this.notifyListeners();
      this.processQueue();
    }
  }

  /**
   * 移除通知
   */
  removeNotification(key: string): void {
    // 检查是否是当前通知
    if (this.state.current?.key === key) {
      if (this.currentTimeoutId) {
        clearTimeout(this.currentTimeoutId);
        this.currentTimeoutId = null;
      }
      this.state.current = null;
      this.notifyListeners();
      this.processQueue();
    }

    // 从队列中移除
    const originalLength = this.state.queue.length;
    this.state.queue = this.state.queue.filter(n => n.key !== key);

    if (this.state.queue.length !== originalLength) {
      this.notifyListeners();
    }
  }

  /**
   * 清除所有通知
   */
  clearAll(): void {
    if (this.currentTimeoutId) {
      clearTimeout(this.currentTimeoutId);
      this.currentTimeoutId = null;
    }

    this.state = {
      current: null,
      queue: [],
    };
    this.notifyListeners();
  }

  /**
   * 获取通知数量
   */
  getNotificationCount(): number {
    return (this.state.current ? 1 : 0) + this.state.queue.length;
  }
}

/**
 * 全局通知管理器实例
 */
let globalNotificationManager: NotificationManager | null = null;

/**
 * 获取全局通知管理器
 */
export function getNotificationManager(): NotificationManager {
  if (!globalNotificationManager) {
    globalNotificationManager = new NotificationManager();
  }
  return globalNotificationManager;
}

/**
 * 重置全局通知管理器
 */
export function resetNotificationManager(): NotificationManager {
  globalNotificationManager = new NotificationManager();
  return globalNotificationManager;
}

/**
 * 创建文本通知
 */
export function createTextNotification(
  key: string,
  text: string,
  options?: {
    priority?: NotificationPriority;
    timeoutMs?: number;
    invalidates?: string[];
    color?: string;
  }
): TextNotification {
  return {
    key,
    text,
    priority: options?.priority || 'medium',
    timeoutMs: options?.timeoutMs,
    invalidates: options?.invalidates,
    color: options?.color,
  };
}
