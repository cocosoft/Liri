/**
 * 审批块选择（P3-1，2026-11-06）
 *
 * 真机缺陷（`session_mw458fpp3ea32a050e`）：`_attachPendingApprovalBlocks` 只合成
 * `status='pending'` 的审批项 ⇒ 卡片一旦被批准/过期，下次读消息就**整块消失**，
 * 而助手消息里"请在审批卡中批准"的文字仍在 ⇒ 用户看到"有文字没卡片"，
 * 以为卡片从未出现（用户原话：「没看到命令审批卡啊」）。
 *
 * 现口径：`pending` 全量 + **同一回合窗口内已处理/已过期**的项一并合成，
 * 让历史消息能显示「✅ 已处理 / ⏰ 已过期」的状态（前端 `InboxBlock` 已支持三态）。
 *
 * 窗口口径：以最后一条 assistant 消息时间为锚，向前 `lookbackMs`（默认 2h）——
 * 长回合（真机 33 分钟）内的全部卡片都能覆盖，又不会把很久以前的卡片反复挂到最新消息。
 * 纯函数、无 I/O，便于单测。
 */

import { patchInboxBlockStatus, type InboxBlockLike } from '../inboxBlockPatch';

/** 已处理/已过期审批的合成窗口（相对最后一条 assistant 消息） */
export const APPROVAL_BLOCK_LOOKBACK_MS = 2 * 60 * 60 * 1000;
/** 单次最多合成多少个已处理项（防历史噪声） */
export const APPROVAL_BLOCK_MAX_RESOLVED = 20;

/** 选择所需的字段（结构化最小面，避免依赖 InboxItem 的完整实现） */
export interface ApprovalBlockItemShape {
  id: string;
  status: string;
  createdAt: number;
}

/**
 * 选出应合成到消息 blocks 的审批项：pending 全量 + 窗口内 resolved，
 * 按 `createdAt` 升序（与创建顺序一致），并去重。
 */
export function selectApprovalItemsForBlocks<T extends ApprovalBlockItemShape>(params: {
  pending: readonly T[];
  /** 该会话的审批项（建议按 createdAt 倒序传入；本函数会自行排序） */
  recent: readonly T[];
  /** 锚点时间（通常 = 最后一条 assistant 消息时间） */
  anchorMs: number;
  lookbackMs?: number;
  maxResolved?: number;
}): T[] {
  const lookback = params.lookbackMs ?? APPROVAL_BLOCK_LOOKBACK_MS;
  const maxResolved = params.maxResolved ?? APPROVAL_BLOCK_MAX_RESOLVED;
  const since = params.anchorMs - lookback;

  const byId = new Map<string, T>();
  for (const item of params.pending) byId.set(item.id, item);

  const resolved = params.recent
    .filter(
      (item) =>
        // 只取前端三态里可展示的两种终态（`processing`/`dismissed` 不合成）
        (item.status === 'replied' || item.status === 'expired') &&
        item.createdAt >= since
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, maxResolved);
  for (const item of resolved) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

/** 参与就地刷新的最小消息形态（只有 `blocks` 会被读到/改写） */
export interface ApprovalBlockMessageLike {
  blocks?: unknown;
}

/** 审批块宿主选择用的最小消息形态 */
export interface ApprovalHostMessageLike {
  role?: string;
  timestamp?: number;
  blocks?: unknown;
}

/** 审批块归属判据 */
export interface ApprovalHostTarget {
  /** 审批项创建时刻（毫秒）—— 无 `toolCallId` 时的兜底判据 */
  createdAt: number;
  /** 该审批项对应的工具调用 id（`inbox_items.metadata.toolCallId`），有则**精确**归位 */
  toolCallId?: string;
}

/**
 * 2026-11-12：缺失审批块应挂到**哪一条 assistant 消息**（返回下标；`-1` = 无宿主）。
 *
 * 真机 `session_mwd9bnoyc7e3051cde`：所有缺失项一律追加到最后一条 assistant ⇒ 第 1 轮的
 * bash 审批卡渲染在第 2 轮末尾（刷新回放错位，「已处理」卡跑到别轮）。
 *
 * 判据优先级：
 *  1. **结构化**：`toolCallId` 命中某条消息里的 `tool_call` 块 ⇒ 就是这条消息（卡片与其调用同处）；
 *  2. **时间锚点**（无 `toolCallId` 的老卡）：取「创建时刻之前最近的 assistant 消息」；
 *     全部晚于该时刻（时钟偏差）⇒ 回退第一条 assistant。
 */
export function resolveApprovalHostIndex<M extends ApprovalHostMessageLike>(
  messages: readonly M[],
  target: ApprovalHostTarget
): number {
  if (target.toolCallId) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messageHasToolCall(messages[i], target.toolCallId)) return i;
    }
  }

  let firstAssistant = -1;
  let best = -1;
  let bestTs = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (firstAssistant < 0) firstAssistant = i;
    const ts = typeof m.timestamp === 'number' ? m.timestamp : 0;
    if (ts <= target.createdAt && ts >= bestTs) {
      bestTs = ts;
      best = i;
    }
  }
  return best >= 0 ? best : firstAssistant;
}

/** 该消息的 `blocks[]` 里是否有 id 命中 `toolCallId` 的 `tool_call` 块 */
function messageHasToolCall(
  message: ApprovalHostMessageLike,
  toolCallId: string
): boolean {
  const blocks = message.blocks;
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => {
    const block = b as {
      type?: unknown;
      toolCallId?: unknown;
      toolCall?: { id?: unknown };
    };
    if (block?.type !== 'tool_call') return false;
    return (block.toolCallId ?? block.toolCall?.id) === toolCallId;
  });
}

/**
 * P3-1（2026-11-06）：审批终态已写回**原位置**的卡片块 ⇒ 读时只就地刷新状态，
 * 不再把卡片重复合成到最后一条消息；只有从未落过块的项才需要调用方补合成。
 *
 * @returns `missing` 尚未落块的审批项 id（调用方据此补合成）；
 *          `updatedMessages` 实际被改写 messages 数（仅内存，不写盘）
 */
export function refreshPresentApprovalBlocks<
  M extends ApprovalBlockMessageLike,
>(
  messages: readonly M[],
  selected: ReadonlyArray<{ id: string; status: string }>
): { missing: string[]; updatedMessages: number } {
  const present = new Set<string>();
  for (const msg of messages) {
    if (!Array.isArray(msg.blocks)) continue;
    for (const block of msg.blocks as InboxBlockLike[]) {
      const inboxId = block?.inboxData?.inboxId;
      if (block?.type === 'inbox' && typeof inboxId === 'string') {
        present.add(inboxId);
      }
    }
  }

  let updatedMessages = 0;
  for (const msg of messages) {
    if (!Array.isArray(msg.blocks)) continue;
    let blocks = msg.blocks as InboxBlockLike[];
    let changed = false;
    for (const item of selected) {
      if (!present.has(item.id)) continue;
      const patched = patchInboxBlockStatus(blocks, item.id, item.status);
      if (!patched.changed) continue;
      blocks = patched.blocks;
      changed = true;
    }
    if (!changed) continue;
    msg.blocks = blocks;
    updatedMessages++;
  }

  return {
    missing: selected.filter((i) => !present.has(i.id)).map((i) => i.id),
    updatedMessages,
  };
}
