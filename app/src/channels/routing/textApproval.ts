// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 纯文本审批前置检查（自 `messageRouter.ts` **内聚抽取**，2026-10-09 C3-S3）。
// 语义逐字不变：命中并处理待办 ⇒ 返回 `RouteResult`；未命中/不适用 ⇒ 返回 `null`（调用方继续主路由）。
// 追踪收尾（`otel.endSpan`）留在调用方，保持原时序。

import { isBridgeEnabled } from '../setupChannels';
import { channelSessionManager } from '../session/ChannelSessionManager';
import { finalizeMessage } from '../dedup/index';
import { recordMessageRejected } from '../monitoring/ChannelMetrics.js';
import { handleError } from '../../error/handleError';
import type { MessageContext } from '../types/IChannel';
import type { RouteResult } from './messageRouterContract';

export interface TextApprovalInput {
  message: MessageContext;
  /** 已创建/复用的渠道会话 id（缺省表示 bridge 未启用/无会话） */
  channelSessionId: string | null;
  onOutbound?: (content: string, target: string) => Promise<void>;
  traceId: string;
  channelName: string;
  /**
   * 去重**作用域键**（`渠道:发送者:messageId`）—— 与 `routeChannelMessage` 同一键，
   * 保证"审批完成"与"消息处理完成"落到**同一条** dedup 记录（R4，2026-10-09）。
   */
  dedupKey: string;
}

/**
 * 纯文本审批前置检查：若会话有 pending Inbox 项且消息命中审批关键词，
 * 则处理审批并返回结果；否则返回 `null`（主路由继续）。
 */
export async function tryHandleTextApproval(
  input: TextApprovalInput
): Promise<RouteResult | null> {
  const { message, channelSessionId, onOutbound, traceId, channelName } = input;
  const dedupKey = input.dedupKey;

  if (!isBridgeEnabled() || !channelSessionId || !message.content) return null;

  try {
    const { detectApprovalIntent, processTextApproval } =
      await import('../bridge/TextApprovalParser.js');
    const intent = detectApprovalIntent(message.content);
    if (!intent) return null;

    const items = await channelSessionManager.getInboxItemIds(channelSessionId);
    if (items.length === 0) return null;

    const { inboxManager } = await import('@modules/runtime/InboxManager.js');
    for (const itemId of items) {
      const item = await inboxManager.get(itemId);
      if (!item || item.status !== 'pending') continue;
      try {
        // ── fail-closed: Inbox 写入失败时拒绝放行 ──
        const processed = await processTextApproval(itemId, intent);
        if (processed && onOutbound) {
          const replyText =
            intent === 'approve'
              ? `已批准「${item.title}」`
              : `已拒绝「${item.title}」`;
          await onOutbound(
            replyText,
            message.conversationId ?? message.senderId
          );
        }
        // DEEP-9：释放 claimMessage 锁，防止 messageId 永久 inflight
        finalizeMessage(dedupKey, true);
        return { valid: true, response: 'text_approval_processed' };
      } catch (inboxErr) {
        await handleError(inboxErr, {
          module: 'channels:routing',
          action: 'textApproval:inboxWrite',
          context: { itemId, intent, traceId },
        });
        if (onOutbound) {
          await onOutbound(
            '系统繁忙，请稍后再试',
            message.conversationId ?? message.senderId
          );
        }
        // DEEP-9：即使失败也要释放锁
        finalizeMessage(dedupKey, true);
        recordMessageRejected('INBOX_UNAVAILABLE');
        return { valid: false, errorCode: 'INBOX_UNAVAILABLE' };
      }
    }
    return null;
  } catch (preCheckErr) {
    // @ignore-catch: 审批预检失败（导入失败等非关键错误）不阻塞主路由
    await handleError(preCheckErr, {
      module: 'channels:routing',
      action: 'textApproval:preCheck',
      context: { channelName, messageId: message.messageId },
    });
    return null;
  }
}
