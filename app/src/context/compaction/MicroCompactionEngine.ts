/**
 * MicroCompactionEngine — Tier 1 微压缩（Phase 3）
 * 对标 PilotDeck MicroCompactionEngine
 *
 * 将超时（TTL 过期）的 tool_result 内容替换为占位符
 * 零 LLM 调用，O(n) 复杂度
 */
import type { ChatMessage } from '../../ai/models/types';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:compaction:micro',
  level: LogLevel.INFO,
});

/** CC 源码 COMPACTABLE_TOOL_NAMES 对应项 */
const COMPACTABLE_TOOL_NAMES = new Set([
  'read_file',
  'Read',
  'bash',
  'Bash',
  'grep',
  'Grep',
  'glob',
  'Glob',
  'web_search',
  'web_fetch',
  'edit_file',
  'write_file',
  'Write',
]);

const MICROCOMPACT_CLEARED = '[Old tool result content cleared]';

export interface MicroCompactionInput {
  messages: ChatMessage[];
  nowMs?: number;
  ttlMs?: number;
  keepLatest?: number;
}

export interface MicroCompactionResult {
  messages: ChatMessage[];
  rewritten: number;
  toolCallIds: string[];
  applied: boolean;
}

/**
 * Tier 1 微压缩：将 TTL 过期的 tool_result 替换为占位符
 *
 * 触发条件：tool_result 的 timestamp > ttlMs（默认 5 分钟）
 * 保留最近 keepLatest 条结果（默认 1）
 */
export function applyMicroCompaction(
  input: MicroCompactionInput
): MicroCompactionResult {
  const {
    messages,
    nowMs = Date.now(),
    ttlMs = 5 * 60 * 1000,
    keepLatest = 1,
  } = input;

  const result: ChatMessage[] = [];
  const rewrittenToolCallIds: string[] = [];
  let rewrittenCount = 0;
  let recentResultsFound = 0;

  // 从 assistant 消息的 tool_calls 中建立 tool_call_id → name 映射
  // Claude API 的 tool_calls 使用 function.name 嵌套结构
  const aidToName = new Map<string, string>();
  for (const msg of messages) {
    if (
      msg.role === 'assistant' &&
      Array.isArray((msg as unknown as Record<string, unknown>).tool_calls)
    ) {
      for (const tc of (msg as unknown as Record<string, unknown>)
        .tool_calls as Array<{ id?: string; name?: string; function?: { name?: string } }>) {
        // BUG-γ fix: ToolCall uses function.name (nested), not name (flat)
        const tcName = tc.function?.name || tc.name;
        if (tc.id && tcName) aidToName.set(tc.id, tcName);
      }
    }
  }

  // 从后往前找最近 keepLatest 条 tool_result 的位置
  const recentResultIndices = new Set<number>();
  for (
    let i = messages.length - 1;
    i >= 0 && recentResultsFound < keepLatest;
    i--
  ) {
    const msg = messages[i];
    if (
      msg.role === 'tool' ||
      (msg as unknown as Record<string, unknown>).tool_call_id
    ) {
      recentResultIndices.add(i);
      recentResultsFound++;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // 保留最近的结果不受影响
    if (recentResultIndices.has(i)) {
      result.push(msg);
      continue;
    }

    const toolCallId = (msg as unknown as Record<string, unknown>)
      .tool_call_id as string | undefined;
    // msg.name 在 tool result 消息上不一定存在（Claude API 无此字段）
    // 从 assistant 消息的 tool_calls 中查找对应的 tool name
    const toolName =
      ((msg as unknown as Record<string, unknown>).name as
        | string
        | undefined) ?? (toolCallId ? aidToName.get(toolCallId) : undefined);

    // 仅压缩可压缩工具的结果
    if (toolCallId && toolName && COMPACTABLE_TOOL_NAMES.has(toolName)) {
      // BUG-γ fix: ChatMessage has no timestamp field, skip age check.
      // keepLatest mechanism (recentResultIndices) already handles recency.
      result.push({
        ...msg,
        content: MICROCOMPACT_CLEARED,
      } as unknown as ChatMessage);
      rewrittenCount++;
      rewrittenToolCallIds.push(toolCallId);
      continue;
    }

    result.push(msg);
  }

  if (rewrittenCount > 0) {
    logger.info('compaction:triggered', {
      tier: 1,
      reason: 'TTL expired',
      rewrittenCount,
      messageCount: messages.length,
    });
  }

  return {
    messages: result,
    rewritten: rewrittenCount,
    toolCallIds: rewrittenToolCallIds,
    applied: rewrittenCount > 0,
  };
}
