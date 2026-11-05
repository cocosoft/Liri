/**
 * Inbox 卡片块的**合并次数回填**（P0-1，2026-11-04）
 *
 * 背景：审批卡去重后，被合并的请求只体现为既有卡上的 `metadata.dedupCount`；
 * 会话内的卡片是**提交时注入的静态块**，必须把新的计数写回该块才能显示 `×N`。
 *
 * 纯函数、无 I/O：只做"找到该 inboxId 的块并改 `inboxData.dedupCount`"。
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
