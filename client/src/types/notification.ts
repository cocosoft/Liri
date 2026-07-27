/**
 * Notification 类型定义 — 统一消息中心
 *
 * 与后端 NotificationPersistence.ts 中的类型保持一致。
 */

export type NotificationCategory =
  "approval" | "todo" | "system" | "notice" | "mention";

export type NotificationPriority = "urgent" | "normal" | "low";

export type NotificationStatus =
  "unread" | "read" | "resolved" | "dismissed" | "expired";

export interface NotificationAction {
  label: string;
  action: "approve" | "reject" | "view" | "dismiss";
  style?: "primary" | "danger" | "secondary";
  confirmText?: string;
}

export interface NotificationLink {
  type: "session" | "page" | "url";
  id: string;
  label?: string;
}

export interface NotificationItem {
  id: string;
  user_id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  content: string;
  status: NotificationStatus;
  source: string;
  source_ref: string;
  actions: NotificationAction[];
  link_to: NotificationLink | null;
  created_at: number;
  updated_at: number;
  read_at: number | null;
  resolved_at: number | null;
  expires_at: number | null;
  action_token: string | null;
}

export interface NotificationListParams {
  category?: NotificationCategory;
  status?: NotificationStatus;
  priority?: NotificationPriority;
  cursor?: number;
  limit?: number;
}

export interface NotificationListResult {
  items: NotificationItem[];
  nextCursor: number | null;
  hasMore: boolean;
}

export interface NotificationCountResult {
  total: number;
  approval: number;
  todo: number;
  system: number;
  notice: number;
  mention: number;
}
