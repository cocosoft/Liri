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
 * 无重复时返回原数组（零副作用）。
 */
export function dedupeToolCallBlocks(
  blocks: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const merged = new Map<string, Record<string, unknown>>();
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
  if (merged.size === 0) return blocks;
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
 * 对消息列表的 blocks 批量去重（读路径 T1.3 用）。
 * 无 blocks 或无需去重时返回原数组。
 */
export function dedupeMessagesToolCallBlocks<
  T extends { blocks?: Array<Record<string, unknown>> },
>(messages: T[]): T[] {
  let touched = false;
  const result = messages.map((m) => {
    if (!m.blocks || m.blocks.length === 0) return m;
    const deduped = dedupeToolCallBlocks(m.blocks);
    if (deduped === m.blocks) return m;
    touched = true;
    return { ...m, blocks: deduped };
  });
  return touched ? result : messages;
}
