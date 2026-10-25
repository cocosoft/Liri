/**
 * resumePending — 续跑时按**幂等性**拆分「未完成工具」（T25-13a，2026-10-25）
 *
 * ## 为什么需要
 * 预算挂起/崩溃后的续跑此前把检查点里的 `pendingToolCalls` **原样**交给
 * `buildBudgetResumePrompt()` 提示模型"继续" ⇒ 非幂等工具（bash / 写文件 / 发消息）
 * 可能被**无审批重放**一次。
 *
 * 既有护栏为何没兜住：
 * - 崩溃路径（`unknown`）有 `unknown-tool-call-recovery` 的「manual ⇒ Inbox 确认」；
 * - 但**续跑路径**没有等价处置；且 `isNonIdempotentRetry` 要求「上次**失败**」，
 *   而 `ToolResultRegistry.storeResult` 只在执行**完成后**写入 ⇒ 中断未失败 ⇒ 不匹配。
 *
 * ## 判据
 * 复用 `canReplayAfterUnknown()`（唯一事实源 = `tools/toolEffects.ts` 的 `TOOL_EFFECTS`）：
 * 幂等 ⇒ 可自动重放；非幂等 / **未声明**（MCP·插件）⇒ 人工确认。
 */
import { canReplayAfterUnknown } from '@modules/tools';
import type { PendingToolCallRef } from '@modules/query';

export interface ResumePendingSplit {
  /** 幂等工具 ⇒ 可写进"请继续"清单，允许自动重放 */
  replayable: PendingToolCallRef[];
  /** 非幂等 / 未声明 ⇒ **不得自动重放**，须人工确认（Inbox） */
  manual: PendingToolCallRef[];
}

/** 纯函数：按工具幂等性拆分（空 / 缺省 ⇒ 两侧均为空数组） */
export function splitResumePending(
  pending: readonly PendingToolCallRef[] | null | undefined
): ResumePendingSplit {
  const replayable: PendingToolCallRef[] = [];
  const manual: PendingToolCallRef[] = [];
  for (const p of pending ?? []) {
    if (canReplayAfterUnknown(p.toolName)) replayable.push(p);
    else manual.push(p);
  }
  return { replayable, manual };
}
