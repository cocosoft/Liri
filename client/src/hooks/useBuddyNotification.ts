import { useEffect, useCallback, useRef } from "react";
import { sseService } from "../services/sseService";
import { sendNotification, ensurePermission } from "../utils/notifications";
import i18n from "../i18n";

const NOTIFICATION_ICON = "🐣";

const DREAM_MESSAGE_KEYS: Record<string, string> = {
  "dream:started": "dream.notifyStarted",
  "dream:completed": "dream.notifyCompleted",
  "dream:failed": "dream.notifyFailed",
};

export function useBuddyNotification(): void {
  const hasPermission = useRef(false);

  const handleDreamEvent = useCallback((data: Record<string, unknown>) => {
    const eventType = data.type as string;
    const summary = data.summary as string;
    const taskId = data.taskId as string;

    if (!eventType || !taskId) return;

    const dreamKey = DREAM_MESSAGE_KEYS[eventType];
    const title = dreamKey
      ? i18n.t(dreamKey)
      : i18n.t("dream.notifyBuddyEvent");
    const body =
      summary || i18n.t("dream.notifyTask", { id: taskId.slice(0, 8) });

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
