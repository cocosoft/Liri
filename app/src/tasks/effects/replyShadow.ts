/**
 * `reply` 影子队列（P38-b-2，2026-11-02）
 *
 * 方案：`dev_docs/20261102/effects队列reply迁移方案-20261102.md` §5。
 *
 * 定位：**只写不派发**。`EFFECT_REPLY_MIGRATION` 默认关 ⇒ 真实回传链路逐字不变，
 * 回传结束后把"本应回传"的事项写进 `effect_queue`，用于对照队列与真实投递是否一一对应。
 * 派发（`claimOne` → 真实回传 → `settle`）属 b-3，本模块**不调用**。
 *
 * 边界：
 * - 影子写失败只 warn（CS03）：对照数据缺失不得反向影响真实回传；
 * - `payload` 只放重建调用所需的最小字段（不落整条 Inbox 记录，避免双份存储）；
 * - 幂等键 `channelId:inboxItemId` ⇒ 同一 Inbox 项在同一渠道只有一行（重复入队 ⇒ generation+1）。
 */
import { feature } from '@openliri/kernel';
import { getLogger } from '@openliri/infra/monitoring';

import { EffectQueue } from './EffectQueue';
import type { EffectKind } from './types';

const logger = getLogger('effects:reply:shadow');

/** 迁移目标类别（`EFFECT_KINDS` 中的 `reply`） */
export const REPLY_EFFECT_KIND = 'reply' satisfies EffectKind;

/** 影子载荷（重建回传所需的最小字段） */
export interface ReplyEffectPayload {
  inboxItemId: string;
  channelId: string;
  channelSessionId?: string;
  conversationId?: string;
  reply?: string;
}

export interface ReplyShadowInput extends ReplyEffectPayload {
  /** 真实投递是否成功（跳过回传时不写影子） */
  delivered: boolean;
}

/** 幂等键：同一 Inbox 项在同一渠道只回传一次 */
export function replyEffectKey(channelId: string, inboxItemId: string): string {
  return `${channelId}:${inboxItemId}`;
}

/** 影子写所需的最小队列面（测试可注入替身） */
export type ReplyShadowQueue = Pick<EffectQueue, 'enqueue'>;

let shadowQueue: ReplyShadowQueue | null = null;

function getShadowQueue(): ReplyShadowQueue {
  // 本地共享库（与 P38 队列 / `SettlementOutbox` 同口径）：本队列不做租户分库与行级隔离
  shadowQueue ??= new EffectQueue();
  return shadowQueue;
}

/** 测试用：注入替身 / 复位单例 */
export function setReplyShadowQueueForTest(
  queue: ReplyShadowQueue | null
): void {
  shadowQueue = queue;
}

/**
 * 回传结束后写一条影子记录（**不派发**）。
 *
 * 开关打开 ⇒ 影子停止（b-3 由真实链路自己入队）；影子异常只 warn。
 */
export async function shadowReplyRelay(input: ReplyShadowInput): Promise<void> {
  if (feature('EFFECT_REPLY_MIGRATION')) return;

  const payload: ReplyEffectPayload = {
    inboxItemId: input.inboxItemId,
    channelId: input.channelId,
    channelSessionId: input.channelSessionId,
    conversationId: input.conversationId,
    reply: input.reply,
  };

  try {
    const generation = await getShadowQueue().enqueue(
      REPLY_EFFECT_KIND,
      replyEffectKey(input.channelId, input.inboxItemId),
      { ...payload }
    );
    // 只记差异：真实投递未成功而影子已入队 ⇒ 队列会重试，两侧分叉（需在观察期解释）
    if (!input.delivered) {
      logger.info('effects:reply:shadow-diff', {
        inboxItemId: input.inboxItemId,
        channelId: input.channelId,
        realDelivered: false,
        shadow: 'enqueued',
        generation,
      });
    }
  } catch (err) {
    // @ignore-catch: 对照数据缺失不得影响真实回传（CS03）
    logger.warn('effects:reply:shadow-write-failed', {
      inboxItemId: input.inboxItemId,
      channelId: input.channelId,
      error: String(err),
    });
  }
}
