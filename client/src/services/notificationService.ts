/**
 * Notification Service — 通知中心 API 层
 *
 * 封装 /v1/notifications/* 端点调用。
 */

import { http } from "./httpClient";
import type {
  NotificationListParams,
  NotificationListResult,
  NotificationCountResult,
  NotificationItem,
} from "../types/notification";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null,
  );
  if (entries.length === 0) return "";
  const qs = new URLSearchParams();
  for (const [k, v] of entries) {
    qs.set(k, String(v));
  }
  return "?" + qs.toString();
}

export const notificationService = {
  /** GET /v1/notifications */
  list: async (
    params: NotificationListParams = {},
  ): Promise<NotificationListResult> => {
    const res = await http.get<NotificationListResult>("/v1/notifications", {
      params: {
        category: params.category,
        status: params.status,
        priority: params.priority,
        cursor: params.cursor,
        limit: params.limit,
      },
    });
    return unwrap(res, "NOTIF_LIST");
  },

  /** GET /v1/notifications/unread-count */
  unreadCount: async (): Promise<NotificationCountResult> => {
    const res = await http.get<NotificationCountResult>(
      "/v1/notifications/unread-count",
    );
    return unwrap(res, "NOTIF_COUNT");
  },

  /** PATCH /v1/notifications/:id/read */
  markRead: async (id: string): Promise<{ success: boolean }> => {
    const res = await http.patch<{ success: boolean }>(
      `/v1/notifications/${id}/read`,
    );
    return unwrap(res, "NOTIF_READ");
  },

  /** PATCH /v1/notifications/read-all */
  readAll: async (category?: string): Promise<{ updatedCount: number }> => {
    const qs = category ? buildQuery({ category }) : "";
    const res = await http.patch<{ updatedCount: number }>(
      `/v1/notifications/read-all${qs}`,
    );
    return unwrap(res, "NOTIF_READ_ALL");
  },

  /** PATCH /v1/notifications/:id/dismiss */
  dismiss: async (id: string): Promise<{ success: boolean }> => {
    const res = await http.patch<{ success: boolean }>(
      `/v1/notifications/${id}/dismiss`,
    );
    return unwrap(res, "NOTIF_DISMISS");
  },

  /** DELETE /v1/notifications/:id */
  delete: async (id: string): Promise<{ success: boolean }> => {
    const res = await http.delete<{ success: boolean }>(
      `/v1/notifications/${id}`,
    );
    return unwrap(res, "NOTIF_DELETE");
  },

  /** POST /v1/notifications — 创建通知 */
  create: async (input: {
    category: string;
    priority?: string;
    title: string;
    content?: string;
    source?: string;
    source_ref?: string;
    link_to?: { type: string; id: string; label?: string } | null;
    expires_at?: number | null;
  }): Promise<NotificationItem> => {
    const res = await http.post<NotificationItem>("/v1/notifications", input);
    return unwrap(res, "NOTIF_CREATE");
  },
};
