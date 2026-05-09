//
/**
 * 通知组件
 * 用于显示系统通知和提示信息
 */

import React, { useState, useEffect } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface NotificationProps {
  id: string;
  type: NotificationType;
  message: string;
  title?: string;
  duration?: number;
  onClose?: (id: string) => void;
}

export const Notification: React.FC<NotificationProps> = ({
  id,
  type,
  message,
  title,
  duration = 5000,
  onClose,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsLeaving(true);
        setTimeout(() => {
          setIsVisible(false);
          onClose?.(id);
        }, 300);
      }, duration);

      return () => clearTimeout(timer);
    }
    return;
  }, [id, duration, onClose]);

  const handleClose = () => {
    setIsLeaving(true);
    setTimeout(() => {
      setIsVisible(false);
      onClose?.(id);
    }, 300);
  };

  const getStyles = () => {
    const baseStyles = 'notification-container rounded-lg p-4 shadow-lg flex items-start gap-3 max-w-md';
    
    const typeStyles = {
      success: 'bg-green-50 border border-green-200',
      error: 'bg-red-50 border border-red-200',
      warning: 'bg-yellow-50 border border-yellow-200',
      info: 'bg-blue-50 border border-blue-200',
      loading: 'bg-gray-50 border border-gray-200',
    };

    return `${baseStyles} ${typeStyles[type]} ${isVisible ? 'opacity-100' : 'opacity-0'} ${isLeaving ? 'transition-all duration-300 translate-x-full' : 'transition-all duration-300'}`;
  };

  const getIcon = () => {
    const icons = {
      success: '✓',
      error: '✗',
      warning: '⚠',
      info: 'ℹ',
      loading: '⏳',
    };
    return icons[type];
  };

  const getIconColor = () => {
    const colors = {
      success: 'text-green-500',
      error: 'text-red-500',
      warning: 'text-yellow-500',
      info: 'text-blue-500',
      loading: 'text-gray-500',
    };
    return colors[type];
  };

  if (!isVisible) return null;

  return (
    <div className={getStyles()}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${getIconColor()}`}>
        {getIcon()}
      </div>
      
      <div className="flex-1 min-w-0">
        {title && (
          <h4 className="font-semibold text-sm text-gray-800 truncate">
            {title}
          </h4>
        )}
        <p className="text-sm text-gray-600 mt-1">
          {message}
        </p>
      </div>

      <button
        onClick={handleClose}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
      >
        ×
      </button>
    </div>
  );
};

export interface NotificationsProps {
  notifications: NotificationProps[];
  onClose?: (id: string) => void;
}

export const Notifications: React.FC<NotificationsProps> = ({
  notifications,
  onClose,
}) => {
  if (notifications.length === 0) return null;

  return (
    <div className="notifications-wrapper fixed top-4 right-4 z-50 flex flex-col gap-2">
      {notifications.map((notification) => (
        <Notification
          key={notification.id}
          {...notification}
          onClose={onClose}
        />
      ))}
    </div>
  );
};

/**
 * 创建通知组件
 */
export function createNotification(props: NotificationProps): React.ReactElement {
  return <Notification {...props} />;
}

/**
 * 创建通知列表组件
 */
export function createNotifications(props: NotificationsProps): React.ReactElement {
  return <Notifications {...props} />;
}
