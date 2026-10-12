// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F1（债二-预算挂起续跑 §Task 1）— 从 `ChatMessage[]` 尾部重建「未完成工具」（纯函数）
 *
 * 供 `TAORLoop.saveCheckpoint` 在落盘检查点时填充 `pendingToolCalls`；
 * 此前该字段恒为 `undefined`，导致恢复侧 `reExecuteTools` 永远为 false（永不重跑未完成工具）。
 *
 * 判据对齐事件版 `chat/utils/pendingToolCalls.ts`（`extractPendingToolCallsFromEvents`）：
 *   - answered：已有 `role === 'tool'` 消息（带 `tool_call_id`）应答的工具（已答项不重复执行）
 *   - 从消息尾部向前扫 assistant 的 `tool_calls`，遇 `role === 'user'` 停止（新对话边界）
 *   - 返回未答工具列表（`arguments` 为 JSON 字符串，解析失败则保留原串）
 */

import type { ChatMessage } from '@modules/ai/models/types.js';

export interface PendingToolCallRef {
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function extractPendingToolCallsFromMessages(
  messages: readonly ChatMessage[]
): PendingToolCallRef[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) {
      answered.add(m.tool_call_id);
    }
  }

  const pending: PendingToolCallRef[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (!answered.has(tc.id)) {
          pending.push({
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: parseToolArgs(tc.function.arguments),
          });
        }
      }
    }
  }
  return pending;
}
