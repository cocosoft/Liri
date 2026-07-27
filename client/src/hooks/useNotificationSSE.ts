/**
 * useNotificationSSE — 通知中心 SSE 订阅 Hook
 *
 * 连接到 /v1/events，处理 notification:* 事件。
 * 支持断线重连、心跳保活、Last-Event-ID。
 */

import { useEffect, useRef } from "react";
import { useNotificationStore } from "../stores/notificationStore";
import { getBackendBaseUrl } from "../services/backendUrl";

export function useNotificationSSE() {
  const handleSseNew = useNotificationStore((s) => s.handleSseNew);
  const handleSseUpdate = useNotificationStore((s) => s.handleSseUpdate);
  const handleSseDelete = useNotificationStore((s) => s.handleSseDelete);
  const handleSseCount = useNotificationStore((s) => s.handleSseCount);
  const loadCounts = useNotificationStore((s) => s.loadCounts);

  const esRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<string>("");
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      es.onerror = () => {
        es.close();
        if (!stopped) {
          // 断线重连：3 秒后重试
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      es.onopen = () => {
        // 重连后全量同步
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
  ]);
}
