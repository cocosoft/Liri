// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 跨轮工具交换的**成对**清理（2026-11-20）
 *
 * 背景（真机取证）：`buildApiMessagesForStream` 原本只删「最后一条 user 之前」的
 * `assistant.tool_calls` 声明，**却把它对应的 `tool` 结果留在列表里**。
 * 这会造成两种后果：
 *   ① 这些 tool 结果在 provider 侧成了"孤儿" ⇒ `ChatCompletionsTransport.convertMessages`
 *      再逐条剥离（真机 `count=8 / totalMessages=17`，即上一轮 8 个结果全被剥离）；
 *   ② 同一语义要在两处实现（此处"半清理" + transport"兜底剥离"），日志噪音且易漂移。
 *
 * 本函数按**原子块**语义清理：被清掉声明的那些 `tool_call_id`，其 `tool` 结果一并移除，
 * 使"旧轮次工具交换整体不进入上下文"这一意图**一次说清**，且净效果与现状一致
 * （原先也是被 transport 剥离），只是不再产生孤儿与 warn。
 *
 * 范围严格限定在 `[0, lastUserMsgIdx)`：当前轮（最后一条 user 之后）一律不动。
 */

export interface CrossRoundCleanupResult {
  /** 被清掉声明的 assistant 消息数 */
  clearedAssistantDeclarations: number;
  /** 因声明被清而一并移除的 tool 结果数 */
  removedPairedToolResults: number;
}

/**
 * 就地清理 `messages` 中"最后一条 user 之前"的旧轮次工具交换（成对）。
 *
 * @param messages 就地修改的 API 消息数组
 * @param lastUserMsgIdx 最后一条 user 消息的下标（`-1` ⇒ 无 user，全部视为旧轮次）
 */
export function pruneCrossRoundToolExchanges(
  messages: Array<Record<string, unknown>>,
  lastUserMsgIdx: number
): CrossRoundCleanupResult {
  const limit = lastUserMsgIdx < 0 ? messages.length : lastUserMsgIdx;
  const clearedIds = new Set<string>();
  let clearedAssistantDeclarations = 0;

  for (let i = 0; i < limit; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) {
      continue;
    }
    for (const call of msg.tool_calls as Array<{ id?: unknown }>) {
      const id = call?.id;
      if (typeof id === 'string' && id) clearedIds.add(id);
    }
    delete msg.tool_calls;
    clearedAssistantDeclarations++;
  }

  let removedPairedToolResults = 0;
  if (clearedIds.size > 0) {
    // 倒序 splice：只在下标 `< limit` 范围内操作，删除不影响未访问区间
    for (let i = limit - 1; i >= 0; i--) {
      const msg = messages[i];
      if (!msg || msg.role !== 'tool') continue;
      const toolCallId = msg.tool_call_id;
      if (typeof toolCallId !== 'string') continue;
      if (!clearedIds.has(toolCallId)) continue;
      messages.splice(i, 1);
      removedPairedToolResults++;
    }
  }

  return { clearedAssistantDeclarations, removedPairedToolResults };
}
