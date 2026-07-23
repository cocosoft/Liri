/**
 * 工具配对完整性保护（Phase 3）
 * 对标 PilotDeck toolPairIntegrity.ts
 *
 * 确保压缩后 tool_call ↔ tool_result 配对完整
 */
import type { ChatMessage } from '../../ai/models/types';

/**
 * 收集所有 tool_call ID
 */
export function collectToolCallIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    const tcId = (msg as unknown as Record<string, unknown>).tool_call_id as
      | string
      | undefined;
    if (tcId) ids.add(tcId);
    // 也收集 assistant 消息中的 tool_calls 数组
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        if (tc.id) ids.add(tc.id);
      }
    }
  }
  return ids;
}

/**
 * 收集所有 tool_result ID（结果中的 tool_call_id 字段）
 */
export function collectToolResultIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    const resultCallId = (msg as unknown as Record<string, unknown>)
      .tool_call_id as string | undefined;
    if (resultCallId) ids.add(resultCallId);
  }
  return ids;
}

/**
 * 移除孤立的 tool_calls（有调用无结果）
 */
export function stripUnpairedToolCalls(
  messages: ChatMessage[],
  pairedResultIds: Set<string>
): ChatMessage[] {
  return messages.filter((msg) => {
    const tcId = (msg as unknown as Record<string, unknown>).id as
      | string
      | undefined;
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;

    // 如果消息有 tool_calls 但所有都无配对结果，过滤掉
    if (toolCalls && toolCalls.length > 0) {
      const hasPaired = toolCalls.some(
        (tc) => tc.id && pairedResultIds.has(tc.id)
      );
      return hasPaired;
    }

    // 单个 tool_call
    if (tcId && !pairedResultIds.has(tcId)) return false;
    return true;
  });
}

/**
 * 移除孤立的 tool_results（有结果无调用）
 */
export function stripUnpairedToolResults(
  messages: ChatMessage[],
  pairedCallIds: Set<string>
): ChatMessage[] {
  return messages.filter((msg) => {
    const resultCallId = (msg as unknown as Record<string, unknown>)
      .tool_call_id as string | undefined;
    if (resultCallId && !pairedCallIds.has(resultCallId)) return false;
    return true;
  });
}

/**
 * 确保消息数组以 user 消息结尾（API 要求）
 * 如果以 assistant 结尾，追加 continue 标记
 */
export function ensureTrailingUserMessage(
  messages: ChatMessage[]
): ChatMessage[] {
  if (messages.length === 0) return messages;

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return [
      ...messages,
      { role: 'user', content: 'Continue.' } as unknown as ChatMessage,
    ];
  }
  return messages;
}
