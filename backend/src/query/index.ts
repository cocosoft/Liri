// @ts-nocheck
/**
 * 查询模块主入口
 */

export { QueryEngine, createQueryEngine } from './QueryEngine.js';
export type { QueryEngineConfig, QueryParams, QueryResult, SDKMessage, SessionState, ProgressEvent, QueryError } from './QueryEngine.js';
export { QueryState, QueryErrorType } from './QueryEngine.js';
export { withRetry, categorizeAPIError } from './withRetry.js';
export type { RetryConfig, APIErrorClassification } from './withRetry.js';
export { processUserInput, sanitizeUserInput } from './processUserInput.js';
export type { ProcessedInput } from './processUserInput.js';
export { fetchSystemPromptParts, isResultSuccessful, normalizeMessage, handleOrphanedPermission } from './queryContext.js';
export type { SystemPromptParts } from './queryContext.js';
export { normalizeMessages, isNotEmptyMessage, shouldSendToolProgress, createReadFileStateCache } from './queryHelpers.js';
export { startQueryProfile, queryCheckpoint, endQueryProfile, formatMs } from './queryProfiler.js';
export { StopHookManager, createStopHookManager, DEFAULT_STOP_HOOK_PRIORITIES } from './StopHooks.js';
export type { StopHook, StopHookContext, StopHookReason } from './StopHooks.js';
export { ToolUseSummarizerImpl, createToolUseSummarizer } from './ToolUseSummary.js';
export type { ToolUseSummaryConfig, ToolUseSummary, ToolUseSummarizer } from './ToolUseSummary.js';
export { ContextCollapserImpl, createContextCollapser } from './ContextCollapse.js';
export type { CollapseOptions, CollapseResult, ContextCollapser } from './ContextCollapse.js';
export { ReactiveCompactorImpl, createReactiveCompactor } from './ReactiveCompact.js';
export type { ReactiveCompactConfig, ReactiveCompactResult, ReactiveCompactor, ApiResponseInfo } from './ReactiveCompact.js';
export { TokenBudgetManagerImpl, createTokenBudgetManager, TokenBudgetStatus } from './TokenBudget.js';
export type { TokenBudgetConfig, TokenBudgetState, TokenBudgetManager } from './TokenBudget.js';
export { QueryConfigManager, createQueryConfigManager, DEFAULT_QUERY_CONFIG } from './config.js';
export type { QueryConfig, RetryConfig, CompactConfig, TokenBudgetConfig as TBConfig } from './config.js';
export { QueryDepsManager, getGlobalDepsManager, createQueryDepsManager } from './deps.js';
export type { QueryDependencies } from './deps.js';
