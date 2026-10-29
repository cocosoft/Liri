// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepExecution — 计划步骤的"单步提示"执行（issue #19 · Cut H，2026-10-29）
 *
 * 迁出来源：`ChatManager.executeStepPrompt`（原 20 行）。它本身**不含 LLM/工具循环**，
 * 只是把步骤提示委托给统一入口 `sendMessage`（批次 4.3 起即如此）⇒ 外移为纯函数，
 * 宿主只注入 `sendMessage` 端口。
 *
 * 行为不变：`_fromInternal: true` / `_fromInternalSource: 'executeStepPrompt'` 逐字保留
 * （埋点据此不计入 Buddy 用户对话轮数），日志口径与模块名不变。
 */

import { getLogger } from '@modules/monitoring';
import type { ChatSession } from '@modules/session/types/session';
import type {
  Message,
  SendMessageOptions,
} from '@modules/session/types/message';

const logger = getLogger('chat:manager');

/** 统一消息入口（宿主 `ChatManager.sendMessage`） */
export type SendMessageFn = (
  content: string,
  options?: SendMessageOptions
) => Promise<Message>;

/**
 * 执行单步提示（委托给 `sendMessage`，统一路径，批次 4.3）
 * 不再维护独立的 LLM 调用 + 工具执行循环。
 */
export async function executeStepPrompt(
  sendMessage: SendMessageFn,
  prompt: string,
  session: ChatSession,
  options?: SendMessageOptions
): Promise<void> {
  // 委托给 sendMessage，复用统一的 LLM 调用 + 工具循环（含 TAORLoop 支持）
  // 计划步骤内通常不触发 ask_user_question 等交互工具，
  // 若触发则 sendMessage 的 pendingInteraction 机制会保存状态并提前返回。
  // 验证日志：确认内部调用标记 _fromInternal 已传入（埋点据此不计入 Buddy 用户对话轮数）
  logger.info('executeStepPrompt 内部调用 sendMessage', {
    sessionId: session.id,
    _fromInternal: true,
  });
  await sendMessage(prompt, {
    ...options,
    sessionId: session.id,
    _fromInternal: true, // 计划步骤为系统内部调用：不计入 Buddy 用户对话轮数
    _fromInternalSource: 'executeStepPrompt',
  });
}
