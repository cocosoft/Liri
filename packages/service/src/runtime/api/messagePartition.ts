/**
 * P0-4（2026-11-05）：**任务分区消息**（PDCA / 后台任务步骤）的过滤。
 *
 * 背景：PDCA 步骤消息与用户对话**共用同一 sessionId**（消息 `metadata.isTaskMessage = true`），
 * 真机实证用户会话里因此混入 8 条 PRD/FR 步骤消息（"答非所问"），并污染消息计数、上下文压缩
 * 与导出（`dev_docs/20261105/运行时问题清单-20261105.md` P0-4）。
 *
 * 口径（第二阶段）：**存储保留、用户面分离** —— 消息仍落在 `events.jsonl` / `messages.jsonl`
 * 供审计与回放，但用户会话的默认读取（`GET /v1/sessions/:id/messages`、计数、导出）**不含**
 * 任务消息；需要审计时显式 `includeTaskMessages`。
 *
 * 判据与计数口径的**单一事实源**在 infra（存储层同样要用）：
 * `@openliri/infra/utils/sessionCounts`。
 */
import { isTaskPartitionMessage } from '@openliri/infra/utils/sessionCounts';

export { isTaskPartitionMessage };

/**
 * 按需保留任务分区消息。
 *
 * @param includeTaskMessages `true` = 审计视图（全量）；缺省 `false` = 用户面视图（不含任务消息）
 */
export function filterTaskPartitionMessages<T>(
  messages: T[],
  includeTaskMessages?: boolean
): T[] {
  if (includeTaskMessages) return messages;
  return messages.filter((m) => !isTaskPartitionMessage(m as object));
}
