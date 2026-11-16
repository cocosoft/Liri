// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * awaitingApprovalNotice —— 非流式（TAOR）路径的「等待审批」提示**唯一写入口**。
 *
 * **真机问题**（`session_mwgj38hv0f7434c756`，2026-11-15）：会话记录 90 条中有 **79 条**是同一句
 * 「⏸ 有工具调用正在等待你的审批…」。原因是原判据只看**末条 assistant** 的
 * `metadata.finishReason === 'awaiting_approval'`：
 * 用户每批准一次 ⇒ TAOR 续跑先落一条**新的** assistant(tool_calls)（无 finishReason）
 * ⇒ 判据失效 ⇒ 再写一条提示，如此循环。
 *
 * **本模块的判据**（与流式路径 `terminationOutput.suppressDuplicateApprovalNotice` 同源结论、
 * 但适配 TAOR 的消息形状）：从末尾向前扫**本轮**消息，
 * - 遇到 `user` ⇒ 新一轮提问，提示必须写；
 * - 遇到 `assistant` 且（`finishReason === 'awaiting_approval'` 或正文以同一提示结尾）⇒ 已有提示，跳过；
 * - 其余 assistant / tool（本轮工具轮产物）⇒ 继续向前扫；
 * - 扫描上限 `MAX_SCAN`，防止长会话下无界回溯。
 *
 * **不改变**：`metadata.finishReason` 的落盘语义、提示文案（与流式同源常量）、审批卡片数量。
 */
import { AWAITING_APPROVAL_NOTICE } from '@shared/types';
import type { Message } from '@modules/session/types/message.js';
import { AWAITING_APPROVAL_FINISH_REASON } from '../terminationOutput.js';

/** 向前扫描的消息上限（本轮 + 若干工具轮足够；避免长会话无界回溯） */
const MAX_SCAN = 50;

/** 判定所需的最小消息形状 */
export interface NoticeScanMessage {
  id?: string;
  role?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * 本轮是否**已经**写过「等待审批」提示。
 *
 * @param messages 会话消息（按时间顺序）
 * @param currentId 正在收尾的消息 id（跳过它自身；可选）
 */
export function hasPriorApprovalNoticeThisTurn(
  messages: ReadonlyArray<NoticeScanMessage> | undefined,
  currentId?: string
): boolean {
  if (!messages) return false;
  const start = Math.max(0, messages.length - MAX_SCAN);
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    if (currentId && m.id === currentId) continue;
    if (m.role === 'user') return false;
    if (m.role !== 'assistant') continue;
    if (m.metadata?.finishReason === AWAITING_APPROVAL_FINISH_REASON)
      return true;
    const content = typeof m.content === 'string' ? m.content : '';
    if (content.trimEnd().endsWith(AWAITING_APPROVAL_NOTICE)) return true;
  }
  return false;
}

export interface EnsureApprovalNoticeDeps {
  /** 会话当前消息（按时间顺序） */
  messages: ReadonlyArray<NoticeScanMessage> | undefined;
  sessionId: string;
  /** 正在收尾的消息 id（若有）——避免把自身计入「已有提示」 */
  currentId?: string;
  createAssistantMessage: (
    content: string,
    options: { sessionId: string }
  ) => Message;
  addAndPersistMessage: (sessionId: string, message: Message) => void;
}

/**
 * 需要时写入一条「等待审批」提示。
 *
 * @returns 写入的提示消息；`undefined` 表示本轮已有同提示（已抑制）
 */
export function ensureAwaitingApprovalNotice(
  deps: EnsureApprovalNoticeDeps
): Message | undefined {
  if (hasPriorApprovalNoticeThisTurn(deps.messages, deps.currentId)) {
    return undefined;
  }
  const noticeMsg = deps.createAssistantMessage(AWAITING_APPROVAL_NOTICE, {
    sessionId: deps.sessionId,
  });
  noticeMsg.metadata = {
    ...(noticeMsg.metadata ?? {}),
    finishReason: AWAITING_APPROVAL_FINISH_REASON,
  };
  deps.addAndPersistMessage(deps.sessionId, noticeMsg);
  return noticeMsg;
}
