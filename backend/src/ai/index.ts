/**
 * AI模块主入口（已整合LLM模块）
 */

import type {
  AIService,
  AIServiceConfig,
  LLMConfig,
  ChatMessage,
  ChatResponse,
  ToolCall,
  ToolDefinition,
  ParsedToolCall,
} from './models/types';
import { createAIService } from './services/aiService';
import {
  AIModelType,
  AIMessage,
  AIMessageRole,
  AIResponse,
  AIClient,
} from './models/types';

export { AIModelType, AIMessageRole } from './models/types';
export type {
  AIMessage,
  AIResponse,
  AIClient,
  AIServiceConfig,
  LLMConfig,
  ChatMessage,
  ToolCall,
  ToolDefinition,
  ParsedToolCall,
} from './models/types';
export type { AIService } from './models/types';
export { createAIService };

export { LLMClient } from './clients/LLMClient';
export {
  DefaultLLMClientFactory,
  getLLMClientFactory,
  createLLMClient,
} from './clients/LLMClientFactory';
export type {
  LLMClientType,
  AnthropicConfig,
  OpenAIConfig,
  AWSConfig,
  AzureConfig,
  VertexConfig,
} from './clients/LLMClientFactory';
export type { ModelMetadata } from './clients/ModelConfig';
export type { ModelConfig, ValidationResult } from './clients/ModelConfig';
export {
  getModelOverride,
  setModelOverride,
  getApiKeyOverride,
  setApiKeyOverride,
  getBaseUrlOverride,
  setBaseUrlOverride,
  getDefaultModel,
  getDefaultApiKey,
  getDefaultBaseUrl,
  resolveModel,
  resolveApiKey,
  resolveBaseUrl,
  getModelConfig,
  getAllAvailableModels,
  isValidModel,
  getModelMetadata,
  validateModel,
  getModelOptions,
  getModelContextSize,
  modelSupportsCapability,
  getRecommendedModel,
  clearOverrides,
} from './clients/ModelConfig';

export { DeepSeekClient } from './clients/DeepSeekClient';
export { AnthropicClient } from './clients/AnthropicClient';
export { OpenAIClient } from './clients/openaiClient';
export { AWSClient } from './clients/AWSClient';
export { AzureClient } from './clients/AzureClient';
export { VertexClient } from './clients/VertexClient';

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

// Retry mechanism
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

// Telemetry
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
  OllamaProvider,
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

const aiService = createAIService();
export default aiService;
