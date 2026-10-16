// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 预算挂起 → 通道「就地放行」卡片（出站）
//
// Spec：`.trae/specs/channel-budget-inline-relief.md` §D2。与 `inboxChannelReply` **同构**：
// `channelRegistry` 取 outbound ⇒ `sendInteractive` ⇒ 失败降级 `sendMarkdown` ⇒ `sendText`，
// 全程不阻塞主流程、失败只告警（该卡片是**增强**，正文已由 `deliverChannelOutbound` 投递）。
//
// 触发判据是**结构化信号** `finishReason === 'budget_exhausted'`（在 `messageRouter` 分流），
// **不做**任何正文文本匹配（守 CS02）。

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { configManager } from '@modules/config';
import type { InteractiveCard } from '../types/IChannel';
import { channelRegistry } from '../registry/ChannelRegistry';
import { channelBootstrapper } from '../bootstrap/ChannelBootstrapper';
import { buildBudgetSuspendedNotice } from '../routing/messageRouterContract';

const logger = getLogger('channels:budgetReliefCard');

/**
 * 「通道回投」总开关（**与 `setupChannels.isReplyEnabled` 同键同语义**）。
 *
 * ⚠️ 此处**不 import** `setupChannels`：`setupChannels → messageRouter → 本模块` ⇒ 会形成
 * **循环依赖**（本模块已由 `messageRouter` 引入）。故直接读同一 env 键；两处判据须同改。
 */
function isChannelReplyEnabled(): boolean {
  return configManager.env('INBOX_CHANNEL_REPLY_ENABLED') !== 'false';
}

/** 按钮动作载荷（**自描述**，点击后原样回到服务端；`s` = 会话 id ⇒ 唤醒收窄） */
export interface BudgetReliefActionPayload {
  /** 动作标识（固定值，用于拒绝非本动作的按钮数据） */
  a: 'budget-relief';
  /** 放行档位（与 `POST /v1/cost/daily-budget/relief` 的 kind 同值域） */
  k: 'boost' | 'unlock-today';
  /** 会话 id（服务端据此**收窄**唤醒到本会话，见 spec `long-task-suspend-resume` v1.11） */
  s: string;
}

/** 序列化按钮载荷（**单一真源**：出站写、入站读都走此处） */
export function serializeBudgetReliefAction(
  payload: BudgetReliefActionPayload
): string {
  return JSON.stringify(payload);
}

/**
 * 构造「预算挂起」卡片（**纯函数**，便于单测）。
 *
 * 两个按钮：临时提额（`boost`）/ 今日解除（`unlock-today`）—— 与桌面端卡片同口径，
 * 不做 `waive-once`（单次豁免语义在通道内易被误解为"永久放行"）。
 */
export function buildBudgetReliefCard(args: {
  sessionId: string;
  text: string;
}): InteractiveCard {
  return {
    title: '今日预算已用完',
    content: args.text,
    color: 'yellow',
    buttons: [
      {
        text: '临时提额',
        value: serializeBudgetReliefAction({
          a: 'budget-relief',
          k: 'boost',
          s: args.sessionId,
        }),
        style: 'primary',
      },
      {
        text: '今日解除',
        value: serializeBudgetReliefAction({
          a: 'budget-relief',
          k: 'unlock-today',
          s: args.sessionId,
        }),
        style: 'default',
      },
    ],
  };
}

/** 已发卡会话（进程内去重：同一挂起点不重复刷卡；重启即清，见 spec §3-5） */
const sentSessions = new Set<string>();

/**
 * **入站回调已接线**的通道白名单（2026-10-17，Spec `channel-budget-inline-relief.md` §2 D2 风险项）。
 *
 * ⚠️ 为什么必须白名单：实现 `sendInteractive` 的通道有 12 个，但**入站按钮回调**目前**只有 QQ**
 * （`INTERACTION_CREATE`）。对「出站能发、入站没接」的通道给按钮 ⇒ 用户点了**毫无反应**（飞书会
 * 一直 loading）——**比没有按钮更糟**（用户以为按了、其实什么都没发生）。
 *
 * 新增通道时必须**同时**接完出站与入站，再把该通道 id 加进来。
 */
export const BUTTON_CAPABLE_CHANNELS: ReadonlySet<string> = new Set(['qq']);

/** 仅供测试：清空去重标记 */
export function resetBudgetReliefCardForTest(): void {
  sentSessions.clear();
}

