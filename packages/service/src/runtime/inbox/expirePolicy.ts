/**
 * 过期扫描的**策略常量**（2026-11-24 从 `InboxManager` 外迁，FSZ-006 拆分步骤 ②）
 *
 * 独立成模块的原因：`expireScan` 需要这两个运行时值，若从宿主 import 会形成
 * `InboxManager → expireScan → InboxManager` 的**运行时环**；常量下沉后无环。
 * 宿主仍 `export { PROCESSING_STALE_TIMEOUT_MS }` 转发，公开 API 不变。
 */

// 时间换算取常量真源（`lint:consts` D-2：不在业务文件里裸写 `n * 60 * 1000`）
import { MS_PER_MINUTE } from '@openliri/infra/constants';

/**
 * 2026-11-24（批次 1 / A1）：`processing` 是 CAS 抢锁（`tryUpdateStatus`，会刷新 `updated_at`）
 * 之后的**中间态**。进程在"已抢锁、未落 reply"之间崩溃/失败时，卡会永久停在 `processing`
 * —— 既不在原 `pending` 过期口径内，也不可再回复（卡永久不可处理）。
 * 按 `updated_at` 兜底：超过该阈值仍未落定的 `processing` 卡视为过期。
 */
export const PROCESSING_STALE_TIMEOUT_MS = MS_PER_MINUTE * 10;

/**
 * 「工作区访问申请」的 SQL 判据。
 *
 * 与 `_requestWorkspaceScopeApproval` 写入的 `metadata.kind = 'workspace-scope'` 同源；
 * 用 LIKE 而非 `json_extract` 是因为过期清理走的是 `sqlite3` 回调接口，不保证 JSON1 扩展可用。
 */
export const WORKSPACE_SCOPE_PREDICATE = `COALESCE(metadata,'') LIKE '%"workspace-scope"%'`;
