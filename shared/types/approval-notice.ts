/**
 * 审批等待收尾提示（**双端共用的单一文案来源**，2026-11-12）
 *
 * 服务端在「工具已提交审批、本回合主动收尾」时把这段提示写进助手消息正文
 *（`app/src/chat/terminationOutput.ts` 的 `AWAITING_APPROVAL_NOTICE` 即本常量的再导出）；
 * 前端在**渲染时**把它从正文里剥掉，改由审批卡片就地提示"批准后自动继续"。
 *
 * 为什么要剥：审批处理完（批准/拒绝）后，正文里那句「⏸ 有工具调用正在等待你的审批…」
 * 会永久留在气泡里，与实际状态（已处理）矛盾（真机 `session_mwd7ywosc43b5503e3`）。
 * 剥离判据走**结构化字段**（消息 `metadata.terminationReason/finishReason === 'awaiting_approval'`），
 * 不按任意文案猜状态（CS02）。
 */
export const AWAITING_APPROVAL_NOTICE =
  '⏸ 有工具调用正在等待你的审批：请在下方审批卡片（或收件箱）中处理后继续；' +
  '批准后会自动接着执行，无需重发消息。';

/**
 * 从助手消息正文尾部剥掉审批等待提示（只剥**尾部**且需完整命中，正文其余内容原样保留）。
 *
 * @param content 助手消息正文（可能是空串）
 * @returns 剥离后的正文；未命中 ⇒ 原样返回（返回同一字符串，便于调用方判等）
 */
export function stripAwaitingApprovalNotice(content: string): string {
  const trimmed = content.trimEnd();
  if (!trimmed.endsWith(AWAITING_APPROVAL_NOTICE)) return content;
  return trimmed
    .slice(0, trimmed.length - AWAITING_APPROVAL_NOTICE.length)
    .trimEnd();
}

/**
 * 「等待审批」的 `finishReason` 取值 —— **双端唯一命名来源**（2026-11-24 上移到 shared，
 * 供服务端读路径清理陈旧标记；app 侧再导出保持既有调用点不变）。
 */
export const AWAITING_APPROVAL_FINISH_REASON = 'awaiting_approval' as const;

/** 清理「等待审批收尾」标记所需的最小消息形状 */
export interface ApprovalTurnMarkerMessage {
  content?: unknown;
  blocks?: unknown;
  finishReason?: unknown;
  terminationReason?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * 2026-11-24：清除消息上的 `awaiting_approval` 收尾标记与提示文案（纯函数）。
 *
 * 两类场景共用：
 *  ① 批准后的**续跑开始**（`app/src/chat/manager/streamResume.ts`）—— 旧标记会让会话
 *     一直被写回 `requires_action`、前端末条兜底判成「等待审批」；
 *  ② 服务端**读消息**时（`packages/service/.../sessionMessagesRead.ts`）—— 会话已无
 *     待审批项，但投影里的末条助手仍带标记（审批已处理/过期、回合被中止）⇒ 前端永久
 *     「待审批」（真机 `session_mwpj4amge75a67ec4f`，重启后仍在）。
 *
 * 只动 `awaiting_approval` 这一个取值（CS02：结构化字段判定，不比对文案片段）。
 */
export function clearAwaitingApprovalTurnMarkers<
  T extends ApprovalTurnMarkerMessage,
>(message: T): { message: T; changed: boolean } {
  const next: ApprovalTurnMarkerMessage = { ...message };
  let changed = false;

  if (next.finishReason === AWAITING_APPROVAL_FINISH_REASON) {
    delete next.finishReason;
    changed = true;
  }
  if (next.terminationReason === AWAITING_APPROVAL_FINISH_REASON) {
    delete next.terminationReason;
    changed = true;
  }

  const meta = next.metadata;
  if (
    meta &&
    (meta.finishReason === AWAITING_APPROVAL_FINISH_REASON ||
      meta.terminationReason === AWAITING_APPROVAL_FINISH_REASON)
  ) {
    const rest = { ...meta };
    delete rest.finishReason;
    delete rest.terminationReason;
    next.metadata = rest;
    changed = true;
  }

  if (typeof next.content === 'string') {
    const stripped = stripAwaitingApprovalNotice(next.content);
    if (stripped !== next.content) {
      next.content = stripped;
      changed = true;
    }
  }

  if (Array.isArray(next.blocks)) {
    let blocksChanged = false;
    const blocks = (
      next.blocks as Array<{ type?: unknown; content?: unknown }>
    ).map((block) => {
      if (block?.type !== 'text' || typeof block.content !== 'string') {
        return block;
      }
      const stripped = stripAwaitingApprovalNotice(block.content);
      if (stripped === block.content) return block;
      blocksChanged = true;
      return { ...block, content: stripped };
    });
    if (blocksChanged) {
      next.blocks = blocks;
      changed = true;
    }
  }

  return { message: next as T, changed };
}
