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
