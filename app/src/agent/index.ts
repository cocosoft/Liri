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
  // ContextCompressor
  ContextCompressor,
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
  CompressibleMessage,
  ContextCompressionConfig,
  CompressionResult,
} from './ContextCompressor';
export type {
  AgentDefinition,
  DiscoverCriteria,
} from './registry/AgentRegistry';
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

const agentService = createAgentService();
export default agentService;
