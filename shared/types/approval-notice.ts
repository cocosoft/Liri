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
  return trimmed.slice(0, trimmed.length - AWAITING_APPROVAL_NOTICE.length).trimEnd();
}