/** 出站适配器的最小面（本模块只用这三种发送方式；与 `inboxChannelReply` 降级链同序） */
export interface BudgetReliefOutbound {
  sendInteractive?: (t: string, c: InteractiveCard) => Promise<unknown>;
  sendMarkdown?: (t: string, c: string) => Promise<unknown>;
  sendText?: (t: string, c: string) => Promise<unknown>;
}

/**
 * 发送「就地放行」卡片（失败只告警，**不阻塞**主流程；重复调用同一 `sessionId` ⇒ no-op）。
 *
 * @returns 是否真的投递成功（供测试与日志断言）
 */
export async function sendBudgetReliefCard(args: {
  channelName: string;
  target: string;
  sessionId: string;
  /**
   * 仅**测试注入**：出站解析器（缺省 = `channelRegistry` 存在性检查 + `channelBootstrapper`
   * 取插件实例 —— 与 `inboxChannelReply` 同源）。生产不传。
   */
  resolveOutbound?: (channelName: string) => BudgetReliefOutbound | undefined;
}): Promise<boolean> {
  if (!isChannelReplyEnabled()) return false;
  if (!args.sessionId || sentSessions.has(args.sessionId)) return false;

  let outbound: BudgetReliefOutbound | undefined;
  if (args.resolveOutbound) {
    outbound = args.resolveOutbound(args.channelName);
  } else {
    const channel = channelRegistry.get(args.channelName);
    if (!channel) {
      logger.warn('sendBudgetReliefCard: 通道未找到，跳过卡片', {
        channelName: args.channelName,
      });
      return false;
    }
    // 与 `inboxChannelReply` 同源：出站适配器取自 **插件实例**（`channelRegistry` 只用于存在性判断）
    const plugin = channelBootstrapper.getPluginInstance(args.channelName);
    outbound = (plugin as unknown as { outbound?: BudgetReliefOutbound })
      ?.outbound;
  }
  sentSessions.add(args.sessionId);

  // 降级文案 = **无按钮**版（如实：不谎称可点）
  const plain = `**今日预算已用完**\n${buildBudgetSuspendedNotice({ hasButtons: false })}`;

  // 入站回调**未接线**的通道 ⇒ **不给按钮**（点了没反应比没有按钮更糟）⇒ 只发如实文案（含桌面端出路）
  if (!BUTTON_CAPABLE_CHANNELS.has(args.channelName)) {
    logger.info('sendBudgetReliefCard: 该通道入站回调未接线，改发无按钮文案', {
      channelName: args.channelName,
    });
    try {
      if (typeof outbound?.sendMarkdown === 'function') {
        await outbound.sendMarkdown(args.target, plain);
        return true;
      }
      if (typeof outbound?.sendText === 'function') {
        await outbound.sendText(args.target, plain);
        return true;
      }
      return false;
    } catch (err) {
      await handleError(err, {
        module: 'channels:budgetReliefCard',
        action: 'sendBudgetReliefCard:无按钮文案发送失败',
        context: { channelName: args.channelName },
      });
      return false;
    }
  }

  const card = buildBudgetReliefCard({
    sessionId: args.sessionId,
    // 文案按**实际投递路径**取（有按钮 / 无按钮）—— 见 spec §D1：不得谎称可点按钮
    text: buildBudgetSuspendedNotice({ hasButtons: true }),
  });

  try {
    if (typeof outbound?.sendInteractive === 'function') {
      await outbound.sendInteractive(args.target, card);
      return true;
    }
    if (typeof outbound?.sendMarkdown === 'function') {
      await outbound.sendMarkdown(args.target, plain);
      return true;
    }
    if (typeof outbound?.sendText === 'function') {
      await outbound.sendText(args.target, plain);
      return true;
    }
    logger.warn('sendBudgetReliefCard: 通道无可用的出站适配器', {
      channelName: args.channelName,
    });
    return false;
  } catch (err) {
    // 降级一轮（含 QQ 无「自定义按钮」权限时 sendInteractive 被平台拒绝的情形）
    try {
      if (typeof outbound?.sendMarkdown === 'function') {
        await outbound.sendMarkdown(args.target, plain);
        sentSessions.delete(args.sessionId); // 未带上按钮 ⇒ 允许下次重试（可能已开通）
        return true;
      }
    } catch (fallbackErr) {
      await handleError(fallbackErr, {
        module: 'channels:budgetReliefCard',
        action: 'sendBudgetReliefCard:降级发送失败',
        context: { channelName: args.channelName },
      });
    }
    await handleError(err, {
      module: 'channels:budgetReliefCard',
      action: 'sendBudgetReliefCard:卡片发送失败',
      context: { channelName: args.channelName },
    });
    return false;
  }
}
