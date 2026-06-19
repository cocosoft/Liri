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
export {
  TokenBudgetManagerImpl,
  createTokenBudgetManager,
  TokenBudgetStatus,
} from './TokenBudget.js';
export type {
  TokenBudgetConfig,
  TokenBudgetState,
  TokenBudgetManager,
} from './TokenBudget.js';
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
  MemoryCheckpointStorage,
} from './TAORLoop.js';
export { TAORPhase } from './types.js';
export { FileCheckpointStorage } from './FileCheckpointStorage.js';
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
export type { ToolErrorRecord as ToolError, ToolErrorSummary } from './ToolErrorCollector.js';
export type {
  TAORLoopConfig,
  TAORLoopResult,
  TAORPhaseInfo,
  TAORPhaseCallback,
} from './TAORLoop.js';
export type { TAORCheckpoint, CheckpointStorage } from './types.js';
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
