// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * agentReasonAttribution —— 推理轮次的**只读归因**投影（N-1 / N-13，2026-11-06）
 *
 * 从 provider 响应与流式分片计数里提取两个事实，供"不完整回合"续接策略使用：
 *  - `partialToolCalls`：被 `max_tokens` 截断时**未写完**的工具调用（半截 JSON，**绝不执行**）；
 *  - `thinkingRatio`：推理占流式分片的比例（用于判断"预算是否被推理耗尽"）。
 *
 * 为什么单独成文件：`ReActToolLoop.ts` 逼近 R04-001 的 2000 行上限（实测 2011），
 * 按该规则要求拆到子目录文件，而不是继续堆在骨架里。本模块是**纯函数**、无副作用。
 */

import type { ToolCallEntry } from '@modules/query';

/** provider 上报的半截工具调用（参数为 `{_raw, _partial}`） */
interface PartialToolCallLike {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
}

/** 流式分片计数（`StreamingLlm.lastRoundChunkStats()` 的返回形状） */
export interface RoundChunkStats {
  text: number;
  thinking: number;
}

export interface ReasonAttribution {
  /** 半截工具调用（仅归因；不进可执行列表） */
  partialToolCalls: ToolCallEntry[];
  /** 推理占比；两侧都为 0（如非流式调用）时为 `undefined`（不臆造） */
  thinkingRatio?: number;
}

/**
 * 计算本轮的归因投影。
 *
 * @param response provider 响应（只读 `partial_tool_calls`）
 * @param chunkStats 本轮流式分片计数
 */
export function attributeReasonRound(
  response: unknown,
  chunkStats: RoundChunkStats
): ReasonAttribution {
  const partial = (response as { partial_tool_calls?: PartialToolCallLike[] })
    ?.partial_tool_calls;
  const partialToolCalls: ToolCallEntry[] = (partial ?? []).map((tc) => ({
    id: tc.id,
    name: tc.name,
    input: tc.arguments ?? {},
  }));

  const total = chunkStats.text + chunkStats.thinking;
  return {
    partialToolCalls,
    ...(total > 0 ? { thinkingRatio: chunkStats.thinking / total } : {}),
  };
}
