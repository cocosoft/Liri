/**
 * P1-5 / P0-4（2026-11-05）：会话**用户面计数**与**任务分区**的单一口径（infra 层）。
 *
 * 为什么下沉到 infra：同一套判据有两个消费面 ——
 *   ① 存储层（`session/storage/**`）在写消息时把计数**持久化**进 `metadata`（跨重启准确，
 *      R08-001：跨重启状态不得只放内存）；
 *   ② 运行时读接口（`runtime/api/**`）在列表/详情里投影计数、并过滤任务分区消息。
 * 两处各写一份必然漂移（历史事故：详情 165 条 vs 列表 7 条）。
 *
 * 口径（与导出/UI 对齐）：
 *   - `messageCount` = **user + assistant** 消息数（不含 tool / system）；
 *   - `roundCount`   = **user** 消息数（= 对话轮次）；
 *   - 两者都**排除任务分区消息**（PDCA / 后台任务步骤，`metadata.isTaskMessage === true`）。
 */

export interface ConversationCounts {
  /** 用户面消息数（user + assistant；不含 tool/system 与任务分区消息） */
  messageCount: number;
  /** 对话轮次（user 消息数） */
  roundCount: number;
}

/**
 * 该消息是否属于任务分区（PDCA / 后台任务步骤）。
 *
 * 判据只用**结构化标记**（CS02：禁止用文案/标题等字符串做状态判断）；脏值（如字符串
 * `'true'`）一律不算。
 */
export function isTaskPartitionMessage(message: object): boolean {
  const metadata = (message as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as { isTaskMessage?: unknown }).isTaskMessage === true;
}

/** 计算用户面计数（一次遍历；口径见文件头） */
export function computeConversationCounts(
  messages: Array<{ role?: string }> | undefined
): ConversationCounts {
  if (!messages || messages.length === 0) {
    return { messageCount: 0, roundCount: 0 };
  }
  let messageCount = 0;
  let roundCount = 0;
  for (const message of messages) {
    if (isTaskPartitionMessage(message)) continue;
    if (message.role === 'user') {
      messageCount += 1;
      roundCount += 1;
    } else if (message.role === 'assistant') {
      messageCount += 1;
    }
  }
  return { messageCount, roundCount };
}
