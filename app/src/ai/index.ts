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
 * AI模块主入口（已整合LLM模块 → providers/ 统一管理）
 */
import {
  createAIService,
  createAIServiceWithScrubbing,
} from './services/aiService';
export { createAIService, createAIServiceWithScrubbing };
export { AIServiceImpl } from './services/aiService';

export type {
  AIService,
  AIServiceConfig,
  LLMConfig,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  ParsedToolCall,
} from './models/types';
export { AIModelType, AIMessageRole } from './models/types';
export type { AIMessage, AIResponse, AIClient } from './models/types';

// providers/ — 统一供应商管理
export type {
  AIProvider,
  ProviderConfig,
  ProviderValidationResult,
  ChatOptions,
} from './providers/AIProvider';
export {
  ProviderRegistry,
  providerRegistry,
} from './providers/ProviderRegistry';
export { AnthropicProvider } from './providers/AnthropicProvider';
export { OpenAIProvider } from './providers/OpenAIProvider';
export { GoogleProvider } from './providers/GoogleProvider';
export { OllamaProvider } from './providers/OllamaProvider';
export { DeepSeekProvider } from './providers/DeepSeekProvider';

// transports/ — 统一传输抽象层（对标 Hermes ProviderTransport）
export { BaseTransport } from './transports/BaseTransport';
export { TransportRegistry, transportRegistry } from './transports/TransportRegistry';
export { MessagesApiTransport, AnthropicMessagesTransport } from './transports/AnthropicMessagesTransport';
export { ChatCompletionsTransport } from './transports/ChatCompletionsTransport';
export { GeminiTransport } from './transports/GeminiTransport';
export type {
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
  TransportRequestParams,
  TransportStreamEvent,
} from './transports/types';
export { EMPTY_NORMALIZED_USAGE } from './transports/types';

// prompts/ — prompt 增强与缓存
export { PromptCacheManager, promptCacheManager } from './prompts/PromptCacheManager';
export type { CacheStats, PromptCacheConfig } from './prompts/PromptCacheManager';

// parsers/ — 工具调用解析器（对标 Hermes ToolCallParser 系统）
export { BaseParser } from './parsers/BaseParser';
export { ParserRegistry, parserRegistry } from './parsers/ParserRegistry';
export { HermesXmlParser } from './parsers/HermesXmlParser';
export { DeepSeekV3Parser } from './parsers/DeepSeekV3Parser';
export { DeepSeekV31Parser } from './parsers/DeepSeekV31Parser';
export { Glm45Parser } from './parsers/Glm45Parser';
export { LlamaJsonParser } from './parsers/LlamaJsonParser';
export type { ParsedResult } from './parsers/types';
export { emptyParsedResult, toolCallResult } from './parsers/types';

// clients/ — 工具层
export { ToolAwareClient } from './clients/ToolAwareClient';
export type {
  ThinkingConfig,
  ThinkingOptions,
  ThinkingEffort,
} from './clients/thinking';
export {
  DEFAULT_THINKING_BUDGET_TOKENS,
  DEFAULT_THINKING_EFFORT,
  EFFORT_TO_BUDGET,
  buildThinkingConfig,
  parseEffortArg,
  modelSupportsThinking,
  modelSupportsAdaptiveThinking,
  getThinkingBudgetForModel,
  shouldEnableThinkingByDefault,
} from './clients/thinking';
// withRetry 标准实现在 query/withRetry.ts

export { LLMInputValidator } from './utils/LLMInputValidator';
export type { ValidationResult as LLMValidationResult } from './utils/LLMInputValidator';
export { LLMOutputValidator } from './utils/LLMOutputValidator';
export type { OutputValidationResult } from './utils/LLMOutputValidator';
export { LLMPerformanceMonitor } from './utils/LLMPerformanceMonitor';
export type {
  PerformanceMetrics,
  RequestRecord,
} from './utils/LLMPerformanceMonitor';

export {
  ToolAssistant,
  createToolAssistant,
  getToolAssistant,
} from './assistants/ToolAssistant';
export { DefaultToolExecutor } from './interfaces/ToolExecutor';
export type {
  IToolExecutor,
  ToolExecutorConfig,
} from './interfaces/ToolExecutor';
export type { ToolExecutorConfig as IToolExecutorConfig } from './interfaces/ToolExecutor';
export type {
  IQueryEngineCore,
  QueryOptions,
  QueryHooks,
} from './interfaces/IQueryEngineCore';
export type {
  QueryParams,
  QueryResult,
  ToolContext,
  StreamEvent,
  StreamResult,
} from './interfaces/QueryInterfaces';

export {
  SessionSpanTracer,
  getSessionSpanTracer,
  SPAN_ATTRIBUTE_KEYS,
} from './telemetry';
export type {
  SessionSpanContext,
  SessionSpanAttributes,
  SpanRecord,
  SpanEvent,
} from './telemetry';

