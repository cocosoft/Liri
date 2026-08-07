/**
 * useNotificationSSE — 通知中心 SSE 订阅 Hook
 *
 * 连接到 /v1/events，处理 notification:* 事件。
 * P0-5: 断线重连后增量补拉列表（游标）+ 指数退避。
 * P1-1: 监听 inbox:new/inbox:update，若属于当前打开的会话则刷新该会话消息（决策卡片实时出现）。
 */

import { useEffect, useRef } from "react";
import { useNotificationStore } from "../stores/notificationStore";
import { useRootStore } from "../stores/root-store";
import { sessionService } from "../services/sessionService";
import { chatCoordinator } from "../stores/chat/chatCoordinator";
import { getBackendBaseUrl } from "../services/backendUrl";

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

  const esRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string>("");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    let stopped = false;

    function connect(): void {
      if (stopped) return;

      const baseUrl = getBackendBaseUrl();
      const url = `${baseUrl}/v1/events`;

      const es = new EventSource(url);

      // Last-Event-ID for reconnection
      if (lastEventIdRef.current) {
        // EventSource handles Last-Event-ID automatically
      }

      es.addEventListener("notification:new", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId;
          handleSseNew(data);
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("notification:update", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId;
          handleSseUpdate(data);
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("notification:delete", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId;
          handleSseDelete(data);
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("notification:count", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId;
          handleSseCount(data);
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("notification:expired", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          lastEventIdRef.current = e.lastEventId;
          handleSseUpdate({
            ...data,
            status: "expired",
            updated_at: Date.now() / 1000,
          });
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("notification:bulk-updated", () => {
        loadCounts();
      });

      // P1-1: Inbox 决策事件 → 若属当前会话则实时刷新（决策卡片流式出现）
      es.addEventListener("inbox:new", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          refreshSessionIfActive(data.sessionId);
        } catch {
          /* ignore parse errors */
        }
      });

      es.addEventListener("inbox:update", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          refreshSessionIfActive(data.sessionId);
        } catch {
          /* ignore parse errors */
        }
      });

      es.onerror = () => {
        es.close();
        if (!stopped) {
          // P0-5: 指数退避重连（3s → 6s → 12s → ... 上限 30s）
          const delay = Math.min(
            3000 * Math.pow(2, reconnectAttemptRef.current),
            30_000,
          );
          reconnectAttemptRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      es.onopen = () => {
        // P0-5: 重连后增量补拉列表 + 刷新计数（不再只刷计数不补列表）
        reconnectAttemptRef.current = 0;
        syncLatest();
        loadCounts();
      };

      esRef.current = es;
    }

    connect();

    return () => {
      stopped = true;
      esRef.current?.close();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
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
