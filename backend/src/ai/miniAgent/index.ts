/**
 * Mini Agent 模块
 * 普适性架构 - 核心层必需组件
 */

export * from './types.js';
export * from './KeywordRuleEngine.js';
export * from './TaskRouter.js';
export * from './CommandExecutor.js';
export * from './OllamaProvider.js';
export * from './MiniAgent.js';

export { MiniAgent } from './MiniAgent.js';
export { KeywordRuleEngine } from './KeywordRuleEngine.js';
export { TaskRouterImpl } from './TaskRouter.js';
export { OllamaProvider } from './OllamaProvider.js';
export { LocalCommandExecutor } from './CommandExecutor.js';
export {
  createMiniAgent,
  getGlobalMiniAgent,
  setGlobalMiniAgent,
} from './MiniAgent.js';
export { createTaskRouter } from './TaskRouter.js';
export { createCommandExecutor } from './CommandExecutor.js';
export {
  createOllamaProvider,
  createDefaultOllamaConfig,
} from './OllamaProvider.js';
export {
  MiniAgentIntegrator,
  createMiniAgentIntegrator,
} from './MiniAgentIntegrator.js';
export type {
  MiniAgentIntegrationConfig,
  IntegrationResult,
} from './MiniAgentIntegrator.js';
export {
  MetricsCollector,
  getGlobalMetricsCollector,
  createMetricsCollector,
} from './MetricsCollector.js';
export type { MiniAgentMetrics, MetricEntry } from './MetricsCollector.js';
export {
  SkillProvider,
  getGlobalSkillProvider,
  createSkillProvider,
} from './SkillProvider.js';
export type { SkillProviderConfig, SkillMatch } from './SkillProvider.js';
export {
  QueryEngineIntegrationAdapter,
  createIntegrationAdapter,
  getGlobalIntegrationAdapter,
} from './QueryEngineIntegrationAdapter.js';
export type {
  QueryEngineIntegrationConfig,
  IntegrationResult as QueryEngineIntegrationResult,
} from './QueryEngineIntegrationAdapter.js';
export {
  MCPProvider,
  getGlobalMCPProvider,
  createMCPProvider,
} from './MCPProvider.js';
export type {
  MCPProviderConfig,
  IMCPClient,
  MCPToolCall,
  MCPToolResult,
} from './MCPProvider.js';
