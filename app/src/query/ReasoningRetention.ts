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
 * 推理内容保留 (Reasoning Retention)
 *
 * - 保留工具调用对应的推理内容（DeepSeek 模型要求 round-trip）
 * - 清理无关的纯文本推理内容以节省 token
 *
 */

import type { ChatMessage } from '../tools/repair/types';

/** 推理清理结果 */
export interface ReasoningPruneResult {
  messages: ChatMessage[];
  /** 被清理的消息数 */
  prunedCount: number;
  /** 丢弃的字符数 */
  charsDropped: number;
}

/**
 * 清理可丢弃的推理内容
 *
 * 规则：
 * - 有 tool_calls 的 assistant 消息：保留 reasoning_content（DeepSeek 校验要求）
 * - 无 tool_calls 的纯文本 assistant 消息：丢弃 reasoning_content（已在 content 中体现）
 * - 仅处理最后一个 user 消息之后的 assistant 消息
 */
export function stripDroppableReasoningContent(
  messages: ChatMessage[],
): ReasoningPruneResult {
  // 找到最后一个 user 消息的位置
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) {
    return { messages, prunedCount: 0, charsDropped: 0 };
  }

  let next: ChatMessage[] | null = null;
  let prunedCount = 0;
  let charsDropped = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;

    // 保留条件：不是 assistant / 在 user 之前 / 有 tool_calls / 没有 reasoning_content
    if (
      msg.role !== 'assistant' ||
      i <= lastUser ||
      hasToolCalls(msg) ||
      !('reasoning_content' in msg)
    ) {
      continue;
    }

    if (next === null) next = messages.slice();

    const { reasoning_content: dropped, ...replacement } = msg as ChatMessage & {
      reasoning_content?: string;
    };
    if (typeof dropped === 'string') charsDropped += dropped.length;
    next[i] = replacement;
    prunedCount += 1;
  }

  return {
    messages: next ?? messages,
    prunedCount,
    charsDropped,
  };
}

/**
 * 统计消息中的推理内容总量
 */
export function countReasoningChars(messages: ChatMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if ('reasoning_content' in msg && typeof msg.reasoning_content === 'string') {
      total += (msg.reasoning_content as string).length;
    }
  }
  return total;
}

// ─── 内部 ────────────────────────────────────────────────────────────────────

function hasToolCalls(msg: ChatMessage): boolean {
  return Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
}