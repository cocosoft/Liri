// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 工具轮「写入顺序」保证：落 `tool` 结果**之前**先落归属 assistant（2026-11-20）
 *
 * **背景（真机取证）**：会话 `session_mwo45wcx9413d7b331` 的 `messages.jsonl` 行顺序为
 * `tool, tool → assistant` —— 声明这些调用的 assistant 延后到 `finalize` 才写。
 * `ChatCompletionsTransport.convertMessages` 按**顺序**配对（`tool` 必须紧跟其声明），
 * 于是这些结果即便声明最终存在也被判孤儿剥离（真机 `stripped_orphan_tool_results count=8`）
 * ⇒ 模型看不到工具输出。
 *
 * **处置**：每次进 `act`（本轮工具调用已确定、声明已并入消息 metadata）时，先让归属
 * assistant 落盘并**显式等待完成**，再执行/落盘工具结果。行顺序因此恢复为
 * `assistant(声明) → tool…`。
 *
 * **事件去重**：流式主链的 `assistant/tool_call` 已在 `tool_start` 实时写入
 * （`streamMessageToolLoop` P0-fix-4），落盘前打 `__toolCallsWritten`（N-6 同口径）避免
 * 重复写；正文是否补写仍由事件层事实（`hasStreamedTextForMessage`）判定，不额外打标记。
 *
 * **只落一次**：逐轮 `reason` 复用同一 assistant 消息（id 不变）⇒ 首次落盘后记 id，
 * 后续轮次跳过；`finalize` 仍按最终态再落一次（同 id 整行追加由存储侧 compact 折叠）。
 *
 * 外移原因：`ReActToolLoop.ts` 逼近 R04-001 单文件 2000 行上限（同 `agentReasonAttribution`
 * / `eventSnapshotStale` 的手法）。
 */

import type { Message } from '@modules/session/types/message.js';
import type { ToolLoopContext } from './ToolLoopRunner.js';

/**
 * 落归属 assistant（若尚未为"行顺序"落过）并等待其持久化完成。
 *
 * @param ctx 工具轮上下文（用其 `session.id` / `addAndPersistMessage` / `flushPendingPersists`）
 * @param assistantMessage 本轮归属 assistant（`null` ⇒ 无需处理，直接返回）
 * @param alreadyFlushedId 已为行顺序落过的消息 id（`null` ⇒ 尚未落过）
 * @returns 处理后的"已落盘消息 id"（供调用方回写状态）
 */
export async function persistAssistantBeforeToolResults(
  ctx: ToolLoopContext,
  assistantMessage: Message | null,
  alreadyFlushedId: string | null
): Promise<string | null> {
  if (!assistantMessage) return alreadyFlushedId;
  if (alreadyFlushedId === assistantMessage.id) return alreadyFlushedId;

  assistantMessage.metadata = {
    ...(assistantMessage.metadata ?? {}),
    __toolCallsWritten: true,
  };
  ctx.addAndPersistMessage(ctx.session.id, assistantMessage);
  // addAndPersistMessage 为 fire-and-forget ⇒ 显式等待，保证 tool 结果入队时它已落盘
  await ctx.flushPendingPersists?.();
  return assistantMessage.id;
}
