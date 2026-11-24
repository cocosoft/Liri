/**
 * Inbox 行 → 领域对象（2026-11-24 从 `InboxManager._mapRow` 逐字外迁，FSZ-006 拆分）
 *
 * 提取为独立函数的原因：过期扫描外迁后仍需同一映射（单一实现，禁止双轨）。
 */

import type {
  InboxItem,
  InboxItemStatus,
  InboxItemType,
} from '../InboxManager.js';

export function mapInboxRow(row: Record<string, unknown>): InboxItem {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    type: row.type as InboxItemType,
    title: row.title as string,
    message: row.message as string,
    status: row.status as InboxItemStatus,
    reply: row.reply as string | undefined,
    options: row.options ? JSON.parse(row.options as string) : undefined,
    offlineCapable: Boolean(row.offline_capable),
    source: row.source as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    repliedAt: row.replied_at as number | undefined,
    channelId: (row.channel_id as string) || undefined,
    channelSessionId: (row.channel_session_id as string) || undefined,
    channelConversationId:
      (row.channel_conversation_id as string) || undefined,
    traceId: (row.trace_id as string) || undefined,
  };
}
