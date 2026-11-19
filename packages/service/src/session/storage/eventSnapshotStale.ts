// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 事件快照「新鲜度判定」的可预期竞态识别 + 日志分级（2026-11-20）
 *
 * 背景（真机 `app.log` 94 条 warn，且字段自相矛盾）：
 * `EventLogStorage.snapshotStaleReason()` 先**同步**比较快照尾与 `tailSeq`，随后 `await` 读盘尾；
 * 该窗口内本实例继续 append ⇒ 事后比较用的 `tailSeq` 已推进 ⇒ 盘尾"看起来落后"，被判
 * `disk-behind`。这不是"文件被外部截断"（需要告警），而是**常规竞态**，不应刷 warn。
 *
 * 本模块只负责**判定分级与字段拼装**：缓存判定与「失效快照 + 回退磁盘读取」仍在宿主，
 * 行为逐字不变（只改日志）。
 */

/** 宿主持有的日志能力（结构化最小面，避免把 Logger 类型耦合进来） */
export interface SnapshotStaleLogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
}

/** 日志消息（唯一真源） */
export const SNAPSHOT_STALE_LOG_MESSAGE =
  'event-log: 事件快照过期，失效并回退磁盘读取';

/**
 * `disk-behind` 是否只是「判定期间本实例继续 append」造成的**可预期竞态**。
 *
 * - `true` ⇒ 降 `debug`（并非外部截断）；
 * - `false` ⇒ 保持 `warn`（真·盘尾落后/被截断，需要人看）。
 */
export function isBenignSnapshotDiskBehindRace(
  staleReason: string,
  appendedDuringCheck: boolean
): boolean {
  return staleReason === 'disk-behind' && appendedDuringCheck;
}

/**
 * 按竞态判定分级落日志。
 *
 * 字段口径（两次比较各自的输入都可读，杜绝"数字与判定不同源"）：
 * - `memoryTailSeq`：判定时（`await` 之后）的 `tailSeq` —— 即 `disk-ahead/disk-behind` 比较用的值；
 * - `tailSeqAtCheck`（仅竞态时）：判定入口捕获的 `tailSeq` —— 即"快照是否覆盖"比较用的值。
 */
export function logSnapshotStale(
  logger: SnapshotStaleLogger,
  sessionId: string,
  snapshotTailSeq: number,
  tailSeqAtCheck: number,
  tailSeqNow: number,
  staleReason: string
): void {
  const appendedDuringCheck = tailSeqAtCheck !== tailSeqNow;
  const fields: Record<string, unknown> = {
    sessionId,
    snapshotTailSeq,
    memoryTailSeq: tailSeqNow,
    staleReason,
    ...(appendedDuringCheck
      ? { appendedDuringCheck: true, tailSeqAtCheck }
      : {}),
  };
  if (isBenignSnapshotDiskBehindRace(staleReason, appendedDuringCheck)) {
    logger.debug(SNAPSHOT_STALE_LOG_MESSAGE, fields);
  } else {
    logger.warn(SNAPSHOT_STALE_LOG_MESSAGE, fields);
  }
}
