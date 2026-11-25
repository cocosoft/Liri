import { useEffect, useCallback } from "react";
import { sseService } from "../services/sseService";
import { sendNotification, ensurePermission } from "../utils/notifications";
import i18n from "../i18n";

const NOTIFICATION_ICON = "🐣";

/**
 * 梦境周期收尾事件（唯一发布方：`UnifiedDreamCycle` 周期收尾广播）
 *
 * 2026-11-25：此前订阅 `"dream"` —— 全仓无该事件的发布方（订阅空转）。
 * 现改为与实际发布方一致：payload `{ cycleId, status, sessionsProcessed,
 * memoriesCreated, insights, xp }`，`status` ∈ completed | partial | failed | skipped。
 */
const DREAM_CYCLE_COMPLETED_EVENT = "dream:cycle:completed";

export function useBuddyNotification(): void {
  const handleDreamCycleCompleted = useCallback(
    (data: Record<string, unknown>) => {
      const status = typeof data.status === "string" ? data.status : "";
      const cycleId = typeof data.cycleId === "string" ? data.cycleId : "";
      const insights = Array.isArray(data.insights) ? data.insights : [];
      const firstInsight = insights.find(
        (item): item is string => typeof item === "string" && item.length > 0,
      );

      // 2026-11-25 第 3 批：skipped = 本轮未真正整合（门槛/节流/锁跳过），
      // 不该发"梦境已完成"的桌面通知（会与伙伴统计"不计完成"不一致）。
      if (status === "skipped") return;

      const title = i18n.t(
        status === "failed" ? "dream.notifyFailed" : "dream.notifyCompleted",
      );
      const body =
        firstInsight ?? i18n.t("dream.notifyTask", { id: cycleId.slice(0, 8) });

      sendNotification(title, body, { icon: NOTIFICATION_ICON });
    },
    [],
  );

  useEffect(() => {
    ensurePermission();

    sseService.on(DREAM_CYCLE_COMPLETED_EVENT, handleDreamCycleCompleted);

    return () => {
      sseService.off(DREAM_CYCLE_COMPLETED_EVENT, handleDreamCycleCompleted);
    };
  }, [handleDreamCycleCompleted]);
}
