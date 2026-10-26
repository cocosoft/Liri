/**
 * taor/roundResults.ts — 批处理工具轮的「跳过回填」（LRO-D5，2026-10-26 抽取）
 *
 * 从 `TAORLoop.act()` 抽出：B14 的 PAIR-FILL —— 被 PathGuard 跳过的调用**原位回填**
 * 失败结果，保证 `rawResults[i] ↔ calls[i]` 位置对齐；并标 `safety_blocked`
 * （安全门是结构化依据），使批处理路径的熔断双预算与流式路径同口径。
 *
 * 抽取动机：`TAORLoop.ts` 已顶 `R04-001` 上限（2000 行），本模块为零依赖叶子。
 * 中间结果 → `ActResult.results` 的映射在 `ReActLoop.toToolResultEntries`（与类型同处）。
 */
import type { ToolCallEntry, RawToolResult } from '../ReActLoop.js';

/** 被跳过的调用**原位回填**失败结果（PAIR-FILL）；跳过项必须占位，否则整批错位 */
export function fillSkippedResults(
  calls: readonly Pick<ToolCallEntry, 'id' | 'name'>[],
  executedResults: readonly (RawToolResult | undefined)[],
  pathBlockedById: ReadonlyMap<string, string>
): Array<RawToolResult | undefined> {
  let executedIdx = 0;
  return calls.map((tc) => {
    const skip = pathBlockedById.get(tc.id);
    return skip
      ? {
          toolCallId: tc.id,
          toolName: tc.name,
          error: skip,
          failureKind: 'safety_blocked' as const,
        }
      : executedResults[executedIdx++];
  });
}
