// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * yield 轮次登记（阶段 A / N-28 修复）
 *
 * 抽取自 `ReActToolLoop.act()` 的内联逻辑，供**两条工具执行链路共用**：
 * - stream 路径：`chat/ReActToolLoop.ts`
 * - batch  路径：`query/TAORLoop.ts`（非流式 `/v1/chat/completions` 走此路径）
 *
 * 背景（台账 N-28）：此前只在 stream 路径登记，实测模型在 batch 路径真实调用
 * `sessions_yield` 后既不登记等待、骨架也不短路（`actResult.yielded` 恒 undefined）。
 *
 * 说明：turn 编号此刻尚不可知（只有收尾点写 `turn/end` 时可知）⇒ 记 0，
 * 由收尾点用 `YieldRegistry.updateTurn` 回填。
 */

import { getYieldRegistry, type YieldWaitingEntry } from './YieldRegistry';
import { YIELD_TOOL_NAME } from './constants';

/** 参与判定所需的最小工具结果形态（`ToolResultEntry` 的结构化子集，避免跨层依赖） */
export interface YieldCandidateResult {
  name: string;
  status: string;
  toolCallId: string;
}

/**
 * 从一轮工具结果中检出**成功的 yield** 并登记等待。
 *
 * @returns 登记条目；本轮未成功 yield 时返回 `null`
 */
export function registerYieldFromResults(
  results: ReadonlyArray<YieldCandidateResult>,
  sessionId: string
): YieldWaitingEntry | null {
  const hit = results.find(
    (r) => r.name === YIELD_TOOL_NAME && r.status === 'success'
  );
  if (!hit) return null;

  return getYieldRegistry().register({
    sessionId,
    turn: 0, // 收尾点回填
    toolCallId: hit.toolCallId,
  });
}
