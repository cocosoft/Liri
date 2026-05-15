/**
 * AI模块主入口（已整合LLM模块 → providers/ 统一管理）
 */
import { createAIService, createAIServiceWithScrubbing } from './services/aiService';
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
export {
  registerDefaultProviders,
  registerAnthropicProvider,
  registerOpenAIProvider,
} from './providers/registerProviders';

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
export {
  withRetry,
  createRetryWrapper,
  onRetryEvent,
  offRetryEvent,
} from './clients/retry';
export type {
  RetryConfig,
  RetryContext,
  RetryResult,
  RetryEvent,
} from './clients/retry';

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
export { AIQueryEngine } from './services/AIQueryEngine';
export type { AIQueryEngineConfig } from './services/AIQueryEngine';
export type {
  QueryParams,
  QueryResult,
  ToolContext,
  StreamEvent,
  StreamResult,
} from './interfaces/QueryInterfaces';

export { AITelemetry, aiTelemetry } from './telemetry';
export type {
  APIUsageMetrics,
  TelemetryConfig,
  SpanContext,
  AITraceData,
  TraceEvent,
} from './telemetry';

export {
  MiniAgent,
  KeywordRuleEngine,
  TaskRouterImpl,
  OllamaProvider as MiniAgentOllamaProvider,
  LocalCommandExecutor,
  createMiniAgent,
  getGlobalMiniAgent,
  setGlobalMiniAgent,
  createTaskRouter,
  createCommandExecutor,
  createOllamaProvider,
  createDefaultOllamaConfig,
  QueryEngineIntegrationAdapter,
  createIntegrationAdapter,
  getGlobalIntegrationAdapter,
  MCPProvider,
  getGlobalMCPProvider,
  createMCPProvider,
  MetricsCollector,
  createMetricsCollector,
  getGlobalMetricsCollector,
} from './miniAgent';
export type {
  Intent,
  RouteDecision,
  RouteTarget,
  IntentType,
  CommandMatch,
  CommandAction,
  RuleMatch,
  MiniAgentConfig,
  MiniAgentResult,
  OllamaConfig,
  RoutingConfig,
  RoutingStrategy,
  IRuleEngine,
  IOllamaProvider,
  OllamaGenerateOptions,
  OllamaChatOptions,
  OllamaResponse,
  OllamaChatResponse,
  QueryEngineIntegrationConfig,
  IntegrationResult as QueryEngineIntegrationResult,
  MCPProviderConfig,
  IMCPClient,
  MCPToolCall,
  MCPToolResult,
  MiniAgentMetrics,
  MetricEntry,
} from './miniAgent';

export {
  QueryEngineWrapper,
  createQueryEngineWrapper,
} from './services/QueryEngineWrapper';
export type { QueryEngineWrapperConfig } from './services/QueryEngineWrapper';

export * from './credentials';
export * from './cost';

const aiService = createAIService();
export default aiService;
