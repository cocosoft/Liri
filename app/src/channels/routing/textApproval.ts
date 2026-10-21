// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 纯文本审批前置检查（自 `messageRouter.ts` **内聚抽取**，2026-10-09 C3-S3）。
// 语义逐字不变：命中并处理待办 ⇒ 返回 `RouteResult`；未命中/不适用 ⇒ 返回 `null`（调用方继续主路由）。
// 追踪收尾（`otel.endSpan`）留在调用方，保持原时序。

import { isBridgeEnabled } from '../bridgeEnabled';
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
 * 文本审批的审计载荷（纯函数输出 ⇒ 可直接单测，不触发文件 IO）
 *
 * 为什么需要它：IM 渠道的"文本审批"是**绕过前端审批卡**的放行路径
 * （用户在飞书/钉钉里回一句"同意"就批准了工具执行），此前**没有任何审计留痕**——
 * 移动端 HTTP 路径有 `recordMobileAudit`，这条路径却是盲区。
 */
export interface TextApprovalAuditPayload {
  type: 'approval_action';
  severity: 'info' | 'warning';
  actor: string;
  action: string;
  resource: string;
  success: boolean;
  failureReason?: string;
  details: Record<string, unknown>;
}

export interface TextApprovalAuditInput {
  channelName: string;
  /** 审批发起人（渠道发送者 id —— 即"谁按下了同意/拒绝"） */
  senderId: string;
  conversationId?: string;
  itemId: string;
  itemTitle?: string;
  intent: 'approve' | 'reject';
  traceId: string;
  success: boolean;
  failureReason?: string;
}

export function buildTextApprovalAuditPayload(
  input: TextApprovalAuditInput
): TextApprovalAuditPayload {
  return {
    type: 'approval_action',
    severity: input.success ? 'info' : 'warning',
    actor: input.senderId,
    action: `channel.approval.${input.intent}`,
    resource: `inbox:${input.itemId}`,
    success: input.success,
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    details: {
      channel: input.channelName,
      conversationId: input.conversationId,
      itemId: input.itemId,
      itemTitle: input.itemTitle,
      intent: input.intent,
      traceId: input.traceId,
    },
  };
}

/**
 * 写审计（best-effort）：失败只告警，不阻断审批结果。
 *
 * 动态 import 企业审计服务：与 `channels/mobile/MobileAudit` 同法 ——
 * 避免把审计服务的初始化（建目录 + 保留期定时器）拉进启动面。
 */
export async function recordTextApprovalAudit(
  input: TextApprovalAuditInput
): Promise<void> {
  const payload = buildTextApprovalAuditPayload(input);
  try {
    const { EnterpriseAuditService, AuditEventType } =
      await import('../../config/enterprise/audit/EnterpriseAuditService');
    await EnterpriseAuditService.getInstance().log(
      AuditEventType.APPROVAL_ACTION,
      payload.severity,
      payload.actor,
      payload.action,
      {
        details: payload.details,
        resource: payload.resource,
        success: payload.success,
        ...(payload.failureReason
          ? { failureReason: payload.failureReason }
          : {}),
      }
    );
  } catch (error) {
    // @ignore-catch: 审计是旁路，写入失败不改变审批结果
    await handleError(error, {
      module: 'channels:routing',
      action: 'textApproval:audit',
      context: { itemId: input.itemId, intent: input.intent },
    });
  }
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
        // 审计留痕（旁路）：文本审批是"绕过前端审批卡"的执行放行路径，必须可追溯
        await recordTextApprovalAudit({
          channelName,
          senderId: message.senderId,
          conversationId: message.conversationId,
          itemId,
          itemTitle: item.title,
          intent,
          traceId,
          success: true,
        });
        // DEEP-9：释放 claimMessage 锁，防止 messageId 永久 inflight
        finalizeMessage(dedupKey, true);
        return { valid: true, response: 'text_approval_processed' };
      } catch (inboxErr) {
        await handleError(inboxErr, {
          module: 'channels:routing',
          action: 'textApproval:inboxWrite',
          context: { itemId, intent, traceId },
        });
        // 失败同样留痕：审批没落库，但"谁在什么时候试图批准/拒绝过"是可审计事实
        await recordTextApprovalAudit({
          channelName,
          senderId: message.senderId,
          conversationId: message.conversationId,
          itemId,
          intent,
          traceId,
          success: false,
          failureReason: String(inboxErr),
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
