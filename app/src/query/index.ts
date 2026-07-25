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
//
/**
 * 查询模块主入口
 */

export { QueryEngine, createQueryEngine } from './QueryEngine.js';
export type {
  QueryEngineConfig,
  QueryParams,
  QueryResult,
  SDKMessage,
  SessionState,
  ProgressEvent,
  QueryError,
} from './QueryEngine.js';
export { QueryState, QueryErrorType } from './QueryEngine.js';
export { withRetry, categorizeAPIError } from './withRetry.js';
export type { RetryConfig, APIErrorClassification } from './withRetry.js';
export { processUserInput, sanitizeUserInput } from './processUserInput.js';
export type { ProcessedInput } from './processUserInput.js';
export {
  fetchSystemPromptParts,
  isResultSuccessful,
  normalizeMessage,
  handleOrphanedPermission,
} from './queryContext.js';
export type { SystemPromptParts } from './queryContext.js';
export {
  normalizeMessages,
  isNotEmptyMessage,
  shouldSendToolProgress,
  createReadFileStateCache,
} from './queryHelpers.js';
export {
  startQueryProfile,
  queryCheckpoint,
  endQueryProfile,
  formatMs,
} from './queryProfiler.js';
export {
  StopHookManager,
  createStopHookManager,
  DEFAULT_STOP_HOOK_PRIORITIES,
} from './StopHooks.js';
export type { StopHook, StopHookContext, StopHookReason } from './StopHooks.js';
export {
  ToolUseSummarizerImpl,
  createToolUseSummarizer,
} from './ToolUseSummary.js';
export type {
  ToolUseSummaryConfig,
  ToolUseSummary,
  ToolUseSummarizer,
} from './ToolUseSummary.js';
export {
  ContextCollapserImpl,
  createContextCollapser,
} from './ContextCollapse.js';
export type {
  CollapseOptions,
  CollapseResult,
  ContextCollapser,
} from './ContextCollapse.js';
export {
  ReactiveCompactorImpl,
  createReactiveCompactor,
} from './ReactiveCompact.js';
export type {
  ReactiveCompactConfig,
  ReactiveCompactResult,
  ReactiveCompactor,
  ApiResponseInfo,
} from './ReactiveCompact.js';
// Phase 2.9: Re-export from core for backward compatibility
export {
  TokenBudgetController as TokenBudgetManagerImpl,
  TokenBudgetStatus,
} from '../core/tokenBudget/TokenBudgetController.js';
export type { TokenBudgetState } from '../core/tokenBudget/TokenBudgetController.js';

// Legacy type re-exports (keep query/TokenBudget types for config compatibility)
export type { TokenBudgetConfig, TokenBudgetManager } from './TokenBudget.js';
export {
  QueryConfigManager,
  createQueryConfigManager,
  DEFAULT_QUERY_CONFIG,
} from './config.js';
export type {
  QueryConfig,
  CompactConfig,
  TokenBudgetConfig as TBConfig,
} from './config.js';
export {
  QueryDepsManager,
  getGlobalDepsManager,
  createQueryDepsManager,
} from './deps.js';
export type { QueryDependencies } from './deps.js';
export {
  TAORLoop,
  createTAORLoop,
  createTAORLoopDeps,
  MemoryCheckpointStorage,
} from './TAORLoop.js';
export { createChatManagerTAORDeps } from './ChatManagerTAORAdapter.js';
export type { ChatManagerTAORContext } from './ChatManagerTAORAdapter.js';
export { TAORPhase } from './types.js';
export { FileCheckpointStorage } from './FileCheckpointStorage.js';
export { FileTAORCheckpointStorage } from './FileTAORCheckpointStorage.js';
export { ResumeManager, resumeManager } from './ResumeManager.js';
export type { ResumeCandidate } from './ResumeManager.js';
export { PathGuard, createPathGuard } from './PathGuard.js';
export type { PathGuardConfig, PathCheckResult } from './PathGuard.js';
export {
  FileIOLoopDetector,
  createFileIOLoopDetector,
} from './FileIOLoopDetector.js';
export type { FileIOConfig, FileIOBlockResult } from './FileIOLoopDetector.js';
export { VerifierAgent, createVerifierAgent } from './VerifierAgent.js';
export type {
  VerifierAgentConfig,
  VerificationResult,
  VerificationInput,
  VerdictType,
} from './VerifierAgent.js';
export {
  StreamingToolExecutor,
  createStreamingToolExecutor,
} from './StreamingToolExecutor.js';
export type {
  StreamingToolResult,
  StreamingToolExecutorConfig,
  CallModelFn,
  ExecuteToolsFn,
} from './StreamingToolExecutor.js';
export {
  ParallelToolExecutor,
  createParallelToolExecutor,
} from './ParallelToolExecutor.js';
export type {
  ParallelToolResult,
  ToolExecutorFn,
  BatchExecutionResult,
  ParallelToolExecutorConfig,
} from './ParallelToolExecutor.js';
export {
  ToolErrorCollector,
  createToolErrorCollector,
} from './ToolErrorCollector.js';
export type {
  ToolErrorRecord as ToolError,
  ToolErrorSummary,
} from './ToolErrorCollector.js';
export {
  LOOP_OBSERVE_ONLY,
  LOOP_UNKNOWN_TOOL_WARNING,
  LOOP_UNKNOWN_TOOL_CRITICAL,
  LOOP_GLOBAL_BREAKER_THRESHOLD,
  LOOP_FILE_IO_WARNING,
  LOOP_FILE_IO_BLOCK,
  LOOP_MIN_TOKEN_DELTA,
  LOOP_DIMINISH_TURNS_THRESHOLD,
  LOOP_COMPACT_ROUNDS_KEEP,
  LOOP_GENERIC_REPEAT_WARNING,
  LOOP_GENERIC_REPEAT_CRITICAL,
  LOOP_PING_PONG_THRESHOLD,
  LOOP_NO_TOOL_CALL_WARNING,
  LOOP_NO_TOOL_CALL_CRITICAL,
  observeOnlyGuard,
} from './loop-config.js';
export type {
  TAORLoopDeps,
  TAORLoopConfig,
  TAORLoopResult,
  TAORPhaseInfo,
  TAORPhaseCallback,
} from './TAORLoop.js';
export type {
  TAORCheckpoint,
  CheckpointStorage,
  CheckpointInboxState,
  CheckpointIntegrity,
} from './types.js';
export {
  QueryLogStore,
  getQueryLogStore,
  resetQueryLogStore,
} from './QueryLogStore.js';
export type {
  QueryLogEntry,
  QueryLogEntryType,
  QueryLogFilter,
  QueryLogStats,
} from './QueryLogTypes.js';
export { SlowQueryDetector } from './SlowQueryDetector.js';
export type { SlowQueryRecord, SlowQueryReport } from './SlowQueryDetector.js';
