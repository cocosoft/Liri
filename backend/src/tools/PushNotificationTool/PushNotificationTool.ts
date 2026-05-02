/**
 * 推送通知工具（条件编译：KAIROS/PROACTIVE）
 */
import { FEATURE_FLAGS } from '../../core/featureFlags';
const feature = (name: keyof typeof FEATURE_FLAGS) => FEATURE_FLAGS[name] ?? false;

export interface PushNotification {
  id: string;
  title: string;
  body: string;
  url?: string;
  createdAt: number;
  read: boolean;
}

const notifications: PushNotification[] = [];

export function isPushNotificationEnabled(): boolean {
  return feature('KAIROS') || feature('PROACTIVE');
}

export function sendNotification(title: string, body: string, url?: string): PushNotification | null {
  if (!isPushNotificationEnabled()) return null;

  const notif: PushNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    title,
    body,
    url,
    createdAt: Date.now(),
    read: false,
  };

  notifications.push(notif);
  return notif;
}

export function getNotifications(): PushNotification[] {
  return [...notifications].sort((a, b) => b.createdAt - a.createdAt);
}

export function getUnreadCount(): number {
  return notifications.filter(n => !n.read).length;
}

export function markAsRead(id: string): boolean {
  const n = notifications.find(x => x.id === id);
  if (!n) return false;
  n.read = true;
  return true;
}

export function markAllAsRead(): void {
  notifications.forEach(n => (n.read = true));
}

export function clearNotifications(): void {
  notifications.length = 0;
}