export {
  LocalAgent,
  KeywordRuleEngine,
  TaskRouterImpl,
  LocalCommandExecutor,
  createLocalAgent,
  getGlobalLocalAgent,
  setGlobalLocalAgent,
  createTaskRouter,
  createCommandExecutor,
  QueryEngineIntegrationAdapter,
  createIntegrationAdapter,
  getGlobalIntegrationAdapter,
  MCPProvider,
  getGlobalMCPProvider,
  createMCPProvider,
  MetricsCollector,
  createMetricsCollector,
  getGlobalMetricsCollector,
} from './localAgent';
export type {
  Intent,
  RouteDecision,
  RouteTarget,
  IntentType,
  CommandMatch,
  CommandAction,
  RuleMatch,
  LocalAgentConfig,
  LocalAgentResult,
  OllamaConfig,
  RoutingConfig,
  RoutingStrategy,
  IRuleEngine,
  QueryEngineIntegrationConfig,
  QueryEngineIntegrationResult,
  MCPProviderConfig,
  IMCPClient,
  MCPToolCall,
  MCPToolResult,
  LocalAgentMetrics,
  MetricEntry,
} from './localAgent';

export {
  QueryEngineWrapper,
  createQueryEngineWrapper,
} from './services/QueryEngineWrapper';
export type { QueryEngineWrapperConfig } from './services/QueryEngineWrapper';

// router/ — 智能路由模块
export { SmartRouter, JudgeService, TierResolver, SessionRouterStore } from './router';
export type {
  SmartRouterOptions,
  RouterTier,
  RouterConfig,
  TierModelConfig,
  JudgeCloudConfig,
  SessionRouteRecord,
  JudgeResult,
} from './router';
export { ALL_ROUTER_TIERS } from './router';

// middleware/ — 统一中间件管道
export {
  AIPipeline,
  getDefaultPipeline,
  setDefaultPipeline,
} from './middleware';
export type { AIMiddleware, AIMiddlewareContext } from './middleware';

export * from './credentials';
export * from './cost';

// models/ — 模型管理增强（对标 CC 供应商管理）
export { ProviderManager, providerManager } from './providers/ProviderManager';
export type {
  ProviderRecord,
  ProviderType,
  CreateProviderParams,
  UpdateProviderParams,
  ProviderListFilter,
} from './providers/ProviderManager';

export { BalanceChecker } from './providers/BalanceChecker';
export type { BalanceResult, BalanceData } from './providers/BalanceChecker';

export { ModelFetcher } from './providers/ModelFetcher';
export type { FetchedModel } from './providers/ModelFetcher';

export { SpeedTestService } from './providers/SpeedTestService';
export type { EndpointLatency } from './providers/SpeedTestService';

export {
  UsageStatsService,
  usageStatsService,
} from './models/UsageStatsService';
export type {
  UsageSummary,
  DailyStats,
  ModelStats,
  ProviderStats,
  UsageLogRecord,
  CreateUsageLogParams,
  UsageLogFilter,
  PaginatedLogs,
} from './models/UsageStatsService';

export {
  ModelPricingService,
  modelPricingService,
} from './models/ModelPricingService';
export type {
  ModelPricingRecord,
  UpsertPricingParams,
} from './models/ModelPricingService';

export { AppModelConfigService, appModelConfigService } from './models/AppModelConfigService';
export type { AppModelConfig, AppModelTarget } from './models/AppModelConfigService';

export { UsageTracker } from './UsageTracker';
export type { TrackUsageParams } from './UsageTracker';

export {
  PriorityBasedFailover,
  priorityFailover,
} from './providers/PriorityBasedFailover';
export type {
  FailoverConfig,
  FailoverEvent,
} from './providers/PriorityBasedFailover';

export { ProviderSyncService } from './providers/ProviderSyncService';

export { tryHandleRoute } from './ModelManagementAPI';

// modelRouter/ — 统一模型路由层
export { ModelRouter, modelRouter } from './modelRouter';
export type { TaskType, TaskModelConfig, ModelRouterOptions } from './modelRouter';
export { ALL_TASK_TYPES } from './modelRouter';

// embedding/ — 嵌入模型支持（可选依赖，零启动开销）
export {
  EmbeddingBase,
  EmbeddingManager,
  globalEmbeddingManager,
  OpenAIEmbeddingProvider,
} from './embedding';
export type {
  EmbeddingOptions,
  EmbeddingResult,
  EmbeddingConfig,
  OpenAIEmbeddingConfig,
} from './embedding';

// formatters/ — 模型专用消息格式化器
export {
  ModelFormatter,
  OpenAIFormatter,
  AnthropicFormatter,
  GeminiFormatter,
  DeepSeekFormatter,
  FormatterRegistry,
  formatterRegistry,
} from './formatters';
export type { FormatContext, FormatResult } from './formatters';

const aiService = createAIService();
export default aiService;
