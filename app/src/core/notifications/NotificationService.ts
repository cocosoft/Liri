//
/**
 * 通知系统
 * 提供通知的创建、管理、显示和持久化功能
 */

import { appStateStore } from '@modules/state/AppStateStore.js';
import type { AppState, AppStateStore } from '@modules/state/AppState.js';
import type { Notification, NotificationType } from '@modules/state/types.js';

/**
 * 带通知字段的状态类型
 */
interface AppStateWithNotifications extends AppState {
  notifications: Notification[];
  notificationCount: number;
}

/**
 * 支持通知操作的 store 接口
 */
interface NotificationStore extends AppStateStore {
  addNotification(notification: Omit<Notification, 'id' | 'timestamp'>): string;
  removeNotification(id: string): void;
  clearNotifications(): void;
  getState(): AppStateWithNotifications;
}

/**
 * 通知选项接口
 */
export interface NotificationOptions {
  type?: NotificationType;
  title: string;
  message: string;
  priority?: 'low' | 'medium' | 'high';
  duration?: number;
  persistent?: boolean;
  /** 通知去重键：相同 key 的通知会覆盖旧通知 */
  key?: string;
  /** 合并函数：当 key 存在时，使用此函数合并新旧通知 */
  fold?: (
    existing: Notification,
    incoming: NotificationOptions
  ) => Partial<NotificationOptions>;
  action?: {
    label: string;
    handler: () => void;
  };
}

/**
 * 通知服务类
 */
export class NotificationService {
  private static instance: NotificationService;
  private store = appStateStore as unknown as NotificationStore;
  private actionHandlers: Map<string, () => void> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  /** 通知去重键 → 通知 ID 映射 */
  private notificationKeys: Map<string, string> = new Map();

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * 显示通知
   * @param options 通知选项
   * @returns 通知ID
   */
  show(options: NotificationOptions): string {
    // 处理 folding：如果 key 已存在，使用 fold 函数合并或直接覆盖
    if (options.key) {
      const existingId = this.notificationKeys.get(options.key);
      if (existingId) {
        this.removeTimer(existingId);

        if (options.fold) {
          // 查找已有通知并调用 fold 合并
          const existing = this.getAll().find((n) => n.id === existingId);
          if (existing) {
            const merged = options.fold(existing, options);
            this.store.removeNotification(existingId);
            this.notificationKeys.delete(options.key);
            this.actionHandlers.delete(existingId);

            // 使用合并后的选项创建新通知
            return this.show({ ...options, ...merged });
          }
        }

        // 无 fold 或未找到已有通知，直接移除旧的
        this.store.removeNotification(existingId);
        this.notificationKeys.delete(options.key);
        this.actionHandlers.delete(existingId);
      }
    }

    const notification: Omit<Notification, 'id' | 'timestamp'> = {
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      priority: options.priority || 'medium',
      read: false,
    };

    this.store.addNotification(notification);

    const state = this.store.getState();
    const notifications: Notification[] = state.notifications || [];
    const latestNotification = notifications[notifications.length - 1];
    const notificationId = latestNotification.id;

    // 记录 key 映射
    if (options.key) {
      this.notificationKeys.set(options.key, notificationId);
    }

    if (!options.persistent && options.duration !== 0) {
      this.scheduleAutoDismiss(notificationId, options.duration);
    }

    if (options.action) {
      this.actionHandlers.set(notificationId, options.action.handler);
    }

    return notificationId;
  }

  /**
   * 显示信息通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  info(
    title: string,
    message: string,
    options?: Partial<NotificationOptions>
  ): string {
    return this.show({ type: 'info', title, message, ...options });
  }

  /**
   * 显示成功通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  success(
    title: string,
    message: string,
    options?: Partial<NotificationOptions>
  ): string {
    return this.show({ type: 'success', title, message, ...options });
  }

  /**
   * 显示警告通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  warn(
    title: string,
    message: string,
    options?: Partial<NotificationOptions>
  ): string {
    return this.show({
      type: 'warning',
      title,
      message,
      priority: 'high',
      ...options,
    });
  }

  /**
   * 显示错误通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  error(
    title: string,
    message: string,
    options?: Partial<NotificationOptions>
  ): string {
    return this.show({
      type: 'error',
      title,
      message,
      priority: 'high',
      ...options,
    });
  }

  /**
   * 移除通知
   * @param id 通知ID
   */
  dismiss(id: string): void {
    this.removeTimer(id);

    this.actionHandlers.delete(id);

    // 清理 key 映射
    for (const [key, nid] of this.notificationKeys) {
      if (nid === id) {
        this.notificationKeys.delete(key);
        break;
      }
    }

    this.store.removeNotification(id);
  }

  /**
   * 清空所有通知
   */
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.actionHandlers.clear();
    this.notificationKeys.clear();
    this.store.clearNotifications();
  }

  /**
   * 获取所有通知
   * @returns 通知数组
   */
  getAll(): Notification[] {
    return this.store.getState().notifications;
  }

  /**
   * 获取未读通知数量
   * @returns 未读通知数量
   */
  getUnreadCount(): number {
    const state = this.store.getState();
    return state.notificationCount;
  }

  /**
   * 执行通知操作
   * @param id 通知ID
   */
  executeAction(id: string): void {
    const handler = this.actionHandlers.get(id);
    if (handler) {
      handler();
      this.dismiss(id);
    }
  }

  /**
   * 安排自动关闭
   * @param id 通知ID
   * @param duration 持续时间（毫秒）
   */
  private scheduleAutoDismiss(id: string, duration?: number): void {
    const timeout = duration || 5000;
    const timer = setTimeout(() => {
      this.dismiss(id);
    }, timeout);
    this.timers.set(id, timer);
  }

  /**
   * 移除通知的定时器
   * @param id 通知ID
   */
  private removeTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }
}

/**
 * 创建通知服务实例
 */
export function createNotificationService(): NotificationService {
  return NotificationService.getInstance();
}

/**
 * 导出单例
 */
export const notificationService = NotificationService.getInstance();
