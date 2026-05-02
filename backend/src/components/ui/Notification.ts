/**
 * Notification组件 - 通知
 */

import React, { useState, useEffect } from 'react';
import { Text, Box } from '../ink.js';

type NotificationType = 'info' | 'success' | 'warning' | 'error';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  duration?: number;
}

export interface NotificationProps {
  notifications: NotificationItem[];
  onDismiss?: (id: string) => void;
  placement?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const NOTIFICATION_CONFIG: Record<NotificationType, { icon: string; color: string }> = {
  info: { icon: 'ℹ', color: 'cyan' },
  success: { icon: '✓', color: 'green' },
  warning: { icon: '⚠', color: 'yellow' },
  error: { icon: '✗', color: 'red' },
};

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: NotificationItem;
  onDismiss?: (id: string) => void;
}): React.ReactNode {
  const [visible, setVisible] = useState(true);
  const config = NOTIFICATION_CONFIG[notification.type];

  useEffect(() => {
    const duration = notification.duration || 5000;
    if (duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.(notification.id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [notification.duration, notification.id, onDismiss]);

  if (!visible) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={config.color} bold>{config.icon} </Text>
        <Text color={config.color} bold>{notification.title}</Text>
        {onDismiss && (
          <Text dimColor onMouseDown={() => onDismiss(notification.id)}>
            {' '}[✕]
          </Text>
        )}
      </Box>
      <Box marginLeft={2}>
        <Text>{notification.message}</Text>
      </Box>
    </Box>
  );
}

export function Notification({
  notifications,
  onDismiss,
  placement = 'top-right',
}: NotificationProps): React.ReactNode {
  return (
    <Box flexDirection="column">
      {notifications.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onDismiss={onDismiss}
        />
      ))}
    </Box>
  );
}

let notificationId = 0;
let notificationList: NotificationItem[] = [];
let notificationListeners: Array<(items: NotificationItem[]) => void> = [];

function notifyUpdate() {
  notificationListeners.forEach((fn) => fn([...notificationList]));
}

export function createNotification() {
  const add = (
    type: NotificationType,
    title: string,
    message: string,
    duration = 5000
  ) => {
    const id = `notif_${++notificationId}`;
    notificationList.push({ id, type, title, message, duration });
    notifyUpdate();
    return id;
  };

  const remove = (id: string) => {
    notificationList = notificationList.filter((n) => n.id !== id);
    notifyUpdate();
  };

  const clear = () => {
    notificationList = [];
    notifyUpdate();
  };

  return {
    info: (title: string, message: string, duration?: number) =>
      add('info', title, message, duration),
    success: (title: string, message: string, duration?: number) =>
      add('success', title, message, duration),
    warning: (title: string, message: string, duration?: number) =>
      add('warning', title, message, duration),
    error: (title: string, message: string, duration?: number) =>
      add('error', title, message, duration),
    remove,
    clear,
    getNotifications: () => [...notificationList],
    subscribe: (fn: (items: NotificationItem[]) => void) => {
      notificationListeners.push(fn);
      return () => {
        notificationListeners = notificationListeners.filter((l) => l !== fn);
      };
    },
  };
}

export const notification = createNotification();
