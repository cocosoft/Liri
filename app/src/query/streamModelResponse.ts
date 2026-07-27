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
 * 流式模型响应处理器
 *
 * 处理 LLM 流式响应的工具调用增量检测与就绪判定。
 */

import { Logger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({ module: 'query:streamModel' });

// ─── 类型定义 ────────────────────────────────────────────────────────────────

/** 工具调用（流式增量） */
export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** 流式块 */
export interface StreamDelta {
  contentDelta?: string;
  reasoningDelta?: string;
  toolCallDelta?: {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason?: string;
}

/** 流式事件 */
export interface StreamEvent {
  turn: number;
  role: 'assistant_delta' | 'tool_call_delta';
  content: string;
  reasoningDelta?: string;
  toolName?: string;
  toolCallArgsChars?: number;
  toolCallIndex?: number;
  toolCallReadyCount?: number;
}

/** 流式响应结果 */
export interface StreamResult {
  assistantContent: string;
  reasoningContent: string;
  toolCalls: StreamingToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  finishReason: string | null;
}

/** 流式选项 */
export interface StreamModelOptions {
  /** 流式 delta 迭代器 */
  deltas: AsyncIterable<StreamDelta>;
  /** 当前回合数 */
  turn: number;
  /** 中止信号 */
  signal?: AbortSignal;
}

// ─── 流式处理器 ──────────────────────────────────────────────────────────────

/**
 * 处理流式模型响应，生成事件并返回最终结果
 *
 * 使用 AsyncGenerator 模式，支持：
 *   - 工具调用增量流式推送
 *   - JSON 参数就绪检测（complete JSON → ready）
 *   - 推理内容增量追踪
 *   - 用法统计收集
 */
export async function* streamModelResponse(
  opts: StreamModelOptions
): AsyncGenerator<StreamEvent, StreamResult, void> {
  const { deltas, turn, signal } = opts;
  let assistantContent = '';
  let reasoningContent = '';
  let usage: StreamResult['usage'] = null;
  let finishReason: string | null = null;
  const callBuf = new Map<number, StreamingToolCall>();
  const readyIndices = new Set<number>();

  for await (const delta of deltas) {
    try {
      if (signal?.aborted) break;

      // 推理增量
      if (delta.reasoningDelta) {
        reasoningContent += delta.reasoningDelta;
        yield {
          turn,
          role: 'assistant_delta',
          content: '',
          reasoningDelta: delta.reasoningDelta,
        };
      }

      // 内容增量
      if (delta.contentDelta) {
        assistantContent += delta.contentDelta;
        yield {
          turn,
          role: 'assistant_delta',
          content: delta.contentDelta,
        };
      }

      // 工具调用增量
      if (delta.toolCallDelta) {
        const d = delta.toolCallDelta;
        const cur = callBuf.get(d.index) ?? {
          id: d.id ?? '',
          name: '',
          arguments: '',
        };
        if (d.id) cur.id = d.id;
        if (d.name) cur.name = (cur.name ?? '') + d.name;
        if (d.argumentsDelta)
          cur.arguments = (cur.arguments ?? '') + d.argumentsDelta;
        callBuf.set(d.index, cur);

        // 检测工具调用参数是否完整
        if (
          !readyIndices.has(d.index) &&
          cur.name &&
          looksLikeCompleteJson(cur.arguments)
        ) {
          readyIndices.add(d.index);
        }

        if (cur.name) {
          yield {
            turn,
            role: 'tool_call_delta',
            content: '',
            toolName: cur.name,
            toolCallArgsChars: cur.arguments.length,
            toolCallIndex: d.index,
            toolCallReadyCount: readyIndices.size,
          };
        }
      }

      // 用法统计
      if (delta.usage) {
        usage = delta.usage;
      }

      // 结束原因
      if (delta.finishReason) {
        finishReason = delta.finishReason;
      }
    } catch (err) {
      await handleError(err, {
        module: 'query:streamModel',
        action: 'forAwait_delta',
      });
      // 单条 delta 异常不中断整体流，继续处理后续 delta
    }
  }

  return {
    assistantContent,
    reasoningContent,
    toolCalls: [...callBuf.values()],
    usage,
    finishReason,
  };
}

// ─── JSON 完整性检测 ─────────────────────────────────────────────────────────

/**
 * 检测 JSON 字符串是否完整可解析
 */
export function looksLikeCompleteJson(s: string): boolean {
  if (!s || !s.trim()) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}
