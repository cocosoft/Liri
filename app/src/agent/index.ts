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

import { AgentSwarmManager, SwarmCoordinator } from './swarms';
import {
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
} from './remote';

import { AgentRunner } from './AgentRunner';
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
  ToolProfileId as ToolPolicyProfileId,
  ToolPolicyConfig,
  ToolPolicyEvaluation,
  OwnerOnlyToolApprovalClass,
} from './tool-policy';
import {
  normalizeToolName,
  normalizeToolList,
  expandToolGroups,
  resolveProfilePolicy,
  resolveOwnerOnlyApprovalClass,
  isOwnerOnlyTool,
  TOOL_GROUPS,
} from './tool-policy';

import { ToolCatalog, createToolCatalog } from './tool-catalog';
import type {
  ToolProfileId as ToolCatalogProfileId,
  ToolSection,
  ToolCatalogItem,
} from './tool-catalog';

import { buildAgentTraceBase } from './trace-base';
import type { AgentTraceBase } from './trace-base';

import { resolveFastModeState, normalizeFastMode } from './fast-mode';
import type { FastModeState, FastModeConfig } from './fast-mode';

import {
  saveTrajectory,
  messagesToTrajectory,
  convertScratchpadToThink,
  hasIncompleteScratchpad,
} from './trajectory';

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
import {
  AgentRegistry,
  getAgentRegistry,
  agentRegistry,
} from './registry/AgentRegistry';

// A2A 互操作（D3，2026-09-13）：Agent Card 映射 + 任务存取 + 协议类型。
// 经 barrel 暴露，供 infrastructure 侧（HTTP handler）按模块出口单一规则消费。
export {
  A2A_PROTOCOL_VERSION,
  buildAgentCard,
  computeAgentCardEtag,
  computeAgentCardVersion,
} from './a2a/agentCard.js';
export { A2ATaskStore, a2aTaskStore } from './a2a/taskStore.js';
export * from './a2a/types.js';
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
  // Swarms
  AgentSwarmManager,
  SwarmCoordinator,
  // Remote
  RemoteAgentExecutorImpl,
  createRemoteAgentExecutor,
  WebSocketProtocol,
  HttpProtocol,
  // Agent Runner
  AgentRunner,
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
  ToolPolicyProfileId,
  ToolPolicyConfig,
  ToolPolicyEvaluation,
  OwnerOnlyToolApprovalClass,
  normalizeToolName,
  normalizeToolList,
  expandToolGroups,
  resolveProfilePolicy,
  resolveOwnerOnlyApprovalClass,
  isOwnerOnlyTool,
  TOOL_GROUPS,
  // Tool Catalog
  ToolCatalog,
  createToolCatalog,
  ToolCatalogProfileId,
  ToolSection,
  ToolCatalogItem,
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
  // Trajectory
  saveTrajectory,
  messagesToTrajectory,
  convertScratchpadToThink,
  hasIncompleteScratchpad,
  // Strategy Selector
  StrategySelector,
  TaskComplexity,
  ContextSize,
  // ToolCallBatch
  ToolCallBatch,
  // AgentRegistry
  AgentRegistry,
  getAgentRegistry,
  agentRegistry,
};
export type { TrajectoryEntry, ConversationMessage } from './trajectory';
export type {
  ToolCallItem,
  ToolCallBatchResult,
  BatchConfig,
} from './ToolCallBatch';
export type {
  AgentDefinition,
  DiscoverCriteria,
} from './registry/AgentRegistry';

const agentService = createAgentService();
export default agentService;

export * from './trajectory.js';

export * from './events';

export * from './TitleGenerator.js';

// 2026-08-29 R03-002 收敛：telemetry / trajectory / isolation 统一出口
export { agentTelemetry } from './AgentTelemetry.js';
export { trajectoryRecorder } from './trajectory/TrajectoryRecorder.js';
export type { AgentIsolation } from './AgentIsolation.js';
export {
  createAgentIsolation,
  throwIfAborted,
  registerIsolationToScope,
} from './AgentIsolation.js';
export type { BuiltInAgentDefinition } from './models/types.js';
export { OrchestrationEventType } from './events/OrchestrationEvents.js';
export type * from './events/OrchestrationEvents.js';

// 2026-08-30 R03-002 收敛：events 子路径统一出口
export { AgentEventType } from './events/types.js';

// 2026-09-10 R03-002 收敛：moa 子路径统一出口（原 query/CompetitiveStrategyOrchestrator 直 import）
export { ParallelAgentScheduler } from './moa/ParallelAgentScheduler.js';
export type {
  ScheduledAgentTask,
  ScheduledTaskResult,
} from './moa/ParallelAgentScheduler.js';
export {
  ResultAggregator,
  AggregationStrategy,
} from './moa/ResultAggregator.js';
