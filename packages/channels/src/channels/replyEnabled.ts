/**
 * 渠道 ← Inbox 回复回传开关（叶子模块）
 *
 * 2026-11-04（CI 循环依赖断环）：该开关原定义在 `channels/setupChannels.ts`，
 * 而 `channels/bridge/inboxChannelReply.ts` 反向 import 它，与
 * `setupChannels → runtime/api/CoreAPIImpl` 构成静态环
 * （CoreAPIImpl → domainSnapshotOps → cockpitOps → InboxManager → inboxChannelReply）。
 * 开关只读 `configManager`，下沉为叶子模块后环消失；语义/默认值逐字不变。
 */
import { configManager } from '@openliri/infra/config';

/** 渠道 ← Inbox 回复回传开关（默认开启，显式设为 'false' 时关闭） */
export function isReplyEnabled(): boolean {
  return configManager.env('INBOX_CHANNEL_REPLY_ENABLED') !== 'false';
}
