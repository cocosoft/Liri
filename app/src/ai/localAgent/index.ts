/**
 * Local Agent 模块
 * 普适性架构 - 核心层必需组件
 */

export * from './types.js';
export * from './KeywordRuleEngine.js';
export * from './TaskRouter.js';
export * from './CommandExecutor.js';
export * from './LocalAgent.js';
export * from './SimpleQAEngine.js';
export * from './ToolDispatcher.js';
export * from './LocalAgentCache.js';

export { LocalAgent } from './LocalAgent.js';
export { KeywordRuleEngine } from './KeywordRuleEngine.js';
export { TaskRouterImpl } from './TaskRouter.js';
export { LocalCommandExecutor } from './CommandExecutor.js';
export { SimpleQAEngine } from './SimpleQAEngine.js';
export { ToolDispatcher } from './ToolDispatcher.js';
export { LocalAgentCache } from './LocalAgentCache.js';
export {
  createLocalAgent,
  getGlobalLocalAgent,
  setGlobalLocalAgent,
} from './LocalAgent.js';
export { createTaskRouter } from './TaskRouter.js';
export { createCommandExecutor } from './CommandExecutor.js';

export {
  MetricsCollector,
  getGlobalMetricsCollector,
  createMetricsCollector,
} from './MetricsCollector.js';
export type { LocalAgentMetrics, MetricEntry } from './MetricsCollector.js';
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
