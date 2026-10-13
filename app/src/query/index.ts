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

export {
  ReActLoop,
  EXTERNAL_FETCH_TOOLS,
  SYSTEM_ABORT_REASON,
  createSystemAbortReason,
  isAbortReason,
  isSystemAbortReason,
} from './ReActLoop.js';
export type {
  ReActState,
  ReActLoopConfig,
  BudgetControllerLike,
  TerminationReason,
  AbortSource,
  ReActEvent,
  ToolCallEntry,
  ToolResultEntry,
  ReasonResult,
  ActResult,
  // 2026-10-08（§1.6 红线审计修复）：steering 条目（携带 source ⇒ 可落 context/steering 事件）
  SteeringEntry,
} from './ReActLoop.js';
export { QueryEngine, createQueryEngine } from './QueryEngine.js';
export type {
  QueryEngineConfig,
  QueryParams,
  QueryResult,
  SDKMessage,
  SessionState,
  QueryError,
} from './QueryEngine.js';
export { QueryState, QueryErrorType } from './QueryEngine.js';
export { withRetry, categorizeAPIError } from './withRetry.js';
export type { RetryConfig, APIErrorClassification } from './withRetry.js';
export { processUserInput, sanitizeUserInput } from './processUserInput.js';
export type { ProcessedInput } from './processUserInput.js';
export {
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
} from '../tokenBudget/TokenBudgetController.js';
export type { TokenBudgetState } from '../tokenBudget/TokenBudgetController.js';

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
// 2026-10-01（子批 F · `runtime -> query` 收口）：`FileCheckpointStorage` 已迁至
// `session/storage/FileCheckpointStorage.ts`（service）—— 其唯一 app 耦合（`chat/types/checkpoint`）
// 随 B11 变为 `session/types/checkpoint`(service) 而消失 ⇒ 可下沉。跨模块取用改经 `@modules/session` 桶。
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
export { verifyProject } from './verifyProject.js';
// T-①04 T1-3（A 解析层）：pattern 承担方解析（ID → 现有实现定位；闭集无悬空）
export {
  PATTERN_PROVIDER_BINDINGS,
  resolvePatternProvider,
  resolveAssemblyProviders,
  findUnboundProviders,
} from './patternAssembly.js';
export type { PatternProviderBinding } from './patternAssembly.js';
// A8 最后一公里（B1，2026-10-04）：装配入口 —— assembler → 可执行路由（闭集 + fail-closed）
// 13-P1-3（2026-10-05）：新增执行配方（recipe）与配方→验证器配置
export {
  instantiatePattern,
  verifierConfigForRecipe,
  // PC-6（2026-10-07）：编排模式只读目录（注册表 + 装配状态）
  listPatternCatalog,
  // 2026-10-07：静态目录快照落盘（按需；沿 reports/ 既有约定）
  writePatternCatalogSnapshot,
  patternCatalogSnapshotPath,
} from './patternAssembler.js';
export type {
  PatternInstantiation,
  PatternRunRoute,
  PatternCatalogEntry,
  PatternCatalogSnapshot,
} from './patternAssembler.js';
export {
  CompetitiveStrategyOrchestrator,
  // A7（2026-10-01）：研究编排装配点——生产代码中该编排器只在此函数内构造
  runResearchOrchestration,
} from './CompetitiveStrategyOrchestrator.js';
export type {
  CompetitiveOrchestratorConfig,
  CompetitiveOrchestrationResult,
  CandidateProposal,
  CandidateObjection,
  ResearchCallModel,
} from './CompetitiveStrategyOrchestrator.js';
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
export { TrackedTool, TrackedToolState } from './TrackedTool.js';
export type { TrackedToolResult, TrackedToolCallback } from './TrackedTool.js';
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
  CascadeAbortManager,
  classifyToolError,
} from './CascadeAbortManager.js';
export type {
  CascadeAbortConfig,
  ErrorClassification,
  CascadeTrigger,
} from './CascadeAbortManager.js';
export {
  ToolErrorCollector,
  createToolErrorCollector,
} from './ToolErrorCollector.js';
export type {
  ToolErrorRecord as ToolError,
  ToolErrorSummary,
} from './ToolErrorCollector.js';
export {
  isLoopObserveOnly,
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
  TAORCheckpointStorage,
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

// 2026-08-29 R03-002 收敛：统一出口补充
export { createErrorRecoveryManager } from './ErrorRecoveryManager.js';
export { ContextTracker } from './context/ContextTracker.js';
export { LoopDetector } from './LoopDetector.js';
export {
  truncateToolResult,
  MAX_TOOL_RESULT_CHARS,
} from './ToolResultTruncator.js';

// R16 / D1（2026-10-11）：日 Token 预算统一出口 —— HTTP 层（service）经本桶动态取用，
// 避免 service → app 静态倒挂与 R03-002 子路径违规。
export {
  DailyBudgetManager,
  createDailyBudgetManager,
  getDailyBudget,
  resetDailyBudgetForTest,
  initDailyBudget,
  recordDailyBudgetFromUsage,
  resolveDailyBudgetConfig,
  DAILY_BUDGET_CONFIG_KEY,
  DAILY_BUDGET_USD_CONFIG_KEY,
  isValidDailyLimit,
  isValidDailyLimitUsd,
  isValidBudgetRatio,
  DEFAULT_DAILY_BUDGET_TOKENS,
} from './DailyBudgetManager.js';
export type {
  DailyBudgetConfig,
  DailyBudgetConfigValue,
} from './DailyBudgetManager.js';
// I4（最终整支评审）：`pendingToolCalls` 的推导与**续跑提示**生成对外（经模块出口，守 R03-002）。
export {
  extractPendingToolCallsFromMessages,
  buildBudgetResumePrompt,
} from './taor/pendingToolCalls.js';
export type { PendingToolCallRef } from './taor/pendingToolCalls.js';
// A2（2026-10-12）：预算挂起协调器查询面 —— HTTP 层（service）经本桶动态取用，
// 暴露**只读**挂起清单（`list()`），避免 service → app 静态倒挂与 R03-002 子路径违规。
export { getBudgetSuspendCoordinator } from './budgetSuspend.js';
export type {
  SuspendEntry,
  SuspendChain,
  SuspendKind,
} from './budgetSuspend.js';
// T3-12（2026-10-13）：guard 挂起（熵门禁/轮上限）+ 独立继续入口 —— HTTP 层经本桶动态取用。
export {
  isGuardSuspendEnabled,
  registerGuardSuspend,
  guardSuspendFromEntropy,
  continueSuspendedSession,
  GUARD_SUSPEND_REASONS,
} from './guardSuspend.js';
export type {
  GuardSuspendReason,
  ContinueOutcome,
  ContinueCode,
} from './guardSuspend.js';
// 债四 S2（2026-10-13）：USD 折算取价适配器 —— query 经 **core SPI** 取价 + core 纯换算，
// **不** import `@modules/cost`（避 R00-001 分层倒挂）；闸门切金额（S3）消费本适配器。
export {
  resolveModelPricing,
  estimateTurnCostUsd,
} from './modelPricingAdapter.js';
export type {
  ModelPricingLookup,
  ResolvedModelPricing,
  TurnUsageEstimate,
  TurnCostEstimate,
} from './modelPricingAdapter.js';
