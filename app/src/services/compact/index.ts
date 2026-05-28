// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 压缩服务模块
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

export { CompactOrchestrator } from './CompactOrchestrator';
export type {
  CompactRecord,
  CompactOrchestratorOptions,
} from './CompactOrchestrator';
