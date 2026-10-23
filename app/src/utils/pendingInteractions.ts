/**
 * pendingInteractions —— 会话级「待处理交互」单槽的唯一形状与自愈判据（源码排查报告 S4）。
 *
 * 背景：`pendingInteractions` 是 `Map<sessionId, entry>` 单槽，靠调用方自觉释放；
 * 任一未知路径漏删（回调抛错、进程内异常分支）都会让该会话**永久**拒绝新的交互工具
 * （报告 D5）。本模块给条目加 `expiresAt`，并在「是否已有挂起交互」的判据处顺手清掉
 * 过期条目 ⇒ 即使漏释放，也会在 TTL 后自愈，而不是永久死锁。
 *
 * 纯基础设施：依赖 `constants`（叶子）与 `core/identity`（身份判定，不被上层反向依赖），
 * 可被 service / app 层复用。
 */

import { PENDING_INTERACTION_TTL_MS } from '@modules/constants';
import {
  canAccessOwnerKey,
  currentOwnerKey,
} from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';

/** 待处理交互条目（会话隔离；宿主与各执行路径共享同一 Map 实例） */
export interface PendingInteractionEntry {
  questionId: string;
  promise: Promise<string[]>;
  resolve: (answers: string[]) => void;
  /** 过期时间戳（毫秒）；到点后由 {@link hasActivePendingInteraction} 自愈清除 */
  expiresAt: number;
  /**
   * 归属键（多租户 P3：`<tenantId>:<userId>`）。
   *
   * 缺省 ⇒ 本地 / 后台（桌面、CLI、通道）—— 与改造前一致。
   * 由 {@link createPendingInteractionEntry} 在**创建时**自动写入当前身份：
   * 解析与"是否仍有挂起"的判定都会按它做 fail-closed 校验，避免跨身份唤醒。
   */
  ownerKey?: string;
}

/**
 * 构造带 TTL 的条目。`ttlMs` 默认 5 分钟；非法值（<=0 / 非有限数）回落到默认 TTL。
 *
 * 多租户 P3：创建时**自动**写入当前身份的归属键（本地身份 ⇒ 不写字段，零变更）。
 */
export function createPendingInteractionEntry(
  fields: Omit<PendingInteractionEntry, 'expiresAt' | 'ownerKey'>,
  ttlMs: number = PENDING_INTERACTION_TTL_MS,
  now: number = Date.now()
): PendingInteractionEntry {
  const ttl =
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : PENDING_INTERACTION_TTL_MS;
  const ownerKey = currentOwnerKey();
  return {
    ...fields,
    expiresAt: now + ttl,
    ...(ownerKey ? { ownerKey } : {}),
  };
}

/**
 * 该会话是否**仍有未过期且属于当前身份**的挂起交互。
 *
 * 副作用（有意）：命中过期条目时**就地删除** ⇒ 判据处即自愈点，无需额外定时器。
 * 多租户 P3：他人的条目视为"没有挂起"（fail-closed），不阻断也不误唤醒。
 */
export function hasActivePendingInteraction(
  pending: Map<string, PendingInteractionEntry> | undefined,
  sessionId: string,
  now: number = Date.now(),
  principal?: Principal
): boolean {
  if (!pending) return false;
  const entry = pending.get(sessionId);
  if (!entry) return false;
  if (entry.expiresAt <= now) {
    pending.delete(sessionId);
    return false;
  }
  return canAccessOwnerKey(entry.ownerKey, principal);
}
