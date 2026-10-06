/**
 * passiveReplyTracker.ts — QQ 被动回复上下文跟踪
 *
 * 由 `QQChannel.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §40）：**只搬不改**（含全部原注释）。
 *
 * AC-5（2026-08-20）：被动回复窗口内出站携带原消息 msg_id/msg_seq 可走被动回复通道，
 * 不占用主动消息每日配额。logger 由宿主注入（同一实例）⇒ 日志 module 字段与拆分前一致。
 */

import { Logger } from '@modules/monitoring';

export class QQPassiveReplyTracker {
  /** AC-5（2026-08-20）：被动回复上下文 — target → 最近入站消息。
   *  QQ 被动回复窗口内出站携带原消息 msg_id/msg_seq 可走被动回复通道，
   *  不占用主动消息每日配额。 */
  private readonly byTarget = new Map<
    string,
    { msgId: string; receivedAt: number; lastSeq: number }
  >();

  /** AC-5：QQ 被动回复窗口（官方 5 分钟，留安全余量） */
  private static readonly PASSIVE_REPLY_WINDOW_MS = 270_000;

  /** AC-5：QQ 服务端对同一 msg_id 仅保留最近 5 条被动回复（msg_seq 超出被静默丢弃） */
  private static readonly PASSIVE_REPLY_MAX_SEQ = 5;

  constructor(private readonly logger: Logger) {}

  /**
   * AC-5（2026-08-20）：记录入站消息的被动回复上下文。
   * target 与出站 sendMessage 的 target 同格式（c2c:{openid} / group:{group_openid}）。
   */
  recordPassiveReplyContext(target: string, msgId: string): void {
    this.byTarget.set(target, {
      msgId,
      receivedAt: Date.now(),
      lastSeq: 0,
    });
    // 防膨胀兜底：超窗条目顺手清理（正常路径由 consume 清理）
    if (this.byTarget.size > 200) {
      const now = Date.now();
      for (const [k, v] of this.byTarget) {
        if (
          now - v.receivedAt >
          QQPassiveReplyTracker.PASSIVE_REPLY_WINDOW_MS
        ) {
          this.byTarget.delete(k);
        }
      }
    }
    this.logger.debug('QQ 被动回复上下文已记录', { target, msgId });
  }

  /**
   * AC-5：消费被动回复字段。窗口内返回 {msg_id, msg_seq}（seq 递增保证同一
   * 消息的多条回复不被 QQ 去重）。以下情况返回空对象（降级主动消息通道）：
   * - 超过被动回复窗口（270s）
   * - seq 已达 QQ 服务端保留上限（同 msg_id 仅保留最近 5 条，超出被静默丢弃）
   */
  consumePassiveReplyFields(
    target: string
  ): { msg_id: string; msg_seq: number } | Record<string, never> {
    const ctx = this.byTarget.get(target);
    if (!ctx) {
      // 降级原因①：无入站上下文（定时任务/主动通知，或上下文已被清理）
      this.logger.debug(
        'QQ 被动回复降级：target 无入站消息上下文，本次走主动消息通道',
        { target, contextSize: this.byTarget.size }
      );
      return {};
    }
    const elapsed = Date.now() - ctx.receivedAt;
    if (elapsed > QQPassiveReplyTracker.PASSIVE_REPLY_WINDOW_MS) {
      // 降级原因②：超过被动回复窗口（官方 5 分钟，本地留余量 270s）
      this.byTarget.delete(target);
      this.logger.info(
        `QQ 被动回复降级：窗口已过期(elapsed=${elapsed}ms > window=${QQPassiveReplyTracker.PASSIVE_REPLY_WINDOW_MS}ms)，本次走主动消息通道`,
        { target, msgId: ctx.msgId, elapsedMs: elapsed }
      );
      return {};
    }
    // seq 上限保护：QQ 服务端仅保留同 msg_id 最近 5 条被动回复，
    // 第 6 条起会被静默丢弃——必须降级主动消息，否则消息丢失
    if (ctx.lastSeq >= QQPassiveReplyTracker.PASSIVE_REPLY_MAX_SEQ) {
      // 降级原因③：seq 达到 QQ 服务端保留上限
      this.logger.warning(
        `QQ 被动回复降级：seq 已达上限(lastSeq=${ctx.lastSeq} >= max=${QQPassiveReplyTracker.PASSIVE_REPLY_MAX_SEQ}，超出部分 QQ 服务端静默丢弃)，本次走主动消息通道`,
        { target, msgId: ctx.msgId, lastSeq: ctx.lastSeq, elapsedMs: elapsed }
      );
      return {};
    }
    // 成功路径：seq 递增（0→1 为首条回复，QQ 规范 seq 从 1 开始）
    ctx.lastSeq += 1;
    this.logger.debug(
      `QQ 被动回复字段生成：seq 递增 ${ctx.lastSeq - 1} → ${ctx.lastSeq}（同 msg_id 第 ${ctx.lastSeq} 条被动回复）`,
      {
        target,
        msgId: ctx.msgId,
        seq: ctx.lastSeq,
        elapsedMs: elapsed,
        remainingWindowMs:
          QQPassiveReplyTracker.PASSIVE_REPLY_WINDOW_MS - elapsed,
        remainingSeqQuota:
          QQPassiveReplyTracker.PASSIVE_REPLY_MAX_SEQ - ctx.lastSeq,
      }
    );
    return { msg_id: ctx.msgId, msg_seq: ctx.lastSeq };
  }
}
