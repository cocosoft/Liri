import { useEffect, useCallback, useRef } from "react";
import { sseService } from "../services/sseService";
import { sendNotification, ensurePermission } from "../utils/notifications";

const NOTIFICATION_ICON = "🐣";

const DREAM_MESSAGES: Record<string, string> = {
  "dream:started": "🌙 梦境整合开始",
  "dream:completed": "✨ 梦境整合完成",
  "dream:failed": "💤 梦境整合失败",
};

export function useBuddyNotification(): void {
  const hasPermission = useRef(false);

  const handleDreamEvent = useCallback((data: Record<string, unknown>) => {
    const eventType = data.type as string;
    const summary = data.summary as string;
    const taskId = data.taskId as string;

    if (!eventType || !taskId) return;

    const title = DREAM_MESSAGES[eventType] || "🧠 Buddy 事件";
    const body = summary || `任务 ${taskId.slice(0, 8)}...`;

    sendNotification(title, body, { icon: NOTIFICATION_ICON });
  }, []);

  useEffect(() => {
    ensurePermission();
    hasPermission.current = Notification.permission === "granted";

    sseService.on("dream", handleDreamEvent);

    return () => {
      sseService.off("dream", handleDreamEvent);
    };
  }, [handleDreamEvent]);
}
