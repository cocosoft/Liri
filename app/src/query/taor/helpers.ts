/**
 * taor/helpers.ts — TAOR 纯助手（续接指令常量 / trace 截断 / 停止原因映射）
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**（含全部原注释）。
 * 依赖方向：零依赖宿主（仅 `@modules/tasks` 与 ReActLoop 的**类型**）⇒ 无循环。
 */

import { CONTINUATION_TEMPLATES } from '@modules/tasks';
import type { TerminationReason } from '../ReActLoop.js';

/** L3（2026-09-06）：回合质量重试指令 —— **B2-3 收尾迁移（2026-09-23）**：
 *  文案唯一来源改为 `tasks/goal/goalTemplates`（原为"模块自持副本"，理由曾是避免
 *  query→chat 反向依赖；但模板模块位于 `tasks/`（非 chat）⇒ 该理由已不成立，
 *  且两份文案逐字重复属 CS01 违规 —— 见 `.trae/specs/goal-entity.md §5.3.1 #1`）。
 *  batch 无 thinking/finishReason 可靠信号，仅 empty/planning 两类。 */
export const TAOR_EMPTY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.empty;
export const TAOR_PLANNING_ONLY_RETRY_INSTRUCTION =
  CONTINUATION_TEMPLATES.planning;
/** planning-only 启发式判定（与 ReActToolLoop.PLANNING_ONLY_RE 同源，保守避免误判正常回答） */
export const TAOR_PLANNING_ONLY_RE =
  /(?:以下(?:是)?(?:我(?:的)?)?(?:执行)?计划|我的计划(?:如下|是)|\bplan(?:\s*:|\s+is|\s+to)\b|步骤\s*[:：]|接下来(?:我)?(?:将|会))/i;

/** trace 持久化用：将值安全截断为 JSON 摘要（默认 500 字符） */
export function truncateForTrace(value: unknown, maxLen = 500): string {
  try {
    const s = JSON.stringify(value);
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

/**
 * A 档（2026-09-05，复查收口）：TAOR stopReason → 统一 TerminationReason 的纯映射。
 * 显式收口 loop_detected / timeout（对齐 StopHookReason 与骨架枚举），杜绝未知原因
 * 被 default 折叠成 completed 的误判（见 error_repairs 方案 A 记录）。导出便于单测。
 */
export function mapTaorStopReasonToTermination(
  reason: string | null | undefined
): TerminationReason {
  switch (reason) {
    case 'max_turns':
      return 'max_turns';
    case 'budget_exhausted':
      return 'budget_exhausted';
    case 'verifier_escalate':
      return 'verifier_escalate';
    case 'diminishing_returns':
      return 'diminishing_returns';
    case 'loop_detected':
      return 'loop_detected';
    case 'timeout':
      return 'timeout';
    case 'aborted':
      return 'aborted';
    case 'error':
      return 'error';
    default:
      return 'completed';
  }
}
