// @ts-nocheck
/**
 * 通知系统
 * 提供通知的创建、管理、显示和持久化功能
 */

import { appStateStore } from '../state/AppStateStore.js';
import type { Notification, NotificationType } from '../state/types.js';

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
  private store = appStateStore;
  private actionHandlers: Map<string, () => void> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

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
    const notification: Omit<Notification, 'id' | 'timestamp'> = {
      type: options.type || 'info',
      title: options.title,
      message: options.message,
      priority: options.priority || 'medium',
      read: false,
    };

    this.store.addNotification(notification);

    const state = this.store.getState();
    const latestNotification = state.notifications[state.notifications.length - 1];
    const notificationId = latestNotification.id;

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
  info(title: string, message: string, options?: Partial<NotificationOptions>): string {
    return this.show({ type: 'info', title, message, ...options });
  }

  /**
   * 显示成功通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  success(title: string, message: string, options?: Partial<NotificationOptions>): string {
    return this.show({ type: 'success', title, message, ...options });
  }

  /**
   * 显示警告通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  warn(title: string, message: string, options?: Partial<NotificationOptions>): string {
    return this.show({ type: 'warning', title, message, priority: 'high', ...options });
  }

  /**
   * 显示错误通知
   * @param title 标题
   * @param message 消息
   * @param options 其他选项
   * @returns 通知ID
   */
  error(title: string, message: string, options?: Partial<NotificationOptions>): string {
    return this.show({ type: 'error', title, message, priority: 'high', ...options });
  }

  /**
   * 移除通知
   * @param id 通知ID
   */
  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.actionHandlers.delete(id);
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
    return this.store.getState().notificationCount;
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
