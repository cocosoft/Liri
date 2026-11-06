// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 审批恢复路径的消息顺序修复（P0-2，2026-11-06）
 *
 * **真机问题**：回合以 `awaiting_approval` 收尾时会追加一条"⏸ 有工具调用正在等待你的审批…"
 * 的 assistant 消息；批准后 `resumeStream` 重放工具并把结果追加到末尾 ⇒ 送给模型的序列变成
 *   `assistant(tool_calls) → assistant(等待提示) → tool(result)`
 * 违反 Chat Completions 协议（`tool` 必须紧跟声明其 `tool_call_id` 的 assistant 消息），
 * provider 直接 400：`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
 *
 * **处置**：只调整**顺序**，不丢业务内容 —— 把每个 `tool` 结果移到其 owner assistant 之后；
 * 找不到 owner 的 `tool` 消息对模型无意义（也必然 400），直接剔除。
 */

/** 参与排序的最小消息形状（与 `apiMessages` 结构兼容） */
export interface OrderableChatMessage {
  role?: string;
  tool_calls?: Array<{ id?: unknown }>;
  tool_call_id?: string;
}

/** 收集 assistant 声明的 tool_call_id → 该 assistant 在数组中的下标 */
function collectOwners(
  messages: readonly OrderableChatMessage[]
): Map<string, number> {
  const owners = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) return;
    for (const tc of m.tool_calls) {
      if (typeof tc?.id === 'string' && tc.id) owners.set(tc.id, i);
    }
  });
  return owners;
}

/** 是否已满足「每个 tool 都紧跟其 owner assistant」 */
function isProtocolOrderValid(
  messages: readonly OrderableChatMessage[],
  owners: Map<string, number>
): boolean {
  let currentOwner: number | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'tool') {
      const owner = m.tool_call_id ? owners.get(m.tool_call_id) : undefined;
      if (owner === undefined || currentOwner !== owner) return false;
      continue;
    }
    currentOwner =
      m.role === 'assistant' &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.some((tc) => typeof tc?.id === 'string' && tc.id)
        ? i
        : null;
  }
  return true;
}

/**
 * 把 `tool` 消息移动到其 `tool_calls` 声明者之后；无 owner 的 `tool` 消息剔除。
 *
 * 已是合法顺序时**原样返回同一引用**（调用方可据此跳过额外处理）。
 *
 * @param messages 待发送给模型的消息列表（按原顺序）
 * @returns 合法顺序的消息列表
 */
export function orderToolResultsAfterOwners<T extends OrderableChatMessage>(
  messages: readonly T[]
): readonly T[] {
  const owners = collectOwners(messages);
  if (isProtocolOrderValid(messages, owners)) return messages;

  const toolsByOwner = new Map<number, T[]>();
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const owner = m.tool_call_id ? owners.get(m.tool_call_id) : undefined;
    if (owner === undefined) continue; // 无 owner ⇒ 对模型无意义，剔除
    const list = toolsByOwner.get(owner) ?? [];
    list.push(m);
    toolsByOwner.set(owner, list);
  }

  const out: T[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'tool') return; // 已随 owner 输出
    out.push(m);
    const tools = toolsByOwner.get(i);
    if (tools) out.push(...tools);
  });
  return out;
}
