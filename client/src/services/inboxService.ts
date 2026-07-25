import type { InboxItem, InboxItemType, InboxItemStatus } from "../types/inbox";
import { http } from "./httpClient";

function unwrap<T>(
  res: { ok: boolean; data?: T; error?: { code: number; message: string } },
  action: string,
): T {
  if (!res.ok)
    throw new Error(`[${action}] ${res.error?.message ?? "未知错误"}`);
  return res.data as T;
}

export const inboxService = {
  /** 列出 Inbox 项 */
  list: async (params?: {
    sessionId?: string;
    status?: InboxItemStatus;
    type?: InboxItemType;
    limit?: number;
    offset?: number;
  }): Promise<{ items: InboxItem[]; total: number }> => {
    const sp = new URLSearchParams();
    if (params?.sessionId) sp.set("sessionId", params.sessionId);
    if (params?.status) sp.set("status", params.status);
    if (params?.type) sp.set("type", params.type);
    if (params?.limit !== undefined) sp.set("limit", String(params.limit));
    if (params?.offset !== undefined) sp.set("offset", String(params.offset));
    const qs = sp.toString();
    const url = qs ? `/v1/inbox?${qs}` : "/v1/inbox";
    const res = await http.get<{ items: InboxItem[]; total: number }>(url);
    return unwrap(res, "INBOX_LIST");
  },

  /** 获取单个 Inbox 项 */
  get: async (id: string): Promise<InboxItem> => {
    const res = await http.get<InboxItem>(`/v1/inbox/${id}`);
    return unwrap(res, "INBOX_GET");
  },

  /** 获取待处理数量 */
  count: async (sessionId?: string): Promise<number> => {
    const sp = new URLSearchParams();
    if (sessionId) sp.set("sessionId", sessionId);
    const qs = sp.toString();
    const url = qs ? `/v1/inbox/count?${qs}` : "/v1/inbox/count";
    const res = await http.get<{ count: number }>(url);
    return unwrap(res, "INBOX_COUNT").count;
  },

  /** 回复 Inbox 项 */
  reply: async (
    id: string,
    reply: string,
    selectedOption?: string,
  ): Promise<InboxItem> => {
    const res = await http.post<InboxItem>(`/v1/inbox/${id}/reply`, {
      reply,
      selectedOption,
    });
    return unwrap(res, "INBOX_REPLY");
  },
};
