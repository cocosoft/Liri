// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 消息配对清理与工具历史压缩（2026-11-18，从 `MessageContextPipeline` 外移）
//
// 拆分缘由：`MessageContextPipeline.ts` 承担 7 项职责（spec `file-size-debt-partition-plan.md` §48 A 类）。
// 本模块只保留「让 apiMessages 合法」这一件事 —— 配对修复与工具历史压缩，均为**原地/纯**操作，
// 不读写会话元数据，也不组装系统提示。对外符号与实现逐字搬迁，行为不变。

import { sanitizePass } from '../ChatHelper';
import { toolResultRegistry } from '@modules/tool/ToolResultRegistry.js';

/**
 * API 消息清理：修复 tool/tool_calls 配对完整性
 *
 * 此方法从后往前遍历所有 assistant 含 tool_calls，
 * 逐条检查紧随其后的 tool 消息是否全部响应。
 */
export function sanitizeApiMessages(
  apiMessages: Record<string, unknown>[]
): void {
  // 第一轮清理：移除 tool 响应不完整的 assistant
  sanitizePass(apiMessages);

  // 收集所有已知 tool_call_id（用于判定孤儿 tool——与中间清理共用）
  const knownToolCallIds = new Set<string>();
  for (let i = 0; i < apiMessages.length; i++) {
    const msg = apiMessages[i];
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<{ id?: string }>) {
        if (tc.id) knownToolCallIds.add(tc.id);
      }
    }
  }

  // 末尾孤立 tool 消息（没有 preceding assistant 含 tool_calls）。
  // 2026-09-02 修复：原实现无条件 pop 末尾所有 tool 消息——[assistant(tool_calls),
  // tool(result)] 有效配对被误删（末尾 T1 被 pop → sanitizePass 再将失去配对的 A1
  // 删除）。工具轮每轮 reason 前（ReActToolLoop.beforeReasoning）调用本函数，导致
  // 工具结果每轮被清空 → 模型永远看不到工具结果 → 重复调用同一工具死循环
  // （实测 session_mtjjw6bmwj652x6dtm：_buildToolRoundMessages currentMessages 恒为 3）。
  // 仅当末尾 tool 无匹配 assistant 时移除。
  let removedInCleanup = false;
  const lenBeforePop = apiMessages.length;
  while (
    apiMessages.length > 0 &&
    apiMessages[apiMessages.length - 1].role === 'tool'
  ) {
    const last = apiMessages[apiMessages.length - 1] as {
      tool_call_id?: string;
    };
    if (last.tool_call_id && knownToolCallIds.has(last.tool_call_id)) break;
    apiMessages.pop();
    removedInCleanup = true;
  }
  if (apiMessages.length < lenBeforePop) removedInCleanup = true;

  // 中间孤立 tool 消息清理：
  // 先正向扫描收集所有已知 tool_call_id，再反向移除孤儿 tool 消息
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === 'tool') {
      const tcId = apiMessages[i].tool_call_id as string | undefined;
      if (!tcId || !knownToolCallIds.has(tcId)) {
        apiMessages.splice(i, 1);
        removedInCleanup = true;
      }
    }
  }

  // 仅在清理步骤实际移除了消息时才执行再清理
  // （移除 tool 消息可能导致对应的 assistant 变为孤立）
  if (removedInCleanup) {
    sanitizePass(apiMessages);
  }
}

/**
 * 压缩工具循环历史消息，用注册表中的压缩摘要替代冗长的累积消息
 *
 * @param currentRoundMessages 当前累积的循环消息
 * @param sessionId 会话 ID，用于从注册表获取压缩摘要
 * @param assistantMsg 当前轮的 assistant 消息（含 tool_calls）
 * @param toolResults 当前轮的 tool 结果消息
 * @returns 压缩后的消息数组
 */
export function compressToolHistory(
  currentRoundMessages: Record<string, unknown>[],
  sessionId: string,
  assistantMsg: Record<string, unknown>,
  toolResults: Record<string, unknown>[]
): Record<string, unknown>[] {
  const storedCalls = toolResultRegistry.listBySession(sessionId);
  if (storedCalls.length < 2) {
    return [...currentRoundMessages, assistantMsg, ...toolResults];
  }

  const compressedHistory = toolResultRegistry.getCompressedHistory(sessionId);

  const preservedMessages: Record<string, unknown>[] = [];

  // 保留系统消息和第一条用户消息作为上下文（按角色查找，不依赖位置）
  const sysMsg = currentRoundMessages.find(
    (m: Record<string, unknown>) => m.role === 'system'
  );
  if (sysMsg) preservedMessages.push(sysMsg);

  const firstUserMsg = currentRoundMessages.find(
    (m: Record<string, unknown>) => m.role === 'user'
  );
  if (firstUserMsg) preservedMessages.push(firstUserMsg);

  // 插入压缩摘要
  preservedMessages.push({
    role: 'user',
    content: `以下是此前工具执行的压缩摘要，如需完整详情请使用 get_tool_result 工具按工具调用 ID 查询。\n\n${compressedHistory}`,
  });

  // 追加当前轮完整消息
  preservedMessages.push(assistantMsg, ...toolResults);

  return preservedMessages;
}
