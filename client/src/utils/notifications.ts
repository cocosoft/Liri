/**
 * 桌面通知统一入口（P3-2 收敛）
 *
 * 收敛前 4 处重复实现：
 * - hooks/useBuddyNotification.ts（私有 sendNotification + icon 🐣）
 * - stores/notificationStore.ts maybeShowDesktopNotification（new Notification + tag）
 * - services/SoundService.ts playCompletionSound（Tab 隐藏时 new Notification）
 * - 本文件（原 utils/notifications.ts 通用函数）
 *
 * 统一语义：granted 直接发送；default 仅请求权限（App 挂载时已请求）；denied/不可用静默忽略。
 * 策略（分类过滤/阈值/DND/声音开关）保留在各调用方，本文件只负责"发出去"。
 */

const DEFAULT_NOTIFICATION_ICON = "🐣";

export interface NotificationOptions {
  icon?: string;
  tag?: string;
  silent?: boolean;
}

/** 请求通知权限（幂等；浏览器不支持或拒绝时静默） */
export function ensurePermission(): void {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {
      /* 浏览器拒绝或 API 不可用，静默忽略 */
    });
  }
}

/** 发送桌面通知；权限未授予时不发送；API 调用失败不抛出 */
export function sendNotification(
  title: string,
  body: string,
  opts?: NotificationOptions,
): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") {
    ensurePermission();
    return;
  }
  try {
    new Notification(title, {
      body,
      icon: opts?.icon ?? DEFAULT_NOTIFICATION_ICON,
      tag: opts?.tag,
      silent: opts?.silent ?? false,
    });
  } catch {
    /* Notification API 调用失败，静默忽略 */
  }
}
