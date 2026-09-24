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
import type {
  AgentService,
  AIAgent,
  AgentTool,
  AgentStrategy,
  AgentMemory,
  AgentTask,
  AgentResponse,
} from './models/types';
import { AgentState } from './models/types';
import { createAgentService } from './services/agentService';
import { AIAgentImpl } from './agent';
import { GeneralAgentStrategy } from './strategies/GeneralAgentStrategy';
import { CodeAgentStrategy } from './strategies/CodeAgentStrategy';
import { ExploreAgentStrategy } from './strategies/ExploreAgentStrategy';
import { PlanAgentStrategy } from './strategies/PlanAgentStrategy';

import { MultiSourceAgentManager } from './managers/MultiSourceAgentManager';
import { PluginLoader } from './managers/PluginLoader';
import { AgentSourceManager } from './managers/AgentSourceManager';
import { AgentConfigManager } from './managers/AgentConfigManager';
import { AdvancedMemorySystem } from './memory/AdvancedMemorySystem';
import { AgentUIManager } from './ui/AgentUIManager';

import {
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
} from './remote';

import { AgentColorManager, AGENT_COLORS } from './utils/AgentColorManager';
import type { AgentColorName } from './utils/AgentColorManager';
import {
  loadAgentsDir,
  loadUserAgents,
  loadProjectAgents,
  loadLocalAgents,
  loadManagedAgents,
} from './utils/agentLoader';

import { BtwProcessor } from './btw';
import type {
  BtwProcessorConfig,
  BtwDetectionResult,
  BtwAnswerResult,
  BtwContextMessage,
} from './btw';

import { ToolPolicyManager } from './tool-policy';
import type {
  ToolPolicyConfig,
  ToolPolicyEvaluation,
  OwnerOnlyToolApprovalClass,
} from './tool-policy';
import {
  normalizeToolName,
  normalizeToolList,
  expandToolGroups,
  // N-29：resolveProfilePolicy 已随 profile 门控收敛而移除（零消费者）
  resolveOwnerOnlyApprovalClass,
  isOwnerOnlyTool,
  TOOL_GROUPS,
} from './tool-policy';

// N-29（2026-09-20）：移除 `./tool-catalog` 的导入 —— 该模块（工具目录 + profile 派生）
// 经全仓检索**零消费者**（前端 0 命中；后端仅此 barrel 转发 + `tool-policy` 的
// `warnProfileDrift` 死路径），属"三套工具 profile 机制并存"中的第 ① 套，已随文件删除。

import { buildAgentTraceBase } from './trace-base';
import type { AgentTraceBase } from './trace-base';

import { resolveFastModeState, normalizeFastMode } from './fast-mode';
import type { FastModeState, FastModeConfig } from './fast-mode';

import {
  resolveAgentIdentity,
  resolveAckReaction,
  resolveIdentityNamePrefix,
  resolveMessagePrefix,
  resolveResponsePrefix,
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
} from './identity';
import type {
  IdentityConfig,
  MessagesConfig,
  HumanDelayConfig,
  AgentIdentitySystemConfig,
} from './identity';

import { StrategySelector } from './StrategySelector';
import {
  TaskComplexity,
  ContextSize,
  type TaskFeature,
  type StrategyRule,
  type StrategySelection,
} from './types';
import { ToolCallBatch } from './ToolCallBatch';
import type {
  ToolCallItem,
  ToolCallBatchResult,
  BatchConfig,
} from './ToolCallBatch';
import { ContextCompressor } from './ContextCompressor';
import type {
  CompressibleMessage,
  ContextCompressionConfig,
  CompressionResult,
} from './ContextCompressor';
import {
  AgentRegistry,
  getAgentRegistry,
  agentRegistry,
} from './registry/AgentRegistry';
import type {
  AgentDefinition,
  DiscoverCriteria,
} from './registry/AgentRegistry';

