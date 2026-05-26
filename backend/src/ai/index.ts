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
export {
  registerDefaultProviders,
  registerAnthropicProvider,
  registerOpenAIProvider,
  registerGoogleProvider,
  registerOllamaProvider,
  registerVertexAIProvider,
  registerDeepSeekProvider,
  registerBedrockProvider,
  registerAzureOpenAIProvider,
  registerMoonshotProvider,
  registerGrokProvider,
} from './providers/registerProviders';

// transports/ — 统一传输抽象层（对标 Hermes ProviderTransport）
export { BaseTransport } from './transports/BaseTransport';
export {
  TransportRegistry,
  transportRegistry,
} from './transports/TransportRegistry';
export { AnthropicMessagesTransport } from './transports/AnthropicMessagesTransport';
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

export { AITelemetry, aiTelemetry } from './telemetry';
export type {
  APIUsageMetrics,
  TelemetryConfig,
  SpanContext,
  AITraceData,
  TraceEvent,
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

// middleware/ — 统一中间件管道
export {
  AIPipeline,
  getDefaultPipeline,
  setDefaultPipeline,
} from './middleware';
export type { AIMiddleware, AIMiddlewareContext } from './middleware';

export * from './credentials';
export * from './cost';

const aiService = createAIService();
export default aiService;
