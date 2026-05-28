import { useEffect, useCallback, useRef } from 'react';
import { sseService } from '../services/sseService';

const NOTIFICATION_ICON = '🐣';

const DREAM_MESSAGES: Record<string, string> = {
  'dream:started': '🌙 梦境整合开始',
  'dream:completed': '✨ 梦境整合完成',
  'dream:failed': '💤 梦境整合失败',
};

function requestPermission(): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotification(title: string, body: string): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(title, {
      body,
      icon: NOTIFICATION_ICON,
      silent: false,
    });
  } catch {
    // Notification API 调用失败，静默忽略
  }
}

export function useBuddyNotification(): void {
  const hasPermission = useRef(false);

  const handleDreamEvent = useCallback((data: Record<string, unknown>) => {
    const eventType = data.type as string;
    const summary = data.summary as string;
    const taskId = data.taskId as string;

    if (!eventType || !taskId) return;

    const title = DREAM_MESSAGES[eventType] || '🧠 Buddy 事件';
    const body = summary || `任务 ${taskId.slice(0, 8)}...`;

    sendNotification(title, body);
  }, []);

  useEffect(() => {
    requestPermission();
    hasPermission.current = Notification.permission === 'granted';

    sseService.on('dream', handleDreamEvent);

    return () => {
      sseService.off('dream', handleDreamEvent);
    };
  }, [handleDreamEvent]);
}
