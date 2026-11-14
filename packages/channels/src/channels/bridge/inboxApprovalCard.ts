// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Inbox 审批 → 通道「就地审批」卡片（出站）—— G6 手机端审批联动（2026-11-14）
//
// 与 `budgetReliefCard` 同构：`channelBootstrapper` 取插件 outbound ⇒ `sendInteractive`
// ⇒ 失败降级 `sendMarkdown` / `sendText`，全程不阻塞主流程（审批项本身已落库）。
//
// 与 `inboxChannelReply`（审批**结果**回传）的区别：本模块发的是**待审批请求**；
// 按钮点击回到服务端后由 `resolveInboxApproval`（审批的**唯一解析实现**）落定
// ⇒ 不新增审批真源（方案 §2 波段一 G6 前置门禁）。
//
// 为什么只给白名单内的通道发按钮：出站能发 ≠ 入站动作已接线。未接线的通道点了没反应
// （比没有按钮更糟，见 `budgetReliefCard.BUTTON_CAPABLE_CHANNELS` 的同款教训），
// 故 `APPROVAL_CARD_CHANNELS` 只收录**入站动作已接线**的通道。

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import type { InteractiveCard } from '../types/IChannel';
import { channelBootstrapper } from '../bootstrap/ChannelBootstrapper';
import { isReplyEnabled } from '../replyEnabled';
import { isSendDelivered } from './inboxChannelReply';

const logger = getLogger('channels:inboxApprovalCard');

/** 按钮动作标识（出站写、入站读共用的**单一真源**） */
export const INBOX_APPROVAL_ACTION = 'inbox-approval';

/**
 * 按钮动作载荷（**自描述**，点击后原样回到服务端）。
 *
 * `d` 的取值域与 `resolveInboxApproval` 的 `reply` 对齐：`approve` / `deny`。
 */
export interface InboxApprovalActionPayload {
  /** 动作标识（固定值，用于拒绝非本动作的按钮数据） */
  a: typeof INBOX_APPROVAL_ACTION;
  /** Inbox 项 id */
  i: string;
  /** 决策 */
  d: 'approve' | 'deny';
}

/** 序列化按钮载荷（**单一真源**：出站写、入站读都走此处） */
export function serializeInboxApprovalAction(
  payload: InboxApprovalActionPayload
): string {
  return JSON.stringify(payload);
}

/**
 * 解析按钮原始数据（**纯函数**，不猜）：必须是本动作的自描述载荷、字段齐全且值域合法，
 * 否则返回 `null`（守 CS02：不做任何文案匹配）。
 */
export function parseInboxApprovalActionData(
  raw: unknown
): InboxApprovalActionPayload | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const o = parsed as Record<string, unknown>;
  if (o['a'] !== INBOX_APPROVAL_ACTION) return null;
  const itemId = typeof o['i'] === 'string' ? o['i'].trim() : '';
  const decision = o['d'];
  if (!itemId) return null;
  if (decision !== 'approve' && decision !== 'deny') return null;
  return { a: INBOX_APPROVAL_ACTION, i: itemId, d: decision };
}

/** 卡片所需的最小事实（避免 `channels` 反向依赖 service 的 `InboxItem` 类型） */
export interface InboxApprovalCardItem {
  id: string;
  title: string;
  message?: string;
  /** 来源渠道（缺失 ⇒ 不推送：没有回投目标就不臆造） */
  channelId?: string;
  channelSessionId?: string;
  channelConversationId?: string;
}

/**
 * 入站按钮动作**已接线**的通道白名单。
 *
 * 当前仅 `mobile`：`POST /v1/channels/mobile/messages` 的 `action` 分支
 * （`mobile/MobileApprovalAction.ts`）是唯一接线点。新增通道时必须**同时**
 * 接完出站与入站，再把通道 id 加进来。
 */
export const APPROVAL_CARD_CHANNELS: ReadonlySet<string> = new Set(['mobile']);

/** 已发卡项（进程内去重：同一待审批项不重复刷卡；重启即清） */
const sentItems = new Set<string>();

/** 仅供测试：清空去重标记 */
export function resetInboxApprovalCardForTest(): void {
  sentItems.clear();
}

/**
 * 构造「待审批」卡片（**纯函数**，便于单测）。
 *
 * 两个按钮：同意（`approve`）/ 拒绝（`deny`）—— 与移动端首版能力对齐；
 * 白名单档（`allowlist_*`）不在通道内提供（易被误读成"永久放行"，留给桌面端卡片）。
 */
