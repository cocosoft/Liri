/**
 * 伙伴通知功能
 * 提供Buddy通知的管理和分发
 */

import type { Companion } from './types';
import { ifNotificationsEnabled } from './conditional';

/**
 * 通知类型
 */
export type NotificationType =
  | 'hatched'
  | 'level_up'
  | 'interaction'
  | 'achievement'
  | 'warning'
  | 'info'
  | 'celebration'
  | 'daily_checkin';

/**
 * 通知优先级
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * 通知内容
 */
export interface BuddyNotification {
  id: string;
  type: NotificationType;
  companion?: Companion;
  title: string;
  message: string;
  priority: NotificationPriority;
  timestamp: number;
  read: boolean;
  icon?: string;
  action?: () => void;
}

/**
 * 通知配置
 */
interface NotificationConfig {
  maxNotifications: number;
  autoClearAfterMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: NotificationConfig = {
  maxNotifications: 50,
  autoClearAfterMs: 24 * 60 * 60 * 1000, // 24小时
};

/**
 * 通知管理器
 */
class NotificationManager {
  private notifications: BuddyNotification[] = [];
  private listeners: Set<() => void> = new Set();
  private config: NotificationConfig;
  private autoClearInterval?: ReturnType<typeof setInterval>;

  constructor(config?: Partial<NotificationConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startAutoClear();
  }

  /**
   * 启动自动清理
   */
  private startAutoClear(): void {
    this.autoClearInterval = setInterval(() => {
      this.clearOldNotifications();
    }, 60 * 60 * 1000); // 每小时清理一次
  }

  /**
   * 清理旧通知
   */
  private clearOldNotifications(): void {
    const now = Date.now();
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(
      (n) => now - n.timestamp < this.config.autoClearAfterMs
    );
    if (this.notifications.length !== before) {
      this.notifyListeners();
    }
  }

  /**
   * 添加通知
   */
  addNotification(notification: Omit<BuddyNotification, 'id' | 'timestamp' | 'read'>): string {
    const id = `buddy-notification-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newNotification: BuddyNotification = {
      ...notification,
      id,
      timestamp: Date.now(),
      read: false,
    };

    this.notifications.unshift(newNotification);

    // 限制通知数量
    if (this.notifications.length > this.config.maxNotifications) {
      this.notifications = this.notifications.slice(0, this.config.maxNotifications);
    }

    this.notifyListeners();
    return id;
  }

  /**
   * 标记通知为已读
   */
  markAsRead(id: string): void {
    const notification = this.notifications.find((n) => n.id === id);
    if (notification && !notification.read) {
      notification.read = true;
      this.notifyListeners();
    }
  }

  /**
   * 标记所有通知为已读
   */
  markAllAsRead(): void {
    let changed = false;
    this.notifications.forEach((n) => {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) {
      this.notifyListeners();
    }
  }

  /**
   * 删除通知
   */
  removeNotification(id: string): void {
    const before = this.notifications.length;
    this.notifications = this.notifications.filter((n) => n.id !== id);
    if (this.notifications.length !== before) {
      this.notifyListeners();
    }
  }

  /**
   * 清除所有通知
   */
  clearAll(): void {
    if (this.notifications.length > 0) {
      this.notifications = [];
      this.notifyListeners();
    }
  }

  /**
   * 获取所有通知
   */
  getNotifications(): BuddyNotification[] {
    return [...this.notifications];
  }

  /**
   * 获取未读通知数量
   */
  getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  /**
   * 按优先级获取通知
   */
  getNotificationsByPriority(priority: NotificationPriority): BuddyNotification[] {
    return this.notifications.filter((n) => n.priority === priority);
  }

  /**
   * 添加监听器
   */
  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  /**
   * 移除监听器
   */
  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * 销毁
   */
  destroy(): void {
    if (this.autoClearInterval) {
      clearInterval(this.autoClearInterval);
    }
    this.listeners.clear();
    this.notifications = [];
  }
}

/**
 * 创建通知管理器实例
 */
let notificationManager: NotificationManager | undefined;

export function getNotificationManager(): NotificationManager {
  if (!notificationManager) {
    notificationManager = new NotificationManager();
  }
  return notificationManager;
}

/**
 * 创建孵化通知
 */
export function createHatchedNotification(companion: Companion): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'hatched',
      companion,
      title: '🎉 新伙伴诞生！',
      message: `恭喜你孵化了一只${companion.species}！它的名字是${companion.name}。`,
      priority: 'high',
      icon: '🥚',
    });
  });
}

/**
 * 创建升级通知
 */
export function createLevelUpNotification(
  companion: Companion,
  statName: string,
  oldValue: number,
  newValue: number
): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'level_up',
      companion,
      title: '📈 属性提升！',
      message: `${companion.name}的${statName}属性从${oldValue}提升到${newValue}！`,
      priority: 'normal',
      icon: '⭐',
    });
  });
}

/**
 * 创建互动通知
 */
export function createInteractionNotification(
  companion: Companion,
  action: string,
  result: string
): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'interaction',
      companion,
      title: '💬 互动消息',
      message: `${companion.name}回应你的${action}：${result}`,
      priority: 'normal',
      icon: '💬',
    });
  });
}

/**
 * 创建成就通知
 */
export function createAchievementNotification(
  companion: Companion,
  achievement: string,
  description: string
): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'achievement',
      companion,
      title: '🏆 成就达成！',
      message: `${companion.name}解锁了新成就「${achievement}」：${description}`,
      priority: 'high',
      icon: '🏆',
    });
  });
}

/**
 * 创建每日签到通知
 */
export function createDailyCheckinNotification(companion: Companion): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'daily_checkin',
      companion,
      title: '🌅 每日签到',
      message: `${companion.name}今天也很开心见到你！记得常来看看哦~`,
      priority: 'low',
      icon: '🌅',
    });
  });
}

/**
 * 创建庆祝通知
 */
export function createCelebrationNotification(
  companion: Companion,
  event: string
): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'celebration',
      companion,
      title: '🎊 庆祝！',
      message: `${companion.name}庆祝「${event}」！`,
      priority: 'high',
      icon: '🎊',
    });
  });
}

/**
 * 创建警告通知
 */
export function createWarningNotification(message: string): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'warning',
      title: '⚠️ 警告',
      message,
      priority: 'urgent',
      icon: '⚠️',
    });
  });
}

/**
 * 创建信息通知
 */
export function createInfoNotification(title: string, message: string): string | undefined {
  return ifNotificationsEnabled(() => {
    return getNotificationManager().addNotification({
      type: 'info',
      title,
      message,
      priority: 'low',
    });
  });
}
