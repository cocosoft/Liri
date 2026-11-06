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

// ---------------------------------------------------------------------------
// N-15（2026-11-06 真机）：审批占位结果的识别
//
// **问题**：工具调用被安全门拦成"待审批"时，会先落一条 `awaiting_approval` 的 tool 结果；
// 批准后续跑**重放**同一调用并落第二条真实结果 ⇒ 同一 `tool_call_id` 被应答两次 ⇒ provider
// 400 `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`。
// 续跑入口本应用「剔除占位、只留重放结果」，但原判定只认**顶层 `toolCallId`** 与
// **`content` 为数组时的 block.toolCallId**，而占位消息的三种常见形态都会漏判：
//   ① `tool_call_id` 只在 `metadata.toolCallId`（持久化读回的形状）；
//   ② `content` 是 **JSON 字符串**（续跑内 ReAct 循环写回的形状），不是数组；
//   ③ 两者皆无、仅顶层 `toolCallId`（原实现已覆盖）。
// 故此处把"取 tool_call_id"收敛为**单一实现**（三处来源 + 字符串 content 解析）。
// ---------------------------------------------------------------------------

/** 参与「占位结果识别」的最小消息形状 */
export interface ToolResultCarrierMessage {
  role?: string;
  content?: unknown;
  toolCallId?: string;
  metadata?: { toolCallId?: unknown };
}

/** 从 `content`（数组或 JSON 字符串）里的 `tool_result` 块读出 toolCallId */
function readToolCallIdFromContent(content: unknown): string | undefined {
  let blocks: unknown = content;
  if (typeof content === 'string') {
    const trimmed = content.trim();
    // 纯文本结果（工具原始输出）不做 JSON 解析：只尝试 `[` / `{` 开头的结构化载荷
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return undefined;
    try {
      blocks = JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(blocks)) return undefined;
  for (const raw of blocks) {
    const b = raw as { type?: unknown; toolCallId?: unknown };
    if (
      b?.type === 'tool_result' &&
      typeof b.toolCallId === 'string' &&
      b.toolCallId
    ) {
      return b.toolCallId;
    }
  }
  return undefined;
}

/** 取 tool 结果消息对应的 tool_call_id（顶层 → `metadata.toolCallId` → 内容块） */
export function toolResultCallIdOf(
  message: ToolResultCarrierMessage
): string | undefined {
  if (typeof message.toolCallId === 'string' && message.toolCallId) {
    return message.toolCallId;
  }
  const fromMeta = message.metadata?.toolCallId;
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  return readToolCallIdFromContent(message.content);
}

/**
 * 该 `tool` 消息是否是**待重放调用的旧占位结果**（须在发给模型前剔除）。
 *
 * 判定口径：`role==='tool'` 且其 `tool_call_id` 落在 `replayIds`（本次续跑会重放的调用集合）。
 * 落盘侧**保留**两条（"提交过审批" → "批准后实际结果"）作为审计轨迹，只在发送前剔除。
 */
export function isReplayedToolResult(
  message: ToolResultCarrierMessage,
  replayIds: ReadonlySet<string>
): boolean {
  if (message.role !== 'tool') return false;
  const id = toolResultCallIdOf(message);
  return id !== undefined && replayIds.has(id);
}

/**
 * 取 assistant 消息**声明的** `tool_calls`。
 *
 * 两种载体：持久化的 `metadata.tool_calls`，与事件派生消息的**顶层** `tool_calls`（§31.4 观察项）。
 * 只认前者会让"重启后由事件重建的会话"丢失全部声明 ⇒ 其 tool 结果变成孤立消息（必然 400），
 * 故此处收敛为单一取值入口。
 */
export function declaredToolCallsOf(message: {
  metadata?: { tool_calls?: unknown };
  tool_calls?: unknown;
}): Array<Record<string, unknown>> | undefined {
  const fromMeta = message.metadata?.tool_calls;
  if (Array.isArray(fromMeta) && fromMeta.length > 0) {
    return fromMeta as Array<Record<string, unknown>>;
  }
  const fromTop = message.tool_calls;
  if (Array.isArray(fromTop) && fromTop.length > 0) {
    return fromTop as Array<Record<string, unknown>>;
  }
  return undefined;
}

/**
 * 同一 `tool_call_id` 只保留**最后一条** `tool` 应答（N-15）。
 *
 * 为什么必须去重：审批链路会为同一调用先后落两条结果——① 待审批占位（`awaiting_approval`）、
 * ② 批准后重放的真实结果。跨**多次**审批续跑时，历史里这类"一对二"会累积；而
 * `isReplayedToolResult` 只能剔除**本次**要重放的调用（`replayIds`），对"往次审批"留下的
 * 重复无能为力 ⇒ 同一 call 被应答两次 ⇒ provider 400。
 *
 * 保留**最后一条**的理由：真实结果总在占位之后（先"提交过审批"，后"批准后执行"）。
 * 无重复时**原样返回同一引用**（零开销，与 {@link orderToolResultsAfterOwners} 一致）。
 */
export function dedupeToolResults<T extends ToolResultCarrierMessage>(
  messages: readonly T[]
): readonly T[] {
  const lastIndexByCallId = new Map<string, number>();
  messages.forEach((m, i) => {
    if (m.role !== 'tool') return;
    const id = toolResultCallIdOf(m);
    if (id !== undefined) lastIndexByCallId.set(id, i);
  });

  const drop = new Set<number>();
  messages.forEach((m, i) => {
    if (m.role !== 'tool') return;
    const id = toolResultCallIdOf(m);
    if (id === undefined) return;
    const last = lastIndexByCallId.get(id);
    if (last !== undefined && last !== i) drop.add(i);
  });
  if (drop.size === 0) return messages;

  return messages.filter((_, i) => !drop.has(i));
}
