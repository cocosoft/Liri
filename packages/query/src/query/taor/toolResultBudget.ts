/**
 * taor/toolResultBudget.ts — TAOR 工具结果**入上下文前**的体积闸（2026-10-31）
 *
 * **背景**：TAOR/LRO 批处理路径把工具结果**全量** `JSON.stringify` 进 `messages`，
 * 真机 `pdca_*` 的大结果直接撑爆上下文（上下文溢出 400）；而同一条超额结果在
 * chat 路径（`chat/ReActToolLoop`）早已被 `ToolResultPersister` 替换为
 * 「安全预览 + 落盘路径引用」。
 *
 * **不新增第三套预算实现（CS01）**：直接复用 `tools/services/ToolResultPersister` 的
 * `prepareToolResultsForContext`（同 `SINGLE_RESULT_LIMIT_CHARS` / `TURN_BUDGET_CHARS`
 * 阈值、同 `buildSafePreview` 预览、同 `buildPathRefNotice` 文案、同落盘目录）。
 * 本模块只做**形态适配**：`RawToolResult`（批处理中间结果）↔ chat 域 `{ normalizedToolCall, result }`。
 *
 * **行为边界**：未超限结果**零改动**（`prepareToolResultsForContext` 内部提前返回，
 * 本模块写回时以引用是否变化为准，不产生新对象）。
 */
import { prepareToolResultsForContext } from '@modules/tools';
import type { RawToolResult, ToolCallEntry } from '../ReActLoop.js';

/** chat 域结果形态（与 `ToolResultPersister.ChatDomainToolResult` 同构） */
type AdaptedResult = {
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

/**
 * 对一轮批处理结果就地应用体积闸（超限 ⇒ 落盘 + 结果替换为预览）。
 *
 * 就地写回 `rawResults`（而非返回新数组）：调用方 `TAORLoop.act()` 的后续步骤
 * （trace / loop 检测 / 熔断 / 消息组装）都读同一数组，替换越早越一致。
 */
export async function shrinkOversizedRawResults(
  rawResults: Array<RawToolResult | undefined>,
  calls: ReadonlyArray<Pick<ToolCallEntry, 'id' | 'name'>>
): Promise<void> {
  const wrapped: Array<{
    index: number;
    original: unknown;
    entry: {
      normalizedToolCall: { id: string; name: string };
      result: AdaptedResult;
    };
  }> = [];
  for (let i = 0; i < rawResults.length; i++) {
    const raw = rawResults[i];
    const call = calls[i];
    if (!raw || !call) continue;
    wrapped.push({
      index: i,
      original: raw,
      entry: {
        normalizedToolCall: { id: raw.toolCallId ?? call.id, name: call.name },
        result: raw as AdaptedResult,
      },
    });
  }
  if (wrapped.length === 0) return;

  // 传入**整轮**（而非逐条调用）：`prepareToolResultsForContext` 的第三级防御
  // （单轮聚合超 `TURN_BUDGET_CHARS` ⇒ spill）依赖整轮总量。
  await prepareToolResultsForContext(wrapped.map((w) => w.entry));

  for (const w of wrapped) {
    // 只有被改写者才写回（未超限时 `entry.result` 仍是原引用）
    if (w.entry.result !== w.original) {
      rawResults[w.index] = w.entry.result;
    }
  }
}
