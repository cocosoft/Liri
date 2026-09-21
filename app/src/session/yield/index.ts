// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * yield 语义子模块（阶段 A：`sessions_yield` 真实实现）
 *
 * - `constants`    契约字面值
 * - `yieldDetection` 判定纯函数（turn 收尾 / 工具结果 / toolCallId 提取）
 * - `YieldRegistry`  等待登记与收敛
 */

export {
  YIELD_TOOL_NAME,
  YIELD_RESULT_STATUS,
  YIELD_FINISH_REASON,
  YIELD_STATUS_WAITING,
  YIELD_STATUS_RESUMED,
  YIELD_STATUS_ABANDONED,
} from './constants';

export {
  isYieldedTurnEnd,
  isSuccessfulYieldResult,
  getYieldToolCallId,
} from './yieldDetection';

export {
  YieldRegistry,
  getYieldRegistry,
  resetYieldRegistry,
} from './YieldRegistry';
export type {
  YieldEntryStatus,
  YieldWaitingEntry,
  YieldConvergeInput,
} from './YieldRegistry';

export {
  registerYieldFromResults,
  setActiveSubagentRunProbe,
  hasActiveSubagentRunProbe,
} from './yieldTurnRegistration';
export type {
  YieldCandidateResult,
  ActiveSubagentRunProbe,
} from './yieldTurnRegistration';
