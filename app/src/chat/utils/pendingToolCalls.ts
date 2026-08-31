// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * M2-T2.1 — events 尾部重建：识别未完成 turn 的未答工具（纯函数，独立模块便于单测）
 *
 * 对齐 openworker `_unanswered_trailing_tool_calls` 语义：
 *   - answered：已有 tool/result 或 tool/canceled 终态的工具（已答项不重复执行）
 *   - 从事件尾部向前扫 assistant/tool_call，遇 user/message 停止（新对话边界）
 *   - 返回未答工具列表 + answered 集合
 *
 * 供 ChatManager._rebuildTrailingTurnFromEvents（审批续跑 events 重建路径）使用。
 */

import type { LiriEvent } from '@modules/chat/types/events';

export interface PendingToolCall {
  toolCallId: string;
  name: string;
  args: unknown;
  messageId?: string;
}

export function extractPendingToolCallsFromEvents(events: LiriEvent[]): {
  pending: PendingToolCall[];
  answered: Set<string>;
} {
  const answered = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'tool/result' || ev.type === 'tool/canceled') {
      const d = ev.data as { toolCallId?: string };
      if (d.toolCallId) answered.add(d.toolCallId);
    }
  }

  const pending: PendingToolCall[] = [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'user/message') break;
    if (ev.type === 'assistant/tool_call') {
      const d = ev.data as {
        toolCallId?: string;
        name?: string;
        args?: unknown;
        messageId?: string;
      };
      if (d.toolCallId && !answered.has(d.toolCallId)) {
        pending.push({
          toolCallId: d.toolCallId,
          name: d.name ?? '',
          args: d.args,
          messageId: d.messageId,
        });
      }
    }
  }
  return { pending, answered };
}
