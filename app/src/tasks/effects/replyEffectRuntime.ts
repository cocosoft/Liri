/**
 * `reply` effect 运行时（P38-b-3，2026-11-02）
 *
 * 方案：`dev_docs/20261102/effects队列reply迁移方案-20261102.md` §4 / §6。
 *
 * 开关 `EFFECT_REPLY_MIGRATION` 开启时的真实链路：
 * ```
 * 回传调用点 → enqueue('reply', key) → 扫描器 listDueCandidates → claimOne（单胜者）
 *            → 按 inboxItemId 重读 Inbox 项 → relayReplyToChannel(fromQueue) → settle
 * ```
 * - **不双发**：`fromQueue` 只由本模块传入，回传模块据此跳过"入队"分支；
 * - **崩溃自愈**：`listDueCandidates` 含超过陈旧窗口的 `effect_attempting`，
 *   `claimOne` 重领时带 `restored=true`（对端可能已收到过）；
 * - **载荷最小**：只存 id 与渠道引用，正文/标题在派发时从 Inbox 重读（避免双份存储）。
 *
 * 开关关闭 ⇒ `startReplyEffectDispatcher()` 直接返回 no-op（回滚即回到原链路）。
 */
import { feature } from '@openliri/kernel';
import { getLogger } from '@openliri/infra/monitoring';
import type { InboxItem } from '@modules/runtime/InboxManager';

import { EFFECT_REPLY_POLL_MS } from '@openliri/infra/constants';

import { EffectQueue } from './EffectQueue';
import {
  REPLY_EFFECT_KIND,
  replyEffectKey,
  type ReplyEffectPayload,
} from './replyShadow';
import type { ClaimEffectResult, EffectEntry } from './types';
import { EFFECT_OUTCOME_DONE, EFFECT_OUTCOME_FAILED } from './types';

const logger = getLogger('effects:reply:runtime');

/** 派发依赖（宿主装配 / 测试注入） */
export interface ReplyDispatchDeps {
  /** 按 id 重读 Inbox 项（`null` ⇒ 该项已不存在，重试无意义） */
  loadItem: (inboxItemId: string) => Promise<InboxItem | null>;
  /** 真实回传（`true` = 已投递） */
  relay: (item: InboxItem) => Promise<boolean>;
}

let queue: EffectQueue | null = null;

function getQueue(): EffectQueue {
  // 本地共享库（与 P38 队列 / `SettlementOutbox` 同口径）：不做租户分库与行级隔离
  queue ??= new EffectQueue();
  return queue;
}

/** 测试用：注入队列 / 复位单例 */
export function setReplyEffectQueueForTest(injected: EffectQueue | null): void {
  queue = injected;
}

/**
 * 入队一条 `reply` effect（仅供宿主经端口调用）。
 *
 * @returns `true` = 已入队（调用方不得再直接回传）；`false` = 开关关闭或入队失败
 *          ⇒ 调用方**回落直接回传**（宁可多一条直发，不可丢用户可见回复）
 */
export async function enqueueReplyEffect(
  input: ReplyEffectPayload
): Promise<boolean> {
  if (!feature('EFFECT_REPLY_MIGRATION')) return false;
  try {
    await getQueue().enqueue(
      REPLY_EFFECT_KIND,
      replyEffectKey(input.channelId, input.inboxItemId),
      { ...input }
    );
    return true;
  } catch (err) {
    logger.warn('effects:reply:enqueue-failed', {
      inboxItemId: input.inboxItemId,
      channelId: input.channelId,
      error: String(err),
    });
    return false;
  }
}

/** 从载荷还原最小字段（坏载荷 ⇒ `null`，按失败结算） */
function parsePayload(
  payload: Record<string, unknown> | undefined
): ReplyEffectPayload | null {
  const inboxItemId = payload?.['inboxItemId'];
  const channelId = payload?.['channelId'];
  if (typeof inboxItemId !== 'string' || typeof channelId !== 'string') {
    return null;
  }
  const channelSessionId = payload?.['channelSessionId'];
  const conversationId = payload?.['conversationId'];
  const reply = payload?.['reply'];
  return {
    inboxItemId,
    channelId,
    ...(typeof channelSessionId === 'string' ? { channelSessionId } : {}),
    ...(typeof conversationId === 'string' ? { conversationId } : {}),
    ...(typeof reply === 'string' ? { reply } : {}),
  };
}

