/**
 * Inbox 卡片块的**字段回填**（P0-1，2026-11-04；P3-1，2026-11-06）
 *
 * 背景：审批卡去重后，被合并的请求只体现为既有卡上的 `metadata.dedupCount`；
 * 会话内的卡片是**提交时注入的静态块**，必须把新的计数写回该块才能显示 `×N`。
 *
 * P3-1：审批终态（replied / expired）同样只在 `inbox_items` 里 ⇒ 读消息时的合成窗口
 * 一过卡片就再也回不来（历史里"有文字没卡片"）。终态也必须写回块才能全历史可追溯。
 *
 * 纯函数、无 I/O：只做"找到该 inboxId 的块并改字段"。
 */

/** 卡片块的最小形态（`FrontendMessageBlock` 的子集，避免 runtime → 前端类型耦合） */
export interface InboxBlockLike {
  type?: string;
  inboxData?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 把 `dedupCount` 写进目标 Inbox 块。
 *
 * @returns `blocks` 新数组（未命中 ⇒ 原元素原样保留）；`changed` 是否真的改动
 *          （计数相同也算未改动 ⇒ 调用方据此跳过写盘）
 */
export function patchInboxBlockDedupCount<T extends InboxBlockLike>(
  blocks: readonly T[],
  inboxId: string,
  dedupCount: number
): { blocks: T[]; changed: boolean } {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== 'inbox') return block;
    const data = block.inboxData;
    if (!data || data.inboxId !== inboxId) return block;
    if (data.dedupCount === dedupCount) return block;
    changed = true;
    return { ...block, inboxData: { ...data, dedupCount } };
  });
  return { blocks: next, changed };
}

/**
 * 把审批**终态**（`pending` / `replied` / `expired`）写进目标 Inbox 块。
 *
 * 与 {@link patchInboxBlockDedupCount} 同型：只改命中块的 `inboxData.status`，
 * 其余字段（`dedupCount` / `actions` / `channelSource` …）原样保留。
 * `status` 相同 ⇒ `changed=false`（调用方据此跳过写盘）。
 */
export function patchInboxBlockStatus<T extends InboxBlockLike>(
  blocks: readonly T[],
  inboxId: string,
  status: string
): { blocks: T[]; changed: boolean } {
  let changed = false;
  const next = blocks.map((block) => {
    if (block.type !== 'inbox') return block;
    const data = block.inboxData;
    if (!data || data.inboxId !== inboxId) return block;
    if (data.status === status) return block;
    changed = true;
    return { ...block, inboxData: { ...data, status } };
  });
  return { blocks: next, changed };
}
