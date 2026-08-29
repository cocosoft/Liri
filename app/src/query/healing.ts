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
 * 消息修复 (Healing)
 *
 * 修复从存储加载的历史消息中的常见问题：
 *   1. 工具调用配对修复 — 删除不配对的 assistant.tool_calls 和孤立 tool 消息
 *   2. 缺失 ID 补全 — DeepSeek 400 错误于 tool_calls 缺少 id
 *   3. 超大工具结果收缩
 *   4. 推理内容回填（thinking 模式模型）
 *
 * 借鉴: DeepSeek-Reasonix src/loop/healing.ts
 */

import {
  shrinkOversizedToolResults,
  shrinkOversizedToolCallArgs,
} from './shrink';
import type {
  RepairToolCall as ToolCall,
  RepairChatMessage as ChatMessage,
} from '@modules/tools';

let _stampSeq = 0;

/** 为缺少 id 的 tool_calls 生成回退 ID — DeepSeek 拒绝无 id 的调用 */
function stampMissingIds(calls: ToolCall[]): ToolCall[] {
  return calls.map((c) =>
    c.id ? c : { ...c, id: `z-ext-${Date.now()}-${_stampSeq++}` }
  );
}

/**
 * 修复工具调用配对
 *
 * 删除以下两种不配对的消息（DeepSeek 400 错误）：
 *   - assistant.tool_calls 没有对应的 tool 响应
 *   - 孤立的 tool 消息（没有对应的 assistant.tool_calls）
 */
export function fixToolCallPairing(messages: ChatMessage[]): {
  messages: ChatMessage[];
  droppedAssistantCalls: number;
  droppedStrayTools: number;
} {
  const out: ChatMessage[] = [];
  let droppedAssistantCalls = 0;
  let droppedStrayTools = 0;
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (
      msg.role === 'assistant' &&
      Array.isArray(msg.tool_calls) &&
      msg.tool_calls.length > 0
    ) {
      // 补全缺失 ID
      const calls = stampMissingIds(msg.tool_calls);
      const needed = new Set<string>();
      for (const call of calls) {
        if (call.id) needed.add(call.id);
      }
      const candidates: ChatMessage[] = [];
      let j = i + 1;
      while (j < messages.length && needed.size > 0) {
        const nxt = messages[j]!;
        if (nxt.role !== 'tool') break;
        const id = nxt.tool_call_id ?? '';
        if (!needed.has(id)) break;
        needed.delete(id);
        candidates.push(nxt);
        j++;
      }
      if (needed.size === 0) {
        out.push({ ...msg, tool_calls: calls });
        for (const r of candidates) out.push(r);
        i = j - 1;
      } else {
        droppedAssistantCalls += 1;
        droppedStrayTools += candidates.length;
        i = j - 1;
      }
      continue;
    }
    if (msg.role === 'tool') {
      droppedStrayTools += 1;
      continue;
    }
    out.push(msg);
  }
  return { messages: out, droppedAssistantCalls, droppedStrayTools };
}

/**
 * 修复加载的消息（字符数模式）
 */
export function healLoadedMessages(
  messages: ChatMessage[],
  maxChars: number
): { messages: ChatMessage[]; healedCount: number; healedFrom: number } {
  const shrunk = shrinkOversizedToolResults(messages, maxChars);
  const paired = fixToolCallPairing(shrunk.messages);
  const healedCount =
    shrunk.healedCount +
    paired.droppedAssistantCalls +
    paired.droppedStrayTools;
  return {
    messages: paired.messages,
    healedCount,
    healedFrom: shrunk.healedFrom,
  };
}

/**
 * 修复加载的消息（完整模式 — 含工具调用参数收缩）
 */
export function healLoadedMessagesFull(
  messages: ChatMessage[],
  maxChars: number
): {
  messages: ChatMessage[];
  healedCount: number;
  charsSaved: number;
} {
  const shrunk = shrinkOversizedToolResults(messages, maxChars);
  const paired = fixToolCallPairing(shrunk.messages);
  const argsShrunk = shrinkOversizedToolCallArgs(paired.messages, maxChars);
  const healedCount =
    shrunk.healedCount +
    argsShrunk.healedCount +
    paired.droppedAssistantCalls +
    paired.droppedStrayTools;
  return {
    messages: argsShrunk.messages,
    healedCount,
    charsSaved: shrunk.healedFrom + argsShrunk.healedFrom,
  };
}

/**
 * 为 thinking 模式模型回填空 reasoning_content
 * 非 thinking 模型跳过以避免前缀缓存变更
 */
export function stampMissingReasoningForThinkingMode(
  messages: ChatMessage[],
  isThinkingModel: boolean
): { messages: ChatMessage[]; stampedCount: number } {
  if (!isThinkingModel) {
    return { messages, stampedCount: 0 };
  }
  let stampedCount = 0;
  const out = messages.map((msg) => {
    if (msg.role !== 'assistant') return msg;
    if ('reasoning_content' in msg) return msg;
    stampedCount += 1;
    return { ...msg, reasoning_content: '' };
  });
  return { messages: out, stampedCount };
}
