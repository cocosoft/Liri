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
 * 工具结果收缩 (Shrink)
 *
 * 超大工具结果会撑爆 token 预算，需要截断。
 * 支持按字符数和按 token 数两种截断模式。
 *
 */

import type {
  RepairToolCall as ToolCall,
  RepairChatMessage as ChatMessage,
} from '@modules/tools';

/** 检查 JSON 字符串是否完整可解析 */
export function looksLikeCompleteJson(s: string): boolean {
  if (!s || !s.trim()) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** 截断后的前缀标记 */
const TRUNCATION_MARKER = '\n…[truncated]';

/**
 * 按字符数截断超大的工具结果消息
 * 仅处理 role === 'tool' 的消息
 */
export function shrinkOversizedToolResults(
  messages: ChatMessage[],
  maxChars: number
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  let healedCount = 0;
  let healedFrom = 0;
  const out = messages.map((msg) => {
    if (msg.role !== 'tool') return msg;
    const content = typeof msg.content === 'string' ? msg.content : '';
    if (content.length <= maxChars) return msg;
    healedCount += 1;
    healedFrom += content.length;
    return { ...msg, content: truncateContent(content, maxChars) };
  });
  return { messages: out, healedCount, healedFrom };
}

/**
 * 按字符数截断超大的工具调用参数
 * 仅处理 role === 'assistant' 且有 tool_calls 的消息
 */
export function shrinkOversizedToolCallArgs(
  messages: ChatMessage[],
  maxChars: number
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  let healedCount = 0;
  let healedFrom = 0;
  const out = messages.map((msg) => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) return msg;
    let changed = false;
    const newCalls = msg.tool_calls.map((call) => {
      const args = call.function?.arguments;
      if (typeof args !== 'string' || args.length <= maxChars) return call;
      const shrunk = shrinkJsonLongStrings(args);
      if (shrunk.length >= args.length) return call; // 无实际节省
      changed = true;
      healedCount += 1;
      healedFrom += args.length - shrunk.length;
      return { ...call, function: { ...call.function!, arguments: shrunk } };
    });
    if (!changed) return msg;
    return { ...msg, tool_calls: newCalls };
  });
  return { messages: out, healedCount, healedFrom };
}

/**
 * 内容截断：保留头部和尾部，中间替换为标记
 */
function truncateContent(content: string, maxChars: number): string {
  const markerLen = TRUNCATION_MARKER.length;
  if (maxChars <= markerLen + 20) {
    return content.slice(0, maxChars) + TRUNCATION_MARKER;
  }
  const headSize = Math.floor(maxChars * 0.6);
  const tailSize = maxChars - headSize - markerLen;
  return (
    content.slice(0, headSize) + TRUNCATION_MARKER + content.slice(-tailSize)
  );
}

/** 保留短键值（路径、ID）原样；仅截断长字符串值 */
const LONG_VALUE_THRESHOLD = 300;
const LONG_VALUE_MARKER = '…[shrunk]';

function shrinkJsonLongStrings(jsonStr: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const head = jsonStr.slice(0, 200);
    return `${head}${LONG_VALUE_MARKER} [${jsonStr.length} chars, unparsed]`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonStr;
  }
  const input = parsed as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string' && v.length > LONG_VALUE_THRESHOLD) {
      const newlines = (v.match(/\n/g) || []).length;
      output[k] = `${LONG_VALUE_MARKER} [${v.length} chars, ${newlines} lines]`;
    } else {
      output[k] = v;
    }
  }
  return JSON.stringify(output);
}
