// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * streamToolCalls —— 流式 tool_call 分片收敛（P3-2，2026-11-16）
 *
 * 各 Provider 的流式响应都把 tool_call 参数按 index 分片下发，收尾时需按 index 升序
 * 合并为 `ParsedToolCall[]`，且参数非法 JSON 时保留原文（`{ _raw }`）而不是丢弃调用。
 * 原先 Anthropic / Azure 各抄一份完全相同的实现 ⇒ 收敛为单一入口（CS01）。
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
