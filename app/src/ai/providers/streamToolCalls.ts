// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * streamToolCalls —— 流式 tool_call 分片收敛（P3-2，2026-11-16；2026-11-17 扩充）
 *
 * 各 Provider 的流式响应都把 tool_call 参数按 index 分片下发，收尾时需按 index 升序
 * 合并为 `ParsedToolCall[]`，且参数非法 JSON 时保留原文（`{ _raw }`）而不是丢弃调用。
 * 原先 Anthropic / Azure 各抄一份完全相同的实现 ⇒ 收敛为单一入口（CS01）。
 *
 * 2026-11-17（P3-2 复杂度外移）：把 `OpenAIProvider.chatStreamInternal` 的
 * 「分片合并」（`mergeToolCallFragments`）与「finish_reason 收尾」
 * （`finalizeStreamToolCalls`）两段**逐字外移**到此，行为（合并顺序 / 截断语义）不变；
 * 等价性由 `tests/ai/providers/openaiStreamAccumulation.test.ts`（外移前先写的端到端
 * 特征化用例）锁定。
 */

import type { ParsedToolCall } from '../models/types';

/** 累积中的 tool_call 分片（同一 index 跨片合并） */
export type PendingToolCall = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * 把累积分片收敛为按 index 升序的调用列表。
 * 参数非法 JSON ⇒ 保留原文（`{ _raw }`），保证调用本身不丢。
 */
export function collectPendingToolCalls(
  pendingToolCalls: Map<number, PendingToolCall>
): ParsedToolCall[] {
  return Array.from(pendingToolCalls.entries())
    .sort(([a], [b]) => a - b)
    .map(([_, tc]) => {
      try {
        return {
          id: tc.id,
          name: tc.name,
          arguments: JSON.parse(tc.arguments) as Record<string, unknown>,
        };
      } catch {
        return {
          id: tc.id,
          name: tc.name,
          arguments: { _raw: tc.arguments },
        };
      }
    });
}

/** 结束原因（与 `ChatResponse.stop_reason` 同域） */
export type StreamStopReason = 'stop' | 'tool_calls' | 'max_tokens';

/** finish_reason 收尾结果（`null` = 本次 finish_reason 不改变累积状态） */
export type StreamToolCallFinalize = {
  stopReason: StreamStopReason;
  toolCalls?: ParsedToolCall[];
  partialToolCalls?: ParsedToolCall[];
};

/**
 * 把一条 `delta.tool_calls` 分片按 `index` 合并进累积表。
 *
 * 语义（逐字沿用内联版）：`id` / `name` 只在分片携带时覆盖；`arguments` 一律**追加**
 * （SSE 分片会把一个 JSON 参数串切成多段）。
 */
export function mergeToolCallFragments(
  fragments: Array<Record<string, unknown>>,
  pending: Map<number, PendingToolCall>
): void {
  for (const tc of fragments) {
    const idx = tc.index as number;
    const func = tc.function as Record<string, unknown> | undefined;

    let entry = pending.get(idx);
    if (!entry) {
      entry = { id: '', name: '', arguments: '' };
      pending.set(idx, entry);
    }
    if (tc.id) entry.id = tc.id as string;
    if (func) {
      if (func.name) entry.name = func.name as string;
      if (func.arguments) entry.arguments += func.arguments as string;
    }
  }
}

/**
 * 按 `finish_reason` 收尾本轮累积的 tool_calls。
 *
 * - `tool_calls` 且确有分片 ⇒ 落定为可执行调用（走 `collectPendingToolCalls`）。
 * - `max_tokens` / `length` ⇒ **截断**：把「名字 + 半截参数」如实上报到
 *   `partialToolCalls`（`_raw` + `_partial`），**由上层决定如何使用，绝不执行**。
 *   真机长程任务（2026-11-06）实测：`file_write` 写大文件被输出上限整点截断时，半截调用
 *   若被静默丢弃，模型不知道自己在写哪个文件，任务在原地中断。
 * - 其它 finish_reason ⇒ 返回 `null`（不改变累积状态）。
 */
export function finalizeStreamToolCalls(
  finishReason: string | undefined,
  pending: Map<number, PendingToolCall>
): StreamToolCallFinalize | null {
  if (finishReason === 'tool_calls' && pending.size > 0) {
    return {
      stopReason: 'tool_calls',
      toolCalls: collectPendingToolCalls(pending),
    };
  }
  if (finishReason === 'max_tokens' || finishReason === 'length') {
    return {
      stopReason: 'max_tokens',
      partialToolCalls: Array.from(pending.values())
        .filter((tc) => tc.name)
        .map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: { _raw: tc.arguments, _partial: true },
        })),
    };
  }
  return null;
}
