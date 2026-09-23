/**
 * useNotificationSSE — 通知中心 SSE 订阅 Hook
 *
 * **TB-5 修复（2026-09-23）**：不再自建 `EventSource`，改为订阅 **`sseService` 的单一事件源**。
 * 原实现 `new EventSource(`${getBackendBaseUrl()}/v1/events`)` 与 `sseService` 的 fetch 流**撞同一端点**
 * ⇒ 每个页面**两条常驻 SSE**（dev 与 prod 构建产物实测均为 2），且 `EventSource` **无法携带自定义
 * header** ⇒ 配置 `LIRI_API_SECRET` 时该连接会被判 401（`sseService.ts:82-85` 注释称 `/v1/events`
 * 白名单已随"改用 fetch 携带鉴权头"移除）。
 * 现统一走 `sseService`：连接/重连退避/心跳由它负责；本 Hook 只注册事件回调。
 *
 * - P0-5: 断线重连后增量补拉列表（游标）—— 改由 `sseService` 的 `connection:open` 事件驱动；
 * - P1-1: 监听 inbox:new/inbox:update，若属于当前打开的会话则刷新该会话消息（决策卡片实时出现）；
 * - 阶段A-遗留2: 监听 session:continued，系统续跑（yield 恢复 / SelfWake 唤醒）完成后刷新当前会话消息。
 */

import { useEffect } from "react";
import { useNotificationStore } from "../stores/notificationStore";
import { useRootStore } from "../stores/root-store";
import { sessionService } from "../services/sessionService";
import { chatCoordinator } from "../stores/chat/chatCoordinator";
import { sseService } from "../services/sseService";
import { useSleepNoticeStore } from "../stores/sleepNoticeStore";
import { useEstopStore } from "../stores/estopStore";

/** P1-1: inbox 事件若属于当前打开的会话，则刷新该会话消息（追加/更新 InboxBlock） */
function refreshSessionIfActive(sessionId?: string): void {
  if (!sessionId) return;
  const current = useRootStore.getState().currentSessionId;
  if (sessionId !== current) return;
  sessionService
    .getMessages(sessionId)
    .then((messages) => {
      chatCoordinator.loadMessages(messages);
    })
    .catch(() => {
      /* 会话消息刷新失败静默，用户可在下次打开会话时看到 */
    });
}

export function useNotificationSSE() {
  const handleSseNew = useNotificationStore((s) => s.handleSseNew);
  const handleSseUpdate = useNotificationStore((s) => s.handleSseUpdate);
  const handleSseDelete = useNotificationStore((s) => s.handleSseDelete);
  const handleSseCount = useNotificationStore((s) => s.handleSseCount);
  const loadCounts = useNotificationStore((s) => s.loadCounts);
  const syncLatest = useNotificationStore((s) => s.syncLatest);

  useEffect(() => {
    // 各事件处理器：入参即 sseService 解析后的对象（无需再 JSON.parse）
    const onNew = (data: unknown): void =>
      handleSseNew(data as Parameters<typeof handleSseNew>[0]);
    const onUpdate = (data: unknown): void =>
      handleSseUpdate(data as Parameters<typeof handleSseUpdate>[0]);
    const onDelete = (data: unknown): void =>
      handleSseDelete(data as Parameters<typeof handleSseDelete>[0]);
    const onCount = (data: unknown): void =>
      handleSseCount(data as Parameters<typeof handleSseCount>[0]);
    // 过期 ⇒ 复用 update 通道标记为 expired（沿用原实现语义）
    const onExpired = (data: unknown): void =>
      handleSseUpdate({
        ...(data as Record<string, unknown>),
        status: "expired",
        updated_at: Date.now() / 1000,
      } as Parameters<typeof handleSseUpdate>[0]);
    const onBulkUpdated = (): void => {
      void loadCounts();
    };

    // P1-1: Inbox 决策事件 → 若属当前会话则实时刷新（决策卡片流式出现）
    const onInboxNew = (data: unknown): void =>
      refreshSessionIfActive((data as { sessionId?: string }).sessionId);
    const onInboxUpdate = (data: unknown): void =>
      refreshSessionIfActive((data as { sessionId?: string }).sessionId);

    // 阶段 A（遗留项 2）：系统续跑完成后端广播 → 命中当前打开会话则重拉消息
    const onSessionContinued = (data: unknown): void =>
      refreshSessionIfActive((data as { id?: string }).id);

    // 休眠检测：后端推送后弹出"是否继续执行积压任务"提示
    const onSleepDetected = (data: unknown): void => {
      const d = data as {
        detectedAt?: unknown;
        lagMs?: unknown;
        pendingCount?: unknown;
      };
      useSleepNoticeStore.getState().setNotice({
        detectedAt:
          typeof d.detectedAt === "number" ? d.detectedAt : Date.now(),
        lagMs: typeof d.lagMs === "number" ? d.lagMs : 0,
        pendingCount: typeof d.pendingCount === "number" ? d.pendingCount : 0,
      });
    };

    // P3-4：全局暂停（ESTOP）状态变更 → 聊天区横幅即时同步
    const onEstopChanged = (data: unknown): void => {
      const d = data as {
        engaged?: boolean;
        state?: { reason?: string; engagedAt?: string } | null;
      };
      useEstopStore.getState().setStatus(d.engaged === true, d.state ?? null);
    };

    // P0-5：连接建立/重建后增量补拉列表 + 刷新计数（原先依赖 `EventSource.onopen`）
    const onConnectionOpen = (): void => {
      void syncLatest();
      loadCounts();
    };

    sseService.on("notification:new", onNew);
    sseService.on("notification:update", onUpdate);
    sseService.on("notification:delete", onDelete);
    sseService.on("notification:count", onCount);
    sseService.on("notification:expired", onExpired);
    sseService.on("notification:bulk-updated", onBulkUpdated);
    sseService.on("inbox:new", onInboxNew);
    sseService.on("inbox:update", onInboxUpdate);
    sseService.on("session:continued", onSessionContinued);
    sseService.on("system:sleep_detected", onSleepDetected);
    sseService.on("system:estop_changed", onEstopChanged);
    sseService.on("connection:open", onConnectionOpen);

    return () => {
      sseService.off("notification:new", onNew);
      sseService.off("notification:update", onUpdate);
      sseService.off("notification:delete", onDelete);
      sseService.off("notification:count", onCount);
      sseService.off("notification:expired", onExpired);
      sseService.off("notification:bulk-updated", onBulkUpdated);
      sseService.off("inbox:new", onInboxNew);
      sseService.off("inbox:update", onInboxUpdate);
      sseService.off("session:continued", onSessionContinued);
      sseService.off("system:sleep_detected", onSleepDetected);
      sseService.off("system:estop_changed", onEstopChanged);
      sseService.off("connection:open", onConnectionOpen);
    };
  }, [
    handleSseNew,
    handleSseUpdate,
    handleSseDelete,
    handleSseCount,
    loadCounts,
    syncLatest,
  ]);
}
