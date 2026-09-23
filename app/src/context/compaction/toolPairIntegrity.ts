/**
 * 工具配对完整性保护（Phase 3）
 * 对标 PilotDeck toolPairIntegrity.ts
 *
 * 确保压缩后 tool_call ↔ tool_result 配对完整
 */
import type { ChatMessage } from '@modules/ai';

/**
 * 收集所有 tool_call 引用 ID（调用声明 + 结果标注的 tool_call_id 并集）
 * 注意：不是仅"调用"ID——同时包含 tool_result.tool_call_id（结果标注字段）。
 * 如果需要仅收集调用 ID，请使用 collectToolResultIds() 配合过滤。
 */
export function collectToolCallIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    const tcId = (msg as unknown as Record<string, unknown>).tool_call_id as
      | string
      | undefined;
    if (tcId) ids.add(tcId);
    // 也收集 assistant 消息中的 tool_calls 数组
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    if (toolCalls) {
      for (const tc of toolCalls) {
        if (tc.id) ids.add(tc.id);
      }
    }
  }
  return ids;
}

/**
 * 收集所有 tool_result ID（结果中的 tool_call_id 字段）
 */
export function collectToolResultIds(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    const resultCallId = (msg as unknown as Record<string, unknown>)
      .tool_call_id as string | undefined;
    if (resultCallId) ids.add(resultCallId);
  }
  return ids;
}

/**
 * 移除孤立的 tool_calls（有调用无结果）
 */
export function stripUnpairedToolCalls(
  messages: ChatMessage[],
  pairedResultIds: Set<string>
): ChatMessage[] {
  return messages.filter((msg) => {
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;

    // 如果消息有 tool_calls 但所有都无配对结果，过滤掉
    if (toolCalls && toolCalls.length > 0) {
      const hasPaired = toolCalls.some(
        (tc) => tc.id && pairedResultIds.has(tc.id)
      );
      return hasPaired;
    }

    // BUG-β fix: removed dead `msg.id` branch — ChatMessage has no `id` field
    // Only the tool_calls array path is valid
    return true;
  });
}

/**
 * 移除孤立的 tool_results（有结果无调用）
 */
export function stripUnpairedToolResults(
  messages: ChatMessage[],
  pairedCallIds: Set<string>
): ChatMessage[] {
  return messages.filter((msg) => {
    const resultCallId = (msg as unknown as Record<string, unknown>)
      .tool_call_id as string | undefined;
    if (resultCallId && !pairedCallIds.has(resultCallId)) return false;
    return true;
  });
}

/**
 * 确保消息数组以 user 消息结尾（API 要求）
 * 如果以 assistant 结尾，追加 continue 标记
 */
export function ensureTrailingUserMessage(
  messages: ChatMessage[]
): ChatMessage[] {
  if (messages.length === 0) return messages;

  const last = messages[messages.length - 1];
  if (last.role !== 'user') {
    return [
      ...messages,
      { role: 'user', content: 'Continue.' } as unknown as ChatMessage,
    ];
  }
  return messages;
}

/* ===================================================================
 * R6（2026-09-21）：上游协议要求**严格配对**（请求侧）
 *
 * 背景（真机实证）：Tier3 折叠批按 token 预算切片，批尾极易停在
 * `assistant(tool_calls)` 与其工具结果之间 ⇒ 发给 provider 的
 * `[head, batch, 压缩指令]` 出现"悬空 tool_calls" ⇒ 400
 * （`An assistant message with 'tool_calls' must be followed by tool messages…`）
 * ⇒ 所有批全失败、Tier3 恒 `applied:false`、上下文只增不减。
 *
 * 与上面 `stripUnpairedToolCalls` 的区别：后者用 `some` 口径、且作用于压缩**结果**
 * （启发式清洗）；下面两个函数是**请求侧**的严格收敛（`every` 口径）：
 *   ① `completeTrailingToolPairs`：切批时**向前吃齐**配对结果（保语义，首选）；
 *   ② `sanitizeToolCallPairs`：发请求前**兜底收敛**（保协议，任何切片都安全）。
 * =================================================================== */

