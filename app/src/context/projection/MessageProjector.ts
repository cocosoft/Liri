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
 * MessageProjector — 发送前消息投影/安全化（对标 PilotDeck MessageProjector）
 *
 * 在消息发送给模型前执行以下安全变换，防止 provider 拒收（400）：
 *   1. repairToolResultPairing — 为无配对结果的 tool_call 注入占位 tool 消息；
 *      剥离无主 tool 消息；补全缺失 id。非破坏性（与 healing 的"删除"策略互补）。
 *   2. toolPairSafeTruncate — 窗口截断时永不切断 tool_call ↔ tool_result 对
 *      （assistant(tool_calls) + 后续连续 tool 消息作为原子块，整块丢弃以满足硬上限）。
 *
 * 与 healing.ts 的关系：本模块是"发送前防御"；healing 是"加载后兜底"，两者并存。
 */
import type { ChatMessage, ToolCall } from '@modules/ai';

/** 占位工具结果内容（对标 PilotDeck [result truncated]） */
export const INJECTED_RESULT_CONTENT = '[result truncated]';

/** 投影警告码 */
export type ProjectionWarningCode =
  | 'injected_tool_result'
  | 'stripped_orphan_result'
  | 'truncated_tool_pair';

export interface ProjectionWarning {
  code: ProjectionWarningCode;
  toolCallId?: string;
  message: string;
}

export interface ProjectionResult {
  messages: ChatMessage[];
  warnings: ProjectionWarning[];
}

/** 缺失 tool_call id 的回退前缀（与 healing.ts 保持一致的 z-ext 方案） */
const STAMP_ID_PREFIX = 'z-ext-proj-';
let _stampSeq = 0;

/** 为缺失 id 的 tool_calls 生成回退 ID（DeepSeek 拒绝无 id 的调用） */
function stampMissingIds(calls: ToolCall[]): ToolCall[] {
  return calls.map((c) =>
    c.id ? c : { ...c, id: `${STAMP_ID_PREFIX}${Date.now()}-${_stampSeq++}` }
  );
}

export class MessageProjector {
  /**
   * 修复工具调用-结果配对（非破坏性）
   *
   * - assistant.tool_calls 中无对应 tool 消息的调用 → 注入占位 tool 消息
   * - tool 消息（tool_call_id 无对应 assistant.tool_calls）→ 剥离（孤立结果）
   * - tool_calls 缺失 id → 补全
   */
  repairToolResultPairing(messages: ChatMessage[]): ProjectionResult {
    const warnings: ProjectionWarning[] = [];
    const declaredIds = new Set<string>();
    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          if (call.id) declaredIds.add(call.id);
        }
      }
    }

    const out: ChatMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'tool') {
        const id = msg.tool_call_id ?? '';
        if (id && !declaredIds.has(id)) {
          // 孤立 tool 结果：无对应 assistant 声明 → 剥离
          warnings.push({
            code: 'stripped_orphan_result',
            toolCallId: id,
            message: `剥离无主 tool 消息 (tool_call_id=${id})`,
          });
          continue;
        }
        out.push(msg);
        continue;
      }

      if (
        msg.role === 'assistant' &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      ) {
        const calls = stampMissingIds(msg.tool_calls);
        // 统计该 assistant 消息之后已配对的 tool_call_id
        const idx = messages.indexOf(msg);
        const providedIds = new Set<string>();
        for (let i = idx + 1; i < messages.length; i++) {
          const nxt = messages[i];
          if (nxt && nxt.role === 'tool' && nxt.tool_call_id) {
            providedIds.add(nxt.tool_call_id);
          }
        }
        // 仅对缺失结果的 tool_call 注入占位（非破坏性，与 healing 删除策略互补）
        const injected: ChatMessage[] = [];
        for (const call of calls) {
          if (providedIds.has(call.id)) continue;
          injected.push({
            role: 'tool',
            content: INJECTED_RESULT_CONTENT,
            tool_call_id: call.id,
          });
          warnings.push({
            code: 'injected_tool_result',
            toolCallId: call.id,
            message: `为无配对结果的 tool_call 注入占位 (${call.function.name})`,
          });
        }
        out.push({ ...msg, tool_calls: calls });
        out.push(...injected);
        continue;
      }

      out.push(msg);
    }

    return { messages: out, warnings };
  }

  /**
   * 滑动窗口截断：永不切断 tool_call ↔ tool_result 对
   *
   * 从头部丢弃最早的消息；assistant(tool_calls) + 后续连续 tool 消息作为
   * 原子块整体处理——只要仍需丢弃就整块丢弃，保证结果 ≤ maxMessages。
   */
  toolPairSafeTruncate(
    messages: ChatMessage[],
    maxMessages: number
  ): ProjectionResult {
    const warnings: ProjectionWarning[] = [];
    if (maxMessages <= 0) {
      return { messages: [], warnings };
    }
    if (messages.length <= maxMessages) {
      return { messages, warnings };
    }

    let dropCount = messages.length - maxMessages;
    let head = 0;
    while (head < messages.length && dropCount > 0) {
      const msg = messages[head];
      if (
        msg &&
        msg.role === 'assistant' &&
        Array.isArray(msg.tool_calls) &&
        msg.tool_calls.length > 0
      ) {
        // 原子块（assistant + 后续连续 tool 消息）整块丢弃——
        // 保证 maxMessages 硬上限且绝不切断 tool 对
        let blockEnd = head + 1;
        while (
          blockEnd < messages.length &&
          messages[blockEnd]?.role === 'tool'
        ) {
          blockEnd++;
        }
        const blockSize = blockEnd - head;
        head = blockEnd;
        dropCount -= blockSize;
        warnings.push({
          code: 'truncated_tool_pair',
          message: `整块丢弃 tool 块（${blockSize} 条）以保护配对完整性`,
        });
      } else {
        head++;
        dropCount--;
      }
    }

    return { messages: messages.slice(head), warnings };
  }

  /**
   * 组合入口：先修复配对（非破坏性），再按需安全截断
   */
  project(
    messages: ChatMessage[],
    opts?: { maxMessages?: number }
  ): ProjectionResult {
    const repaired = this.repairToolResultPairing(messages);
    if (opts?.maxMessages === undefined) {
      return repaired;
    }
    const truncated = this.toolPairSafeTruncate(
      repaired.messages,
      opts.maxMessages
    );
    return {
      messages: truncated.messages,
      warnings: [...repaired.warnings, ...truncated.warnings],
    };
  }
}

/** 全局单例（与 compactionOrchestrator 等一致的无状态投影器） */
export const messageProjector = new MessageProjector();
