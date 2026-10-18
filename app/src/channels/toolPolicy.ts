/**
 * G-2（2026-10-18）：**通道级工具面最小权限（PoLP）** —— 通道来源 → 默认任务面。
 *
 * ## 为什么不是写 `session.metadata.toolProfile`
 * `toolProfile` 的语义是**追加类别**（`tools/toolProfile.ts` 的 `resolveToolProfileCategories`），
 * 写入它只会**扩大**可见工具面，**不能收窄** ⇒ 用它表达「远程通道只给最小工具面」是无效的。
 * 因此本实现复用**同一条过滤链** `filterToolsByTask`：把通道来源映射为请求级默认 `taskType`
 * （`messaging`），由 `TASK_TOOL_CATEGORIES.messaging` 定义白名单 —— 不新建第二套过滤器（CS01）。
 *
 * ## 边界
 * - 仅**注入缺省值**：调用方显式传 `metadata.taskType` 时不被覆盖（`messageRouter` 不传）。
 * - 本地 REPL / 客户端会话**没有通道来源** ⇒ 返回 `undefined` ⇒ 逐字保持现状。
 * - 开关 `CHANNEL_TOOL_POLICY` 默认关 ⇒ 返回 `undefined` ⇒ 零行为变更。
 * - 可见性 ≠ 授权：即便工具可见，命令执行 / 文件写入仍走审批与 PathGuard。
 */
import { feature } from '@modules/core';
import { CHANNEL_CATALOG } from './ChannelCatalog';

/** 远程通道使用的任务面（`TASK_TOOL_CATEGORIES` 的键） */
export const CHANNEL_MESSAGING_TASK_TYPE = 'messaging';

/**
 * 通道的默认工具面：目录内的已知通道 ⇒ `messaging`；未知 / 无来源 ⇒ `full`（现状）。
 *
 * 判据是**目录成员**（`CHANNEL_CATALOG`，B-1 的 SSOT）—— 新增通道自动获得最小权限，
 * 不另写一份通道清单（CS01）。大小写不敏感（`message.channelId` 与目录 `type` 同域）。
 */
export function resolveChannelToolPolicy(
  channelKey: string | undefined
): 'full' | 'messaging' {
  if (!channelKey) return 'full';
  const key = channelKey.toLowerCase();
  const known = CHANNEL_CATALOG.some(
    (entry) => entry.type.toLowerCase() === key
  );
  return known ? 'messaging' : 'full';
}

/**
 * 本次入站请求应注入的 `taskType`（缺省值）。
 *
 * @param channelKey 通道标识（`message.channelId ?? channelName`）
 * @param enabled    开关（默认取 `CHANNEL_TOOL_POLICY`；测试可注入）
 */
export function resolveChannelTaskTypeOverride(
  channelKey: string | undefined,
  enabled: boolean = feature('CHANNEL_TOOL_POLICY')
): string | undefined {
  if (!enabled) return undefined;
  return resolveChannelToolPolicy(channelKey) === 'messaging'
    ? CHANNEL_MESSAGING_TASK_TYPE
    : undefined;
}
