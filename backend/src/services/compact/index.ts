/**
 * 压缩服务模块
 * 基于CC源码 cc_code/backend/services/compact/ 实现
 */

export type {
  CompactionResult,
  CompactState,
  AutoCompactOptions,
  TokenWarningState,
  TokenUsage,
  CompactThreshold,
} from './types';
export {
  DEFAULT_MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  DEFAULT_AUTO_COMPACT_BUFFER_TOKENS,
  DEFAULT_WARNING_THRESHOLD_BUFFER_TOKENS,
  DEFAULT_ERROR_THRESHOLD_BUFFER_TOKENS,
  DEFAULT_MANUAL_COMPACT_BUFFER_TOKENS,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  getContextWindowForModel,
  getMaxOutputTokensForModel,
  getEffectiveContextWindowFromModel,
  getAutoCompactThreshold,
  getWarningThreshold,
  getErrorThreshold,
  getBlockingLimit,
  calculateTokenWarningState,
  roughTokenCountEstimation,
  roughTokenCountEstimationForMessages,
} from './utils';

export {
  AutoCompactService,
  createAutoCompactService,
} from './AutoCompactService';
export type { AutoCompactTrackingState } from './AutoCompactService';

export { CompactServiceImpl } from './CompactService';
export type {
  CompactBoundary,
  CompactArtifact,
  CompactService,
  CompactConversationOptions,
} from './CompactService';

export {
  groupMessagesByApiRound,
  getMessageTextContent,
  getLastMessageByRole,
} from './grouping';

export {
  getCompactPrompt,
  getPartialCompactPrompt,
  getCompactUserSummaryMessage,
} from './prompt';

export {
  microcompactMessages,
  evaluateTimeBasedTrigger,
  TIME_BASED_MC_CLEARED_MESSAGE,
  resetMicrocompactState,
} from './microCompact';
export type { MicrocompactResult, PendingCacheEdits } from './microCompact';

export { getTimeBasedMCConfig } from './timeBasedMCConfig';
export type { TimeBasedMCConfig } from './timeBasedMCConfig';

export {
  suppressCompactWarning,
  clearCompactWarningSuppression,
  isCompactWarningSuppressed,
} from './compactWarningState';

export { runPostCompactCleanup } from './postCompactCleanup';

export {
  trySessionMemoryCompaction,
  shouldUseSessionMemoryCompaction,
  calculateMessagesToKeepIndex,
  adjustIndexToPreserveAPIInvariants,
  setSessionMemoryCompactConfig,
  getSessionMemoryCompactConfig,
  resetSessionMemoryCompactConfig,
} from './sessionMemoryCompact';
export type {
  SessionMemoryCompactConfig,
  SessionMemoryCompactResult,
  SessionMemoryCompactionResult,
} from './sessionMemoryCompact';
