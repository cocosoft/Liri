/**
 * pendingInteractions —— 会话级「待处理交互」单槽的唯一形状与自愈判据（源码排查报告 S4）。
 *
 * 背景：`pendingInteractions` 是 `Map<sessionId, entry>` 单槽，靠调用方自觉释放；
 * 任一未知路径漏删（回调抛错、进程内异常分支）都会让该会话**永久**拒绝新的交互工具
 * （报告 D5）。本模块给条目加 `expiresAt`，并在「是否已有挂起交互」的判据处顺手清掉
 * 过期条目 ⇒ 即使漏释放，也会在 TTL 后自愈，而不是永久死锁。
 *
 * 纯基础设施：仅依赖 `constants`（叶子），可被 service / app 层复用。
 */

import { PENDING_INTERACTION_TTL_MS } from '@modules/constants';

/** 待处理交互条目（会话隔离；宿主与各执行路径共享同一 Map 实例） */
export interface PendingInteractionEntry {
  questionId: string;
  promise: Promise<string[]>;
  resolve: (answers: string[]) => void;
  /** 过期时间戳（毫秒）；到点后由 {@link hasActivePendingInteraction} 自愈清除 */
  expiresAt: number;
}

/**
 * 构造带 TTL 的条目。`ttlMs` 默认 5 分钟；非法值（<=0 / 非有限数）回落到默认 TTL。
 */
export function createPendingInteractionEntry(
  fields: Omit<PendingInteractionEntry, 'expiresAt'>,
  ttlMs: number = PENDING_INTERACTION_TTL_MS,
  now: number = Date.now()
): PendingInteractionEntry {
  const ttl =
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : PENDING_INTERACTION_TTL_MS;
  return { ...fields, expiresAt: now + ttl };
}

/**
 * 该会话是否**仍有未过期**的挂起交互。
 *
 * 副作用（有意）：命中过期条目时**就地删除** ⇒ 判据处即自愈点，无需额外定时器。
 */
export function hasActivePendingInteraction(
  pending: Map<string, PendingInteractionEntry> | undefined,
  sessionId: string,
  now: number = Date.now()
): boolean {
  if (!pending) return false;
  const entry = pending.get(sessionId);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    pending.delete(sessionId);
    return false;
  }
  return true;
}
