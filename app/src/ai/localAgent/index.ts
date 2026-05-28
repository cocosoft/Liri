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
