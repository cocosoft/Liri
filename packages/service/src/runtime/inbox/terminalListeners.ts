/**
 * Inbox 审批卡「不可回复终态」旁路监听（2026-11-24 从 `InboxManager` 外迁，FSZ-006 拆分步骤 ①）
 *
 * 为什么独立：过期 / 级联关闭只改状态 + 广播时，PDCA 步骤卡对应的任务会永久停在
 * `stage_awaiting_approval`（卡已不可回复）⇒ 会话幂等键被 `findExistingTask` 锁死。
 * 监听器由入口层（`main.ts`）注册，用于把"过期"收口成任务终态。
 *
 * **只搬不改**：注册表与分发逻辑逐字来自 `InboxManager`（`_notifyTerminalListeners`）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { InboxItem } from '../InboxManager.js';

const logger = getLogger('runtime:inbox');

type InboxExpiredListener = (item: InboxItem) => void;
const expiredListeners = new Set<InboxExpiredListener>();

/** 订阅"审批卡已过期"（返回取消订阅函数） */
export function onInboxItemsExpired(fn: InboxExpiredListener): () => void {
  expiredListeners.add(fn);
  return () => expiredListeners.delete(fn);
}

/**
 * 2026-11-24（批次 1 / A5）：审批卡进入**不可回复终态**（过期 / 级联关闭）时的统一收口回调。
 *
 * 抽成单一实现的原因：`dismissBySession` 此前只改状态、不触达监听器 ⇒ 关联 PDCA 不走
 * `abortPdcaAfterExpiry`，任务停在 `stage_awaiting_approval` 占住会话幂等键。
 */
export function notifyInboxTerminal(item: InboxItem): void {
  for (const listener of expiredListeners) {
    try {
      listener(item);
    } catch (err) {
      logger.warn('审批终态回调失败', {
        inboxId: item.id,
        status: item.status,
        error: String(err),
      });
    }
  }
}
