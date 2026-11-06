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

import type { LiriEvent } from '@modules/session/types/events';
// 2026-11-06（审批根因簇 P0-1）：判据下沉 infra 契约层（query / chat 共用，避免第二份实现）
import { isAwaitingApprovalPayload } from '@openliri/infra/utils/toolContract';

export interface PendingToolCall {
  toolCallId: string;
  name: string;
  args: unknown;
  messageId?: string;
}

/**
 * 从已落盘消息中提取「等待审批」的 tool_call id（2026-11-06，审批根因簇 P0-1）。
 *
 * 为什么需要：`awaiting_approval` 的 tool/result 会被记为该调用的**终态**，
 * 但批准后必须**重放**它（放行缓存已写入）。`resumeStream` 据此把这类调用
 * 从 `completedToolCallIds` 里"捞回来"，否则日志只会打印
 * 「resumeStream: 所有工具已完成，无需恢复」（真机 `session_mw458fpp3ea32a050e`）。
 *
 * tool 消息的 call id 有两个来源：顶层 `toolCallId`（内存态）与
 * `content[].toolCallId`（落盘态，见 `messages.jsonl`）——两者都兼容。
 */
export function extractAwaitingApprovalToolCallIds(
  messages: ReadonlyArray<{
    role?: string;
    content?: unknown;
    toolCallId?: string;
  }>
): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const rawBlocks = m.content;
    const blocks: Array<{
      type?: string;
      value?: unknown;
      toolCallId?: string;
    }> = Array.isArray(rawBlocks)
      ? (rawBlocks as Array<{
          type?: string;
          value?: unknown;
          toolCallId?: string;
        }>)
      : typeof rawBlocks === 'string'
        ? [{ type: 'tool_result', value: rawBlocks, toolCallId: m.toolCallId }]
        : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue;
      const id = block.toolCallId ?? m.toolCallId;
      if (typeof id !== 'string' || !id) continue;
      if (isAwaitingApprovalPayload(block.value)) ids.add(id);
    }
  }
  return ids;
}

export function extractPendingToolCallsFromEvents(events: LiriEvent[]): {
  pending: PendingToolCall[];
  answered: Set<string>;
} {
  const answered = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'tool/result' || ev.type === 'tool/canceled') {
      const d = ev.data as { toolCallId?: string; result?: unknown };
      if (!d.toolCallId) continue;
      // 2026-11-06（审批根因簇 P0-1）：`awaiting_approval` **不算已答**——
      // 它只是"审批卡已提交"，批准后必须重放。原实现把所有 tool/result 一律记已答
      // ⇒ events 重建路径的 pending 为空 ⇒ 批准后无任何可执行项。
      if (ev.type === 'tool/result' && isAwaitingApprovalPayload(d.result)) {
        continue;
      }
      answered.add(d.toolCallId);
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