export function buildInboxApprovalCard(item: {
  id: string;
  title: string;
  message?: string;
}): InteractiveCard {
  const content = item.message?.trim() || item.title;
  return {
    title: `审批请求：${item.title}`,
    content,
    color: 'yellow',
    buttons: [
      {
        text: '同意',
        value: serializeInboxApprovalAction({
          a: INBOX_APPROVAL_ACTION,
          i: item.id,
          d: 'approve',
        }),
        style: 'primary',
      },
      {
        text: '拒绝',
        value: serializeInboxApprovalAction({
          a: INBOX_APPROVAL_ACTION,
          i: item.id,
          d: 'deny',
        }),
        style: 'danger',
      },
    ],
  };
}

/** 出站适配器的最小面（与 `inboxChannelReply` 降级链同序） */
export interface InboxApprovalOutbound {
  sendInteractive?: (t: string, c: InteractiveCard) => Promise<unknown>;
  sendMarkdown?: (t: string, c: string) => Promise<unknown>;
  sendText?: (t: string, c: string) => Promise<unknown>;
}

/**
 * 推送「待审批」卡片（失败只告警，**不阻塞** Inbox 主流程；同一 `item.id` ⇒ no-op）。
 *
 * @returns 是否真的投递成功（供测试与日志断言）
 */
export async function sendInboxApprovalCard(args: {
  item: InboxApprovalCardItem;
  /**
   * 仅**测试注入**：出站解析器（缺省 = `channelBootstrapper` 取插件实例 ——
   * 与 `inboxChannelReply` / `budgetReliefCard` 同源）。生产不传。
   */
  resolveOutbound?: (channelName: string) => InboxApprovalOutbound | undefined;
}): Promise<boolean> {
  if (!isReplyEnabled()) return false;

  const { item } = args;
  const channelName = item.channelId;
  if (!channelName || !APPROVAL_CARD_CHANNELS.has(channelName)) return false;
  if (sentItems.has(item.id)) return false;

  const target = item.channelConversationId ?? item.channelSessionId;
  if (!target) {
    logger.warn('sendInboxApprovalCard: 缺少会话/对话标识，跳过卡片', {
      channelName,
      inboxItemId: item.id,
    });
    return false;
  }

  let outbound: InboxApprovalOutbound | undefined;
  if (args.resolveOutbound) {
    outbound = args.resolveOutbound(channelName);
  } else {
    outbound = (
      channelBootstrapper.getPluginInstance(channelName) as unknown as
        | { outbound?: InboxApprovalOutbound }
        | undefined
    )?.outbound;
  }
  if (!outbound) {
    logger.warn('sendInboxApprovalCard: 通道未启用或无出站适配器，跳过卡片', {
      channelName,
      inboxItemId: item.id,
    });
    return false;
  }

  sentItems.add(item.id);

  // 降级文案 = **无按钮**版（如实告知可文本回复；不谎称可点）
  const plain = `**审批请求：${item.title}**\n${item.message?.trim() ?? ''}\n若按钮不可用，可回复「同意」或「拒绝」`;

  try {
    if (typeof outbound.sendInteractive === 'function') {
      const res = await outbound.sendInteractive(
        target,
        buildInboxApprovalCard(item)
      );
      if (isSendDelivered(res)) return true;
      // 插件返回 `{success:false}` 不抛错（插件惯例）⇒ 继续降级
    }
    if (typeof outbound.sendMarkdown === 'function') {
      await outbound.sendMarkdown(target, plain);
      return true;
    }
    if (typeof outbound.sendText === 'function') {
      await outbound.sendText(target, plain);
      return true;
    }
    logger.warn('sendInboxApprovalCard: 通道无可用的出站适配器', {
      channelName,
      inboxItemId: item.id,
    });
    sentItems.delete(item.id);
    return false;
  } catch (err) {
    // 带按钮发送失败（平台拒绝卡片等）⇒ 降级为无按钮文案，并允许下次重试
    sentItems.delete(item.id);
    await handleError(err, {
      module: 'channels:inboxApprovalCard',
      action: 'sendInboxApprovalCard:卡片发送失败',
      context: { channelName, inboxItemId: item.id },
    });
    try {
      if (typeof outbound.sendMarkdown === 'function') {
        await outbound.sendMarkdown(target, plain);
        return true;
      }
      if (typeof outbound.sendText === 'function') {
        await outbound.sendText(target, plain);
        return true;
      }
    } catch (fallbackErr) {
      await handleError(fallbackErr, {
        module: 'channels:inboxApprovalCard',
        action: 'sendInboxApprovalCard:降级发送失败',
        context: { channelName, inboxItemId: item.id },
      });
    }
    return false;
  }
}
