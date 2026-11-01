// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * chatBlocks — 消息 blocks 通用工具（T1.1/T1.3，2026-08-23）
 *
 * 背景：SSE 层 tool_start/tool_end 双 chunk 被重复发送时，同一 toolCallId 的
 * tool_call 块会在 blocks 中重复（实测"2 带 args + 2 空 args"）。tool_end 块
 * 空 arguments 但带 status/result（终态）；tool_start 块带 arguments（建卡参数）。
 *
 * 合并策略（与前端 `chat-message-shared.dedupeToolCallBlocks` 同源）：
 *   - 终态字段（status/result/error）取后到块（tool_end 优先）
 *   - arguments 取首个非空值（保留 tool_start 建卡参数）
 * 每个 toolId 只在首次出现位置输出一次合并后的块，非 tool_call 块原样保留。
 */

/** 从块中提取工具调用 id（兼容 toolCallId 字段与 toolCall.id 嵌套） */
function extractToolId(b: Record<string, unknown>): string {
  const toolCall = b.toolCall as Record<string, unknown> | undefined;
  return String(b.toolCallId ?? toolCall?.id ?? '');
}

/**
 * 同 toolCallId 的 tool_call 块合并去重（终态优先 + 保留首非空 arguments）。
 *
 * 零副作用契约：不含可归属的 tool_call，或每个 toolCallId 仅出现一次（无重复可并）
 * 时返回原数组——调用方可用 `返回值 !== 入参` 判断"是否真的发生了折叠"。
 */
export function dedupeToolCallBlocks(
  blocks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
  let duplicated = false;
  for (const b of blocks) {
    if (b.type !== 'tool_call') continue;
    const toolId = extractToolId(b);
    if (!toolId) continue;
    const existing = merged.get(toolId);
    if (!existing) {
      merged.set(toolId, {
        ...b,
        toolCall: { ...((b.toolCall as Record<string, unknown>) ?? {}) },
      });
    } else {
      duplicated = true;
      const prev = (existing.toolCall as Record<string, unknown>) ?? {};
      const next = (b.toolCall as Record<string, unknown>) ?? {};
      const prevHasArgs =
        prev.arguments &&
        typeof prev.arguments === 'object' &&
        Object.keys(prev.arguments as object).length > 0;
      existing.toolCall = {
        ...prev,
        ...next,
        // arguments：保留首个非空值（tool_start 建卡参数），避免 tool_end 空 args 覆盖
        arguments: prevHasArgs ? prev.arguments : next.arguments,
      };
    }
  }
  if (!duplicated) return blocks; // 无重复可并（含唯一/空 id 的 tool_call）→ 原数组零副作用
  const result: Array<Record<string, unknown>> = [];
  for (const b of blocks) {
    if (b.type !== 'tool_call') {
      result.push(b);
      continue;
    }
    const toolId = extractToolId(b);
    if (!toolId) {
      result.push(b);
      continue;
    }
    const m = merged.get(toolId);
    if (!m) continue; // 该 toolId 已输出过（首个块位置）→ 跳过后续重复块
    // 每个 toolId 只在首次出现位置输出一次（合并后的终态块）
    result.push(m);
    merged.delete(toolId);
  }
  return result;
}

/**
 * 逐消息对 blocks 做"跨消息归属"过滤：tool_call 块若其 toolCallId 已归属过则移除。
 * 返回 [kept, dropped]；seenIds 就地累积（首个携带者赢得归属）。
 */
function filterOwnedToolBlocks(
  blocks: Array<Record<string, unknown>>,
  seenIds: Set<string>
): { kept: Array<Record<string, unknown>>; dropped: number } {
  const kept: Array<Record<string, unknown>> = [];
  let dropped = 0;
  for (const b of blocks) {
    if (b.type === 'tool_call') {
      const id = extractToolId(b);
      if (id && seenIds.has(id)) {
        dropped += 1;
        continue;
      }
      if (id) seenIds.add(id);
    }
    kept.push(b);
  }
  return { kept, dropped };
}

/**
 * 对消息列表的 blocks 批量去重（读路径 T1.3 + Fix3 用），两阶段、提交式语义：
 *   1) 消息内去重：dedupeToolCallBlocks 折叠同 toolCallId 的重复 tool_call（无重复时原样返回）。
 *   2) 跨消息归属去重：同一 toolCallId 只在首个携带它的消息中保留，后续消息的重复引用块
 *      移除（实测同一 call 出现在工具承载消息与后续消息各一次 → 189 块 / 186 唯一）。
 * 只要任一消息的 blocks 实际发生变化（消息内折叠或跨消息移除）就提交重建结果；
 * 完全无变更时返回原数组引用（零副作用，引用保持）。
 *
 * 注意（与旧实现的语义差异）：旧实现用单一 touched 位只在"跨消息移除"时提交，导致
 * "仅消息内折叠"（单条消息内重复）的结果被静默丢弃——读路径守卫漏去重。重构后折叠
 * 同样视为实际变更并被提交。
 */
export function dedupeMessagesToolCallBlocks<
  T extends { id?: string; blocks?: Array<Record<string, unknown>> },
>(messages: T[]): T[] {
  const seenIds = new Set<string>();
  const result: T[] = [];
  let touched = false;
  for (const m of messages) {
    if (!m.blocks || m.blocks.length === 0) {
      result.push(m);
      continue;
    }
    // 1) 消息内去重：无重复返回原数组（引用比较即"是否折叠"）
    const inner = dedupeToolCallBlocks(m.blocks);
    // 2) 跨消息归属去重：已归属过的 tool_call 块移除
    const { kept, dropped } = filterOwnedToolBlocks(inner, seenIds);
    const changed = dropped > 0 || inner !== m.blocks;
    if (!changed) {
      result.push(m);
      continue;
    }
    touched = true;
    result.push({ ...m, blocks: kept });
  }
  return touched ? result : messages;
}
