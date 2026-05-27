import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface Notification {
  key: string;
  jsx: ReactNode;
  priority: 'immediate' | 'normal';
  timeoutMs?: number;
}

interface NotificationsContextType {
  notifications: Notification[];
  addNotification: (notification: Notification) => void;
  removeNotification: (key: string) => void;
}

const NotificationsContext = createContext<
  NotificationsContextType | undefined
>(undefined);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const addNotification = (notification: Notification) => {
    setNotifications((prev) => [...prev, notification]);

    if (notification.timeoutMs) {
      setTimeout(() => {
        removeNotification(notification.key);
      }, notification.timeoutMs);
    }
  };

  const removeNotification = (key: string) => {
    setNotifications((prev) => prev.filter((n) => n.key !== key));
  };

  return (
    <NotificationsContext.Provider
      value={{ notifications, addNotification, removeNotification }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new AppError(
      ErrorCodes.INTERNAL.message,
      ErrorCategory.VALIDATION,
      ErrorSeverity.LOW,
      'CONTEXT_NOT_AVAILABLE',
      { hook: 'useNotifications', provider: 'NotificationsProvider' }
    );
  }
  return context;
}