/** 派发一条已领取的 effect（失败 ⇒ `settle(failed)` 退避重排/达上限置 failed） */
async function deliverOne(
  deps: ReplyDispatchDeps,
  entry: EffectEntry,
  claim: ClaimEffectResult,
  now: number
): Promise<void> {
  const generation = claim.generation;
  if (generation === undefined) return;
  const fail = (error: string) =>
    getQueue().settle(
      entry.kind,
      entry.key,
      generation,
      {
        kind: EFFECT_OUTCOME_FAILED,
        error,
      },
      now
    );

  const payload = parsePayload(claim.payload);
  if (!payload) {
    await fail('invalid_payload');
    return;
  }

  let item: InboxItem | null;
  try {
    item = await deps.loadItem(payload.inboxItemId);
  } catch (err) {
    await fail(`load_failed: ${String(err)}`);
    return;
  }
  if (!item) {
    // 工作项已不存在：重试不会变好，按失败累计（达上限后置 failed，面板可见）
    await fail('inbox_item_missing');
    return;
  }

  let delivered: boolean;
  try {
    delivered = await deps.relay(item);
  } catch (err) {
    await fail(`relay_failed: ${String(err)}`);
    return;
  }

  await getQueue().settle(
    entry.kind,
    entry.key,
    generation,
    delivered
      ? { kind: EFFECT_OUTCOME_DONE }
      : { kind: EFFECT_OUTCOME_FAILED, error: 'relay_undelivered' },
    now
  );
}

/**
 * 派发一轮（只处理 `reply`；到期 pending 或陈旧 attempting）。
 *
 * 并发安全：候选只读，逐条 `claimOne` ⇒ 同进程/跨进程都只有一个胜者。
 *
 * @returns 本轮成功领取并处理（含失败结算）的条数
 */
export async function dispatchDueReplies(
  deps: ReplyDispatchDeps,
  now: number = Date.now(),
  limit = 20
): Promise<number> {
  const q = getQueue();
  const candidates = (await q.listDueCandidates(now, limit)).filter(
    (entry) => entry.kind === REPLY_EFFECT_KIND
  );
  let dispatched = 0;
  for (const entry of candidates) {
    const claim = await q.claimOne(entry.kind, entry.key, now);
    if (!claim.claimed) continue; // 已被其它消费者领取
    dispatched += 1;
    await deliverOne(deps, entry, claim, now);
  }
  return dispatched;
}

/** 当前已启动的 tick（`kick` 复用；未启动 ⇒ `null`） */
let activeTick: (() => Promise<void>) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

/**
 * 启动派发扫描器（开关关闭 ⇒ no-op）。
 *
 * - 启动即扫描一轮（崩溃后自愈：陈旧 `effect_attempting`）；
 * - 之后每 {@link EFFECT_REPLY_POLL_MS} 一轮（只负责重试唤醒；新入队由 `kick` 即时触发）；
 * - 同进程内**串行**（`tickInFlight`），并发兜底仍是 `claimOne` 的原子条件更新。
 *
 * @returns 停止函数（进程退出 / 测试清理）
 */
export function startReplyEffectDispatcher(
  deps: ReplyDispatchDeps
): () => void {
  if (!feature('EFFECT_REPLY_MIGRATION')) {
    logger.info(
      'reply effect 派发未启用（FEATURE_EFFECT_REPLY_MIGRATION=false）'
    );
    return () => {};
  }
  if (activeTick) return () => {};

  const tick = async (): Promise<void> => {
    // 热回滚：运行期把开关关掉后，下一轮起不再消费队列（已入队行保留，不删除）
    if (!feature('EFFECT_REPLY_MIGRATION')) return;
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      await dispatchDueReplies(deps);
    } catch (err) {
      // @ignore-catch: 单轮失败不终止扫描器（下一轮重试；DB 瞬时故障可自愈）
      logger.warn('effects:reply:dispatch-tick-failed', {
        error: String(err),
      });
    } finally {
      tickInFlight = false;
    }
  };

  activeTick = tick;
  void tick();
  timer = setInterval(() => {
    void tick();
  }, EFFECT_REPLY_POLL_MS);
  timer.unref?.();

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
    activeTick = null;
    tickInFlight = false;
  };
}

/** 新入队后即时唤醒一轮（未启动 ⇒ 无操作） */
export function kickReplyEffectDispatcher(): void {
  void activeTick?.();
}

/**
 * 宿主默认依赖：从 Inbox 重读工作项 + 以 `fromQueue` 调用真实回传。
 *
 * 动态 import：`runtime` / `channels` 均为 service 层，避免启动期把两者拉进 app 依赖面。
 */
export async function createDefaultReplyDispatchDeps(): Promise<ReplyDispatchDeps> {
  const { inboxManager } = await import('@modules/runtime/InboxManager');
  const { relayReplyToChannel } =
    await import('@modules/channels/bridge/inboxChannelReply.js');
  return {
    loadItem: (inboxItemId) => inboxManager.get(inboxItemId),
    relay: (item) => relayReplyToChannel(item, { fromQueue: true }),
  };
}
