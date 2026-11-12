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
 * tool 消息的 call id 有三个来源：顶层 `toolCallId`（内存态）、
 * `content[].toolCallId`（事件派生消息）与 `metadata.toolCallId`（**messages.jsonl 落盘态**：
 * 真机 `session_mwd5mp8jd5fe8bce9c` 的 tool 消息顶层无此字段，只有 metadata）——三者都兼容。
 * 漏掉 metadata 形态 ⇒ `awaitingApprovalIds` 为空 ⇒ 续跑把未落定的调用当"普通剩余工具"重放
 * （再次提交同一张卡、再写一条 awaiting_approval ⇒ 重复审批卡）。
 */
export function extractAwaitingApprovalToolCallIds(
  messages: ReadonlyArray<{
    role?: string;
    content?: unknown;
    toolCallId?: string;
    metadata?: { toolCallId?: unknown } | undefined;
  }>
): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const metaId = m.metadata?.toolCallId;
    const messageCallId =
      m.toolCallId ?? (typeof metaId === 'string' ? metaId : undefined);
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
        ? [{ type: 'tool_result', value: rawBlocks, toolCallId: messageCallId }]
        : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue;
      const id = block.toolCallId ?? messageCallId;
      if (typeof id !== 'string' || !id) continue;
      if (isAwaitingApprovalPayload(block.value)) ids.add(id);
    }
  }
  return ids;
}

/**
 * 2026-11-12（真机 `session_mwcyhmmpd44e93b602` / `session_mwd5mp8jd5fe8bce9c`）：
 * 本次续跑**是否重放**这批剩余调用。
 *
 * 背景：`awaiting_approval` 的 tool/result 不算终态（批准后必须重放），但重放的前提是
 * **审批已落定**。此前任何一次续跑（含 `resumeCoalescer` 的"补跑一波"）都无条件重放 ⇒
 * 审批卡还没处理就再执行一次 ⇒ 又走 `submitToolApproval`（同指纹复用同一 Inbox 项）⇒
 * 同一 toolCallId 写下**第二条** `awaiting_approval` tool/result（新 messageId）⇒ 前端多出
 * 重复审批卡（events 实证：seq 865 → 869、878 → 882 同 id 重复）。
 *
 * 口径（只修"全都被卡住"这一种，混合场景保持原行为）：
 *   - 剩余调用**全部**被待审批卡挡住 ⇒ 本次空转（`replay: []`），卡片留着等用户处理；
 *   - 否则**原样全量重放**。混合场景（一部分已批准、一部分仍待批）刻意不改：已落定调用执行后
 *     会推进出新的 assistant 轮次，未落定调用若被跳过就失去"最后一条含 tool_calls 的消息"
 *     这一重放锚点 ⇒ 之后批准也不会执行。宁可在该窄场景保留既有的重提卡行为。
 *
 * @param candidates 已按"未完成 或 等待审批"筛过的声明调用
 * @param blockedIds 仍被未处理审批卡挡住的 toolCallId（宿主判定，见 `isAwaitingUserApproval`）
 * @returns `replay` = 本次要重放的调用；`skippedPendingCount` = 被跳过的等待审批数
 */
export function planToolReplay<T extends { id: string }>(
  candidates: readonly T[],
  blockedIds: ReadonlySet<string>
): { replay: T[]; skippedPendingCount: number } {
  const blocked = candidates.filter((tc) => blockedIds.has(tc.id));
  if (blocked.length === candidates.length) {
    return { replay: [], skippedPendingCount: blocked.length };
  }
  return { replay: [...candidates], skippedPendingCount: 0 };
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