export {
  AgentService,
  createAgentService,
  AIAgent,
  AgentTool,
  AgentStrategy,
  AgentMemory,
  AgentTask,
  AgentResponse,
  AgentState,
  GeneralAgentStrategy,
  CodeAgentStrategy,
  ExploreAgentStrategy,
  PlanAgentStrategy,
  MultiSourceAgentManager,
  PluginLoader,
  AgentSourceManager,
  AgentConfigManager,
  AdvancedMemorySystem,
  AgentUIManager,
  // Remote
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
  // Agent Color
  AgentColorManager,
  AgentColorName,
  AGENT_COLORS,
  // Agent Loader
  loadAgentsDir,
  loadUserAgents,
  loadProjectAgents,
  loadLocalAgents,
  loadManagedAgents,
  // BTW (Back That Way)
  BtwProcessor,
  BtwProcessorConfig,
  BtwDetectionResult,
  BtwAnswerResult,
  BtwContextMessage,
  // Tool Policy
  ToolPolicyManager,
  ToolPolicyConfig,
  ToolPolicyEvaluation,
  OwnerOnlyToolApprovalClass,
  normalizeToolName,
  normalizeToolList,
  expandToolGroups,
  // N-29：resolveProfilePolicy 已随 profile 门控收敛而移除（零消费者）
  resolveOwnerOnlyApprovalClass,
  isOwnerOnlyTool,
  TOOL_GROUPS,
  // N-29：Tool Catalog 相关导出（ToolCatalog / createToolCatalog /
  // ToolCatalogProfileId / ToolSection / ToolCatalogItem）已随模块删除而移除
  // Trace Base
  AgentTraceBase,
  buildAgentTraceBase,
  // Fast Mode
  FastModeState,
  FastModeConfig,
  resolveFastModeState,
  normalizeFastMode,
  // Identity
  IdentityConfig,
  MessagesConfig,
  HumanDelayConfig,
  AgentIdentitySystemConfig,
  resolveAgentIdentity,
  resolveAckReaction,
  resolveIdentityNamePrefix,
  resolveMessagePrefix,
  resolveResponsePrefix,
  resolveEffectiveMessagesConfig,
  resolveHumanDelayConfig,
  // Strategy Selector
  StrategySelector,
  TaskComplexity,
  ContextSize,
  // ToolCallBatch
  ToolCallBatch,
  // ContextCompressor
  ContextCompressor,
  // AgentRegistry
  AgentRegistry,
  getAgentRegistry,
  agentRegistry,
};
export type {
  ToolCallItem,
  ToolCallBatchResult,
  BatchConfig,
} from './ToolCallBatch';
export type {
  CompressibleMessage,
  ContextCompressionConfig,
  CompressionResult,
} from './ContextCompressor';
export type {
  AgentDefinition,
  DiscoverCriteria,
} from './registry/AgentRegistry';

const agentService = createAgentService();
export default agentService;

export * from './events';

export * from './compact';

export * from './TitleGenerator.js';

// 2026-08-29 R03-002 收敛：telemetry / trajectory / isolation 统一出口
export { agentTelemetry } from './AgentTelemetry.js';
export type { AgentIsolation } from './AgentIsolation.js';
export {
  createAgentIsolation,
  throwIfAborted,
  registerIsolationToScope,
} from './AgentIsolation.js';
export type { BuiltInAgentDefinition } from './models/types.js';
export { OrchestrationEventType } from './events/OrchestrationEvents.js';
export type * from './events/OrchestrationEvents.js';
export { extractKeyPaths } from './compact/utils';

// 2026-08-30 R03-002 收敛：events 子路径统一出口
export { AgentEventType } from './events/types.js';

// 2026-09-24 R03-002 收敛：MoA（多智能体并行调度）统一出口
export { ParallelAgentScheduler } from './moa/ParallelAgentScheduler';
export type {
  ScheduledAgentTask,
  ScheduledTaskResult,
} from './moa/ParallelAgentScheduler';
export { ResultAggregator, AggregationStrategy } from './moa/ResultAggregator';
