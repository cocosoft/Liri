// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * abortAttribution — checkpoint `abortedBy` 的**取值单一事实源**（批次 5，2026-11-24）。
 *
 * 为什么需要：`abortedBy` 决定两件事，两者都曾被写错：
 * 1. **用户可见归因**（回执文案）：旧实现把所有收口都说成「进程重启」，
 *    真机 `session_mwq5ookl21aa28ea96` 实为审批卡过期（见 `frontend-task-tools-governance.md` §3.2）；
 * 2. **能否续跑**：`/resume` 与 `PDCA_AUTO_RESUME` 按来源放行。
 *
 * 取值含义：
 * - `startup_scan`：进程重启后启动扫描收口（真崩溃遗留）；
 * - `orphan_scan`：启动扫描发现"待审批但收件箱已无 pending 卡"的孤儿；
 * - `approval_expired`：审批卡过期**当场**收口（不必等下次启动）；
 * - `user_abort`：用户主动拒绝 / 中止。
 */
export const ABORTED_BY_STARTUP_SCAN = 'startup_scan';
export const ABORTED_BY_ORPHAN_SCAN = 'orphan_scan';
export const ABORTED_BY_APPROVAL_EXPIRED = 'approval_expired';
export const ABORTED_BY_USER_ABORT = 'user_abort';

export type AbortedBy =
  | typeof ABORTED_BY_STARTUP_SCAN
  | typeof ABORTED_BY_ORPHAN_SCAN
  | typeof ABORTED_BY_APPROVAL_EXPIRED
  | typeof ABORTED_BY_USER_ABORT;

/**
 * 是否属于「审批卡过期」类收口（正文用同一归因，不区分当场过期 / 重启后才发现的孤儿）。
 */
export function isApprovalExpiryAbort(abortedBy: string | undefined): boolean {
  return (
    abortedBy === ABORTED_BY_ORPHAN_SCAN ||
    abortedBy === ABORTED_BY_APPROVAL_EXPIRED
  );
}
