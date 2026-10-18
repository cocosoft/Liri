/**
 * 渠道 ↔ Inbox 桥接开关（叶子模块）
 *
 * 2026-10-19（CI 循环依赖断环）：该开关原定义在 `channels/setupChannels.ts`，
 * 而 `routing/textApproval.ts`（以及 `routing/messageRouter.ts`）反向 import 它，
 * 与 `setupChannels → messageRouter` 构成静态环。开关只读 `configManager`，
 * 下沉为叶子模块后环消失；语义/默认值逐字不变。
 */
import { configManager } from '@modules/config';

/** 渠道 ↔ Inbox 桥接总开关（默认开启，显式设为 'false' 时关闭） */
export function isBridgeEnabled(): boolean {
  return configManager.env('INBOX_CHANNEL_BRIDGE_ENABLED') !== 'false';
}
