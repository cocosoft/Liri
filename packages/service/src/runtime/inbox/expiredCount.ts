/**
 * 过期审批卡的**精确计数**（2026-11-24 从 `InboxManager.countExpiredApprovalsAfter` 逐字外迁，
 * FSZ-006 拆分步骤 ①）。
 *
 * 为什么需要：调用方曾用 `list({ limit: 5 }).some(...)` 判"上次审批已过期"——
 * 结果集按 `created_at` 截断，一条"创建很早但最近才过期"的卡会被漏掉（误判为可续跑）。
 * `updated_at` 即进入终态的时刻（`expireOnDb` / `expireByIds` 均刷新它）。
 */

import type { Database } from '@openliri/infra/external';

export async function countExpiredApprovalsOn(
  db: Database,
  sessionId: string,
  afterMs: number,
  ownerKey: string
): Promise<number> {
  const row = await new Promise<{ cnt: number }>((resolve, reject) => {
    db.get(
      `SELECT COUNT(*) as cnt FROM inbox_items
          WHERE session_id = ? AND status = 'expired' AND type = 'approval'
            AND updated_at > ? AND owner_key = ?`,
      [sessionId, afterMs, ownerKey],
      (err: Error | null, row: { cnt: number }) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
  return row.cnt;
}
