/** Inbox 项类型 */
export type InboxItemType = "approval" | "question" | "authorization";

/** Inbox 项状态 */
export type InboxItemStatus = "pending" | "replied" | "expired" | "dismissed";

/** Inbox 项（与后端 InboxItem 对齐） */
export interface InboxItem {
  id: string;
  sessionId: string;
  type: InboxItemType;
  title: string;
  message: string;
  status: InboxItemStatus;
  reply?: string;
  options?: string[];
  offlineCapable: boolean;
  source: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  repliedAt?: number;
}