/** 单条消息声明的 tool_call id（非 assistant / 无 tool_calls ⇒ 空数组） */
function declaredToolCallIds(msg: ChatMessage): string[] {
  const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
    | Array<{ id?: string }>
    | undefined;
  if (!toolCalls || toolCalls.length === 0) return [];
  return toolCalls
    .map((tc) => tc.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** 单条消息标注的 tool_result 目标 id（tool 消息的 `tool_call_id`） */
function resultToolCallId(msg: ChatMessage): string | undefined {
  return (msg as unknown as Record<string, unknown>).tool_call_id as
    | string
    | undefined;
}

/** 本数组内**声明了但缺失结果**的 tool_call id 集合 */
export function unpairedToolCallIds(messages: ChatMessage[]): Set<string> {
  const declared = new Set<string>();
  const answered = new Set<string>();
  for (const msg of messages) {
    for (const id of declaredToolCallIds(msg)) declared.add(id);
    const rid = resultToolCallId(msg);
    if (rid) answered.add(rid);
  }
  const pending = new Set<string>();
  for (const id of declared) {
    if (!answered.has(id)) pending.add(id);
  }
  return pending;
}

/**
 * 把 `rest` **紧随其后**的工具结果并入 `batch`，直到批内已声明的 tool_call 全部配对。
 *
 * 切批时使用（bumped-by-pair）：宁可略超预算，也不让切点落在配对中间 ——
 * 保住了"调用 + 结果"的语义完整性（`sanitizeToolCallPairs` 兜底时会丢弃悬空调用）。
 * 遇到第一条非配对消息即停：不跨越后续轮次、不吞掉无关消息。
 */
export function completeTrailingToolPairs(
  batch: ChatMessage[],
  rest: ChatMessage[]
): { batch: ChatMessage[]; rest: ChatMessage[] } {
  const pending = unpairedToolCallIds(batch);
  if (pending.size === 0 || rest.length === 0) return { batch, rest };

  const extra: ChatMessage[] = [];
  for (const msg of rest) {
    const rid = resultToolCallId(msg);
    if (!rid || !pending.has(rid)) break;
    extra.push(msg);
    pending.delete(rid);
  }
  if (extra.length === 0) return { batch, rest };
  return {
    batch: [...batch, ...extra],
    rest: rest.slice(extra.length),
  };
}

/**
 * 请求侧兜底收敛：把消息数组裁剪成**上游一定接受**的形状 ——
 * ① 逐条 assistant 只保留"在**本数组内**确有 tool 结果"的 `tool_calls`；
 *    若该消息因此既无 tool_calls 又无正文 ⇒ 整条丢弃；
 * ② 丢弃无对应调用声明的 `tool` 消息（孤立结果同样会被上游 400）。
 *
 * 幂等、不修改入参（返回新数组），可安全用于任意切片结果。
 */
export function sanitizeToolCallPairs(messages: ChatMessage[]): ChatMessage[] {
  const declared = new Set<string>();
  for (const msg of messages) {
    for (const id of declaredToolCallIds(msg)) declared.add(id);
  }
  const answered = collectToolResultIds(messages);

  const out: ChatMessage[] = [];
  for (const msg of messages) {
    const ids = declaredToolCallIds(msg);
    if (ids.length === 0) {
      const rid = resultToolCallId(msg);
      // 孤立 tool 结果（无调用声明）⇒ 丢弃
      if (rid && !declared.has(rid)) continue;
      out.push(msg);
      continue;
    }

    const keptIds = ids.filter((id) => answered.has(id));
    if (keptIds.length === ids.length) {
      out.push(msg);
      continue;
    }

    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    const keptCalls = (toolCalls ?? []).filter(
      (tc) => typeof tc.id === 'string' && answered.has(tc.id)
    );
    const raw = msg as unknown as Record<string, unknown>;
    const content = raw.content;
    const hasContent =
      typeof content === 'string' ? content.trim().length > 0 : content != null;

    if (keptCalls.length === 0 && !hasContent) continue; // 空壳 ⇒ 丢弃
    const next: Record<string, unknown> = { ...raw };
    if (keptCalls.length === 0) {
      delete next.tool_calls;
    } else {
      next.tool_calls = keptCalls;
    }
    out.push(next as unknown as ChatMessage);
  }
  return out;
}
